// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { describe, expect, it } from "vitest";
import { describeError, exchange, type AssistantEvent } from "../src/agent/assistant";
import { chatCompletionsClient, chatModels, listChatModels, ProviderError } from "../src/agent/openaiCompatible";
import type { Page } from "../src/agent/tools";

const page = (calls: unknown[][]): Page => ({
  hasStructure: () => true,
  describe: () => ({ file: "x.cif", format: "CIF", cell: "a = 10.4", elements: [], bonds: [], pairs: [{ between: "Nb–Nb", distances: [3.01, 3.07] }], cells: "", view: "", canvas: "", journal: "", moments: "none", angles: "", settings: {} }),
  applySettings: () => [],
  setElement: () => null,
  addBonds: (a, b, d) => (calls.push(["add", a, b, d]), null),
  changeBonds: () => null,
  removeBonds: () => null,
  setView: () => null,
  setCells: () => null,
  useJournal: () => ({ applied: "" }),
  setMoments: () => ({ applied: "" }),
  clearMoments: () => null,
  markAngles: () => ({ applied: "" }),
  clearAngles: () => null,
  saveStructure: () => ({ applied: "" }),
});

/** A provider that answers chat completions from a script, and records each request. */
function server(replies: unknown[]) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  let i = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    requests.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ choices: [replies[Math.min(i++, replies.length - 1)]] }), { status: 200 });
  };
  return { fetchImpl, requests };
}
const call = (id: string, name: string, args: unknown, extra?: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) }, ...(extra ? { extra_content: extra } : {}) });

