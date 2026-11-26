// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The in-page assistant: how it reaches a model, and one exchange with it.
 *
 * Models as in MATERIA (the user's choice, 2026-11-24): Claude, OpenAI or Gemini with the user's own API key, sent
 * from this browser straight to that provider; or a local model on Ollama or LM Studio, on which nothing leaves the
 * computer. With a key, what the tools report (the cell, the elements, the settings) goes to that provider. The
 * connection code for the local servers is MATERIA's (localServer.ts, ollama.ts, ollamaNative.ts, lmstudio.ts);
 * OpenAI and Gemini go through one translation to their Chat Completions API (openaiCompatible.ts).
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
import { chatCompletionsClient, PROVIDERS, ProviderError } from "./openaiCompatible";
import { pageMapText } from "./pageMap";
import { describeCall, runTool, TOOLS, type Page } from "./tools";

/** "api-key" is Claude with the user's key; "openai" and "gemini" likewise with theirs. */
export type Transport = "api-key" | "openai" | "gemini" | "ollama" | "lmstudio";

/** Connections that need the user's key. */
export const KEYED: readonly Transport[] = ["api-key", "openai", "gemini"];

export interface AssistantConfig {
  readonly transport: Transport;
  readonly model: string;
  /** The user's key for Claude, OpenAI or Gemini; kept in this browser. */
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

/**
 * The context window, in tokens, for the meter: a local model as it is loaded (Ollama at LOCAL_CONTEXT; LM Studio as
 * ensureLmStudioContext reports), Claude's 200k, and the usual sizes of OpenAI's and Gemini's current models (marked
 * as approximate: the companies' models differ).
 */
export function contextWindow(transport: Transport, loaded?: number | null): { size: number; approximate: boolean } {
  if (transport === "ollama") return { size: LOCAL_CONTEXT, approximate: false };
  if (transport === "lmstudio") return { size: loaded ?? LOCAL_CONTEXT, approximate: loaded == null };
  if (transport === "api-key") return { size: 200_000, approximate: false };
  if (transport === "openai") return { size: 128_000, approximate: true };
  return { size: 1_000_000, approximate: true };
}

/** Most tool calls in one exchange. */
export const MAX_STEPS = 12;
/** Context a local model is run with, and the longest answer, in tokens. */
const LOCAL_CONTEXT = 32_768;
const MAX_ANSWER = 2048;

export const SYSTEM_PROMPT = `You are the assistant inside MOTIF, a browser app that draws crystal structures as figures for papers and slides.
The user tells you how they want the figure to look; you make the change with your tools, then say in one or two short sentences what you changed and where that control is on the page (the tools' answers say where), so the user learns where to find it.

${pageMapText()}

How to answer:
- Short: one to three sentences. Asked what you can do, give at most six short lines, one per kind of change, each with where it is, then one example request.
- Name places exactly as written above (e.g. "Visual › Atoms"). Never name a place that is not listed above.
- Plain text, as the page shows it: no Markdown headings or bold, no LaTeX (write μB, Å, °). A list is short lines starting with "- ".

Rules:
- Call describe_figure before your first change, to see the elements, bonds, pairs and settings as they are now.
- To find a setting, call find_setting with a few words; change it with change_settings, using exactly the names and kinds of value find_setting gives.
- Element colours and sizes: set_element. Bonds: add_bonds (choose up_to from the distances describe_figure lists for that pair), change_bonds, remove_bonds. View: set_view. Cells shown: set_cells. Journal sizes: use_journal.
- Change only what the user asked for. If a request could mean two different things, ask one short question instead of guessing.
- You cannot open files or save figures (SVG, PNG): tell the user to use Open file and Save SVG / Save PNG at the top. You can save the structure itself (save_structure: CIF, POSCAR, XYZ, extended XYZ).
- Magnetic moments: only as the user states them (set_moments). If a size or direction is missing, ask; never invent a magnetic order.
- If a tool answers with an error, read it, correct the call once, or tell the user plainly what did not work.
- If what the user asked cannot be done, say why and offer the nearest alternative; do not carry out the alternative until the user agrees.
- Colours are "#rrggbb". Distances are in angstrom.`;

/** The client for the chosen connection. */
export function clientFor(config: AssistantConfig): MessagesClient {
  if (config.transport === "ollama") {
    // Ollama through its native chat (the only endpoint that takes a context length), with plain headers.
    return new Anthropic({ apiKey: "ollama", baseURL: ollamaBase(config.serverUrl ?? ""), dangerouslyAllowBrowser: true, maxRetries: 1, fetch: ollamaNativeFetch(() => ({ numCtx: LOCAL_CONTEXT, numPredict: MAX_ANSWER })) });
  }
  if (config.transport === "lmstudio") {
    return new Anthropic({ apiKey: "lmstudio", baseURL: lmstudioBase(config.serverUrl ?? ""), dangerouslyAllowBrowser: true, maxRetries: 1, fetch: plainFetch });
  }
  if (config.transport === "openai" || config.transport === "gemini") {
    if (!config.apiKey) throw new Error(`No API key. Add your ${PROVIDERS[config.transport].name} key in the assistant's Setup, or choose a local model.`);
    return chatCompletionsClient(config.transport, config.apiKey);
  }
  if (!config.apiKey) throw new Error("No API key. Add your Anthropic key in the assistant's Setup, or choose a local model.");
  return new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** What happens during an exchange, for the drawer to show as it goes. */
export type AssistantEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly input: unknown; readonly result: string; readonly isError: boolean }
  | { readonly kind: "stopped"; readonly reason: string }
  /** What it is doing now ("Thinking…", "Changing: …"): shown while it works, not kept in the conversation. */
  | { readonly kind: "working"; readonly what: string }
  /** How much of the model's context the conversation used in the last request, in tokens (estimated when the server gives no count). */
  | { readonly kind: "usage"; readonly used: number; readonly estimated: boolean };

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
  /**
   * Ask mode (the user's choice, 2026-11-26; Auto, the default, has none): asked before each change to the figure,
   * with the call in plain words; a change declined is not made, and the model is told so. Looking (describe_figure,
   * find_setting) is never asked.
   */
  approve?: (call: { readonly name: string; readonly input: Record<string, unknown>; readonly words: string }) => Promise<boolean>,
): Promise<MessageParam[]> {
  const messages: MessageParam[] = [...history, { role: "user", content: userText }];
  // Whether any tool changed the page in this exchange. A model can say it changed something without calling a tool
  // (a small one did); the page then says plainly that nothing was changed, rather than let the words stand alone.
  let changed = false;
  // Asked once for an answer in words after a reply that had none.
  let nudged = false;
  const finish = () => {
    if (!changed) onEvent({ kind: "stopped", reason: "Nothing on the figure was changed." });
    return messages;
  };
  for (let step = 0; ; step++) {
    if (signal?.aborted) {
      onEvent({ kind: "stopped", reason: "Stopped." });
      return messages;
    }
    onEvent({ kind: "working", what: "Thinking…" });
    const reply = await client.messages
      .stream({ model, max_tokens: MAX_ANSWER, system: SYSTEM_PROMPT, tools: TOOLS as unknown as Anthropic.Tool[], messages }, signal ? { signal } : undefined)
      .finalMessage();
    messages.push({ role: "assistant", content: reply.content });
    // The context in use: the request's tokens and the reply's. A server that gives no count (an OpenAI-compatible
    // one) gets an estimate from the text, about 3.5 characters a token.
    const counted = (reply.usage?.input_tokens ?? 0) + (reply.usage?.output_tokens ?? 0);
    const estimate = Math.round((SYSTEM_PROMPT.length + JSON.stringify(TOOLS).length + JSON.stringify(messages).length) / 3.5);
    onEvent({ kind: "usage", used: reply.usage?.input_tokens ? counted : estimate, estimated: !reply.usage?.input_tokens });
    for (const block of reply.content) if (block.type === "text" && block.text.trim()) onEvent({ kind: "text", text: block.text.trim() });
    const calls = reply.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const said = reply.content.some((b) => b.type === "text" && b.text.trim() !== "");
    // A model that thinks first can put its whole answer in its thinking and return no words and no tool call
    // (gemma4 and qwen did, now and then): ask once for the answer in words, rather than leave the user with nothing.
    if (calls.length === 0 && !said && !nudged) {
      nudged = true;
      messages.push({ role: "user", content: "Please give your answer to me in words now (plain text, short)." });
      continue;
    }
    if (calls.length === 0) return finish();
    if (step >= MAX_STEPS) {
      onEvent({ kind: "stopped", reason: `Stopped after ${MAX_STEPS} steps; ask again to go on.` });
      // Every tool call needs its answer, so the conversation can go on.
      messages.push({ role: "user", content: calls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: "Not carried out: the step limit was reached.", is_error: true })) });
      return messages;
    }
    const results: ToolResultBlockParam[] = [];
    for (const c of calls) {
      const input = (c.input ?? {}) as Record<string, unknown>;
      const words = describeCall(c.name, input);
      const looking = LOOKING.includes(c.name);
      if (approve && !looking) {
        onEvent({ kind: "working", what: "Waiting for your answer…" });
        if (!(await approve({ name: c.name, input, words }))) {
          const text = "The user declined this change, so it was not made. Do not make it again; ask what they would like instead, or go on with the rest.";
          onEvent({ kind: "tool", name: c.name, input: c.input, result: `Declined: ${words}`, isError: false });
          results.push({ type: "tool_result", tool_use_id: c.id, content: text });
          continue;
        }
      }
      onEvent({ kind: "working", what: looking ? "Looking at the figure…" : `Changing: ${words}` });
      const r = runTool(page, c.name, input);
      if (!r.isError && !looking) changed = true;
      onEvent({ kind: "tool", name: c.name, input: c.input, result: r.text, isError: r.isError === true });
      results.push({ type: "tool_result", tool_use_id: c.id, content: r.text, ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
}

/** A readable sentence for a failed request. */
export function describeError(e: unknown, config: AssistantConfig): string {
  if (config.transport === "openai" || config.transport === "gemini") {
    const { name, company } = PROVIDERS[config.transport];
    if (e instanceof ProviderError) {
      if (e.status === 401 || e.status === 403 || /api key/i.test(e.message)) return `The ${name} key was rejected. Check it in the assistant's Setup.`;
      if (e.status === 429) return `${company} says too many requests, or the key's quota is used up: ${e.message}`;
      return `${company} answered with an error: ${e.message}`;
    }
    if (e instanceof TypeError && /fetch/i.test(e.message)) return `Could not reach ${company} from this browser.`;
    return e instanceof Error ? e.message : String(e);
  }
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
