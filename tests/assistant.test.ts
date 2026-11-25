// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { exchange, MAX_STEPS, type AssistantEvent, type MessagesClient } from "../src/agent/assistant";
import type { Page } from "../src/agent/tools";

const page = (calls: unknown[][]): Page => ({
  hasStructure: () => true,
  describe: () => ({ file: "x.cif", format: "CIF", cell: "a = 10.4", elements: [], bonds: [], pairs: [{ between: "Nb–Nb", distances: [3.01, 3.07, 4.32] }], cells: "", view: "", canvas: "", journal: "", moments: "none", settings: {} }),
  applySettings: () => [],
  setElement: () => null,
  addBonds: (a, b, d) => (calls.push(["add", a, b, d]), null),
  changeBonds: (p, c) => (calls.push(["change", p, c]), null),
  removeBonds: () => null,
  setView: () => null,
  setCells: () => null,
  useJournal: () => ({ applied: "" }),
  setMoments: () => ({ applied: "" }),
  clearMoments: () => null,
  saveStructure: () => ({ applied: "" }),
});

/** A model that answers from a script, and records what it was sent. */
function scripted(replies: Anthropic.ContentBlock[][]) {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  const client: MessagesClient = {
    messages: {
      stream: (params) => {
        sent.push(structuredClone(params));
        const content = replies[Math.min(i++, replies.length - 1)]!;
        const message = { id: `m${i}`, type: "message", role: "assistant", model: "fake", content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message;
        return { finalMessage: async () => message };
      },
    },
  };
  return { client, sent };
}
const tool = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as unknown as Anthropic.ContentBlock;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Anthropic.ContentBlock;

describe("an exchange with the assistant", () => {
  it("carries out the model's tool calls on the page and sends each answer back, until it answers in words", async () => {
    const calls: unknown[][] = [];
    const { client, sent } = scripted([
      [tool("t1", "describe_figure", {})],
      [tool("t2", "add_bonds", { between: "Nb-Nb", up_to: 3.2 }), tool("t3", "change_bonds", { between: "Nb-Nb", fill_triangles: true, triangle_colour: "#2f6fd6" })],
      [text("Done: Nb–Nb bonds up to 3.2 Å with their triangles filled in blue (Structure › Bonds, Visual › Bonds).")],
    ]);
    const events: AssistantEvent[] = [];
    const history = await exchange(client, "fake", [], "Show the Nb4 clusters in blue", page(calls), (e) => events.push(e));
    expect(calls).toEqual([
      ["add", "Nb", "Nb", 3.2],
      ["change", "Nb-Nb", { fillTriangles: true, triangleColour: "#2f6fd6" }],
    ]);
    expect(sent.length).toBe(3);
    expect(sent[0]!.tools!.map((t) => (t as { name: string }).name)).toContain("describe_figure");
    // Each tool call's answer is in the next request, matched by id.
    const lastSent = sent[2]!.messages[sent[2]!.messages.length - 1]!;
    expect((lastSent.content as { tool_use_id: string }[]).map((r) => r.tool_use_id)).toEqual(["t2", "t3"]);
    expect(events.filter((e) => e.kind === "tool").map((e) => (e as { name: string }).name)).toEqual(["describe_figure", "add_bonds", "change_bonds"]);
    expect(events[events.length - 1]).toEqual({ kind: "text", text: "Done: Nb–Nb bonds up to 3.2 Å with their triangles filled in blue (Structure › Bonds, Visual › Bonds)." });
    // The conversation goes on from here: user, assistant, results, assistant, results, assistant.
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
  });

  it("stops after MAX_STEPS calls and still answers every call, so the conversation can go on", async () => {
    const { client } = scripted([[tool("loop", "describe_figure", {})]]);
    const events: AssistantEvent[] = [];
    const history = await exchange(client, "fake", [], "loop", page([]), (e) => events.push(e));
    expect(events.filter((e) => e.kind === "tool").length).toBe(MAX_STEPS);
    expect(events[events.length - 1]!.kind).toBe("stopped");
    const last = history[history.length - 1]!;
    expect(last.role).toBe("user");
    expect((last.content as { is_error: boolean }[])[0]!.is_error).toBe(true);
  });

  it("says plainly when the model answered without changing anything", async () => {
    const { client } = scripted([[tool("t1", "describe_figure", {})], [text("I have changed the colour to blue.")]]);
    const events: AssistantEvent[] = [];
    await exchange(client, "fake", [], "Make the arrows blue", page([]), (e) => events.push(e));
    expect(events[events.length - 1]).toEqual({ kind: "stopped", reason: "Nothing on the figure was changed." });
  });

  it("stops at once when the user stops it", async () => {
    const { client, sent } = scripted([[text("never")]]);
    const controller = new AbortController();
    controller.abort();
    const events: AssistantEvent[] = [];
    await exchange(client, "fake", [], "x", page([]), (e) => events.push(e), controller.signal);
    expect(sent.length).toBe(0);
    expect(events).toEqual([{ kind: "stopped", reason: "Stopped." }]);
  });
});