describe("the assistant on OpenAI and Gemini (chat completions)", () => {
  for (const provider of ["openai", "gemini"] as const) {
    it(`${provider}: tools go as functions, calls are carried out, and each answer goes back tied to its call`, async () => {
      const signature = { google: { thought_signature: "sig-1" } };
      const { fetchImpl, requests } = server([
        { message: { content: null, tool_calls: [call("c1", "describe_figure", {}, signature)] }, finish_reason: "tool_calls" },
        { message: { content: "", tool_calls: [call("c2", "add_bonds", { between: "Nb-Nb", up_to: 3.2 })] }, finish_reason: "tool_calls" },
        { message: { content: "Added the Nb–Nb bonds (Structure › Bonds)." }, finish_reason: "stop" },
      ]);
      const calls: unknown[][] = [];
      const events: AssistantEvent[] = [];
      const history = await exchange(chatCompletionsClient(provider, "test-key", fetchImpl), "some-model", [], "Show the Nb–Nb bonds", page(calls), (e) => events.push(e));

      expect(calls).toEqual([["add", "Nb", "Nb", 3.2]]);
      expect(events.at(-1)).toEqual({ kind: "text", text: "Added the Nb–Nb bonds (Structure › Bonds)." });
      expect(history.length).toBe(6);
      expect(requests.length).toBe(3);
      const base = provider === "openai" ? "https://api.openai.com/v1" : "https://generativelanguage.googleapis.com/v1beta/openai";
      for (const r of requests) {
        expect(r.url).toBe(`${base}/chat/completions`);
        expect(r.headers.Authorization).toBe("Bearer test-key");
        expect(r.body.model).toBe("some-model");
      }
      // OpenAI's newer models take only max_completion_tokens; Gemini's compatible address takes max_tokens.
      expect(Object.keys(requests[0]!.body).filter((k) => k.startsWith("max_"))).toEqual([provider === "openai" ? "max_completion_tokens" : "max_tokens"]);
      const first = requests[0]!.body;
      expect((first.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user"]);
      const tools = first.tools as { type: string; function: { name: string; parameters: { type: string } } }[];
      expect(tools.every((t) => t.type === "function" && t.function.parameters.type === "object")).toBe(true);
      expect(tools.map((t) => t.function.name)).toContain("add_bonds");
      // The last request carries the whole exchange: each call, then its answer as a "tool" message with its id.
      const last = requests[2]!.body.messages as { role: string; content: string | null; tool_call_id?: string; tool_calls?: { id: string; function: { name: string; arguments: string }; extra_content?: unknown }[] }[];
      expect(last.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant", "tool"]);
      expect(last[2]!.tool_calls![0]!.id).toBe("c1");
      expect(last[3]!.tool_call_id).toBe("c1");
      expect(last[5]!.tool_call_id).toBe("c2");
      expect(JSON.parse(last[4]!.tool_calls![0]!.function.arguments)).toEqual({ between: "Nb-Nb", up_to: 3.2 });
      // Gemini's signature on a tool call goes back with it, unchanged.
      expect(last[2]!.tool_calls![0]!.extra_content).toEqual(signature);
    });
  }

  it("a call with no id gets one, and its answer is tied to it", async () => {
    const { fetchImpl, requests } = server([
      { message: { content: null, tool_calls: [{ type: "function", function: { name: "describe_figure", arguments: "" } }] }, finish_reason: "tool_calls" },
      { message: { content: "Looked." }, finish_reason: "stop" },
    ]);
    await exchange(chatCompletionsClient("gemini", "k", fetchImpl), "m", [], "look", page([]), () => undefined);
    const last = requests[1]!.body.messages as { role: string; tool_call_id?: string; tool_calls?: { id: string }[] }[];
    const id = last[2]!.tool_calls![0]!.id;
    expect(id).toMatch(/^call_/);
    expect(last[3]!.tool_call_id).toBe(id);
  });

  it("an answer cut off before any words or calls is reported, not passed on as empty", async () => {
    const { fetchImpl } = server([{ message: { content: "" }, finish_reason: "length" }]);
    await expect(exchange(chatCompletionsClient("openai", "k", fetchImpl), "m", [], "x", page([]), () => undefined)).rejects.toThrow(/answer length/);
  });

  it("errors read as sentences: a rejected key, a quota, anything else with the provider's own words", async () => {
    const failing = (status: number, message: string) => async () => new Response(JSON.stringify({ error: { message } }), { status });
    const run = async (provider: "openai" | "gemini", status: number, message: string) => {
      try {
        await exchange(chatCompletionsClient(provider, "k", failing(status, message)), "m", [], "x", page([]), () => undefined);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        return describeError(e, { transport: provider, model: "m", apiKey: "k" });
      }
      throw new Error("no error");
    };
    expect(await run("openai", 401, "Incorrect API key provided")).toBe("The OpenAI key was rejected. Check it in the assistant's Setup.");
    // Gemini answers a bad key with 400.
    expect(await run("gemini", 400, "API key not valid. Please pass a valid API key.")).toBe("The Gemini key was rejected. Check it in the assistant's Setup.");
    expect(await run("openai", 429, "You exceeded your current quota")).toMatch(/^OpenAI says too many requests.*quota/);
    expect(await run("gemini", 404, "models/nope is not found")).toBe("Google answered with an error: models/nope is not found");
  });

  it("model lists keep chat models only, newest first, without Gemini's 'models/' prefix", async () => {
    expect(
      chatModels("openai", {
        data: [
          { id: "gpt-4.1", created: 10 },
          { id: "gpt-5", created: 30 },
          { id: "text-embedding-3-large", created: 40 },
          { id: "gpt-4o-realtime-preview", created: 50 },
          { id: "o3", created: 20 },
          { id: "dall-e-3", created: 60 },
          { id: "gpt-4o-mini-tts", created: 70 },
        ],
      }),
    ).toEqual(["gpt-5", "o3", "gpt-4.1"]);
    expect(chatModels("gemini", { data: [{ id: "models/gemini-2.5-flash" }, { id: "models/text-embedding-004" }, { id: "models/gemini-2.5-pro" }, { id: "models/gemini-2.5-flash-image" }] })).toEqual(["gemini-2.5-pro", "gemini-2.5-flash"]);
    const requested: string[] = [];
    const names = await listChatModels("gemini", "k", undefined, async (url) => (requested.push(url), new Response(JSON.stringify({ data: [{ id: "models/gemini-2.5-pro" }] }))));
    expect(requested).toEqual(["https://generativelanguage.googleapis.com/v1beta/openai/models"]);
    expect(names).toEqual(["gemini-2.5-pro"]);
  });
});
