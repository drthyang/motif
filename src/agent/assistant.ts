// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The in-page assistant: how it reaches a model, and one exchange with it.
 *
 * Models as in MATERIA (the user's choice, 2026-11-24): Claude with the user's own API key, sent from this browser
 * straight to the API; or a local model on Ollama or LM Studio, on which nothing leaves the computer. With Claude,
 * what the tools report (the cell, the elements, the settings) goes to Anthropic. The connection code for the local
 * servers is MATERIA's (localServer.ts, ollama.ts, ollamaNative.ts, lmstudio.ts).
 *
 * One exchange: the user's words go to the model with the tools (tools.ts); each tool it calls is carried out on the
 * page and its answer sent back, until the model answers in words, or MAX_STEPS calls have been made.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { plainFetch } from "./localServer";
import { ollamaBase } from "./ollama";
import { ollamaNativeFetch } from "./ollamaNative";
import { lmstudioBase } from "./lmstudio";
import { runTool, TOOLS, type Page } from "./tools";

export type Transport = "api-key" | "ollama" | "lmstudio";

export interface AssistantConfig {
  readonly transport: Transport;
  readonly model: string;
  /** The user's Anthropic key (api-key only); kept in this browser. */
  readonly apiKey?: string;
  /** The local server's address (Ollama or LM Studio), when not the usual one. */
  readonly serverUrl?: string;
}

/** Claude models offered (as in MATERIA). */
export const CLAUDE_MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
] as const;

/** Tools that only look; the others change the page. */
const LOOKING = ["describe_figure", "find_setting"];

/** Most tool calls in one exchange. */
export const MAX_STEPS = 12;
/** Context a local model is run with, and the longest answer, in tokens. */
const LOCAL_CONTEXT = 32_768;
const MAX_ANSWER = 2048;

export const SYSTEM_PROMPT = `You are the assistant inside MOTIF, a browser app that draws crystal structures as figures for papers and slides.
The user tells you how they want the figure to look; you make the change with your tools, then say in one or two short sentences what you changed and where that control is on the page (the tools' answers say where), so the user learns where to find it.

Rules:
- Call describe_figure before your first change, to see the elements, bonds, pairs and settings as they are now.
- To find a setting, call find_setting with a few words; change it with change_settings, using exactly the names and kinds of value find_setting gives.
- Element colours and sizes: set_element. Bonds: add_bonds (choose up_to from the distances describe_figure lists for that pair), change_bonds, remove_bonds. View: set_view. Cells shown: set_cells. Journal sizes: use_journal.
- Change only what the user asked for. If a request could mean two different things, ask one short question instead of guessing.
- You cannot open files or save figures: tell the user to use Open file and Save SVG / Save PNG at the top.
- If a tool answers with an error, read it, correct the call once, or tell the user plainly what did not work.
- Colours are "#rrggbb". Distances are in angstrom.`;

/** The client for the chosen connection. */
export function clientFor(config: AssistantConfig): Anthropic {
  if (config.transport === "ollama") {
    // Ollama through its native chat (the only endpoint that takes a context length), with plain headers.
    return new Anthropic({ apiKey: "ollama", baseURL: ollamaBase(config.serverUrl ?? ""), dangerouslyAllowBrowser: true, maxRetries: 1, fetch: ollamaNativeFetch(() => ({ numCtx: LOCAL_CONTEXT, numPredict: MAX_ANSWER })) });
  }
  if (config.transport === "lmstudio") {
    return new Anthropic({ apiKey: "lmstudio", baseURL: lmstudioBase(config.serverUrl ?? ""), dangerouslyAllowBrowser: true, maxRetries: 1, fetch: plainFetch });
  }
  if (!config.apiKey) throw new Error("No API key. Add your Anthropic key in the assistant's settings, or choose a local model.");
  return new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** What happens during an exchange, for the drawer to show as it goes. */
export type AssistantEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly input: unknown; readonly result: string; readonly isError: boolean }
  | { readonly kind: "stopped"; readonly reason: string };

/**
 * The part of the client an exchange uses (a test gives a scripted stand-in). Answers are streamed, as the local
 * servers' translation (ollamaNative.ts) returns them, and read whole with finalMessage().
 */
export interface MessagesClient {
  readonly messages: {
    readonly stream: (params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }) => { finalMessage: () => Promise<Anthropic.Message> };
  };
}

/**
 * One exchange: the user's words, then tool calls carried out on `page`, until the model answers in words.
 * Returns the conversation with this exchange added (to pass to the next one).
 */
export async function exchange(
  client: MessagesClient,
  model: string,
  history: readonly MessageParam[],
  userText: string,
  page: Page,
  onEvent: (e: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<MessageParam[]> {
  const messages: MessageParam[] = [...history, { role: "user", content: userText }];
  // Whether any tool changed the page in this exchange. A model can say it changed something without calling a tool
  // (a small one did); the page then says plainly that nothing was changed, rather than let the words stand alone.
  let changed = false;
  const finish = () => {
    if (!changed) onEvent({ kind: "stopped", reason: "Nothing on the figure was changed." });
    return messages;
  };
  for (let step = 0; ; step++) {
    if (signal?.aborted) {
      onEvent({ kind: "stopped", reason: "Stopped." });
      return messages;
    }
    const reply = await client.messages
      .stream({ model, max_tokens: MAX_ANSWER, system: SYSTEM_PROMPT, tools: TOOLS as unknown as Anthropic.Tool[], messages }, signal ? { signal } : undefined)
      .finalMessage();
    messages.push({ role: "assistant", content: reply.content });
    for (const block of reply.content) if (block.type === "text" && block.text.trim()) onEvent({ kind: "text", text: block.text.trim() });
    const calls = reply.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) return finish();
    if (step >= MAX_STEPS) {
      onEvent({ kind: "stopped", reason: `Stopped after ${MAX_STEPS} steps; ask again to go on.` });
      // Every tool call needs its answer, so the conversation can go on.
      messages.push({ role: "user", content: calls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: "Not carried out: the step limit was reached.", is_error: true })) });
      return messages;
    }
    const results: ToolResultBlockParam[] = calls.map((c) => {
      const r = runTool(page, c.name, (c.input ?? {}) as Record<string, unknown>);
      if (!r.isError && !LOOKING.includes(c.name)) changed = true;
      onEvent({ kind: "tool", name: c.name, input: c.input, result: r.text, isError: r.isError === true });
      return { type: "tool_result", tool_use_id: c.id, content: r.text, ...(r.isError ? { is_error: true } : {}) };
    });
    messages.push({ role: "user", content: results });
  }
}

/** A readable sentence for a failed request. */
export function describeError(e: unknown, config: AssistantConfig): string {
  if (config.transport !== "api-key") {
    const where = config.transport === "ollama" ? "Ollama" : "LM Studio";
    const address = config.serverUrl || (config.transport === "ollama" ? "http://localhost:11434" : "http://localhost:1234");
    if (e instanceof Anthropic.APIConnectionError || (e instanceof TypeError && /fetch/i.test(e.message))) return `Could not reach ${where} at ${address}. Is it running, and does it allow this page (its CORS setting)?`;
  }
  if (e instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check it in the assistant's settings.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by the API. Wait a moment and try again.";
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API from this browser.";
  if (e instanceof Anthropic.APIError) return `The model's server answered with an error: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
