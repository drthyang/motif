// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The assistant on OpenAI or Google Gemini, with the user's own key, sent from this browser straight to the
 * provider. Both answer OpenAI's Chat Completions API (Gemini at its OpenAI-compatible address), so one
 * translation serves both: the exchange (assistant.ts) speaks the Anthropic Messages shape, and this client turns
 * each request into a chat completion and the answer back into a message. No SDK is added.
 *
 * What the translation keeps:
 *  - the instructions as the "system" message; the user's words; the model's words and tool calls;
 *  - each tool's answer as a "tool" message tied to its call (an error is marked "Error:");
 *  - the tools as functions, with the same JSON schema.
 * Gemini's thinking models return a signature with each tool call that must go back with it; it is kept here,
 * by the call's id, and sent back unchanged.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { MessagesClient } from "./assistant";

export type KeyedProvider = "openai" | "gemini";

export const PROVIDERS: Record<KeyedProvider, { readonly name: string; readonly company: string; readonly base: string; readonly keyHint: string }> = {
  openai: { name: "OpenAI", company: "OpenAI", base: "https://api.openai.com/v1", keyHint: "sk-…" },
  gemini: { name: "Gemini", company: "Google", base: "https://generativelanguage.googleapis.com/v1beta/openai", keyHint: "AIza…" },
};

/** The longest answer asked for. Reasoning models spend part of it thinking, so it is larger than for Claude. */
const MAX_COMPLETION = 8192;

/** An answer from the provider that is not a success, with its HTTP status. */
export class ProviderError extends Error {
  constructor(
    readonly provider: KeyedProvider,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const browserFetch: Fetch = (input, init) => fetch(input, init);

interface ChatToolCall {
  id?: string;
  type?: "function";
  function: { name: string; arguments: string };
  extra_content?: unknown;
}
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

/** Signatures Gemini attached to tool calls, by call id, to send back with them. */
const extras = new Map<string, unknown>();

const resultText = (content: Anthropic.ToolResultBlockParam["content"]): string =>
  typeof content === "string" ? content : (content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("\n");

/** The chat-completions body for one request of the exchange. */
export function toChatRequest(params: Anthropic.MessageCreateParamsNonStreaming, provider: KeyedProvider): Record<string, unknown> {
  const messages: ChatMessage[] = [];
  if (params.system) messages.push({ role: "system", content: typeof params.system === "string" ? params.system : params.system.map((b) => b.text).join("\n") });
  for (const m of params.messages) {
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "user") {
      // Tool answers first, each tied to its call; then any words.
      const words: string[] = [];
      for (const b of m.content) {
        if (b.type === "tool_result") messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: (b.is_error ? "Error: " : "") + resultText(b.content) });
        else if (b.type === "text") words.push(b.text);
      }
      if (words.length) messages.push({ role: "user", content: words.join("\n") });
      continue;
    }
    const words = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const calls: ChatToolCall[] = m.content.flatMap((b) =>
      b.type === "tool_use" ? [{ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }, ...(extras.has(b.id) ? { extra_content: extras.get(b.id) } : {}) }] : [],
    );
    messages.push({ role: "assistant", content: words || null, ...(calls.length ? { tool_calls: calls } : {}) });
  }
  const tools = (params.tools ?? []).map((t) => {
    const tool = t as Anthropic.Tool;
    return { type: "function", function: { name: tool.name, description: tool.description ?? "", parameters: tool.input_schema } };
  });
  return {
    model: params.model,
    messages,
    ...(tools.length ? { tools } : {}),
    // OpenAI's newer models take only max_completion_tokens; Gemini's compatible address takes max_tokens.
    ...(provider === "openai" ? { max_completion_tokens: MAX_COMPLETION } : { max_tokens: MAX_COMPLETION }),
  };
}

/** The chat completion as a message of the exchange: the words, then the tool calls. */
export function fromChatResponse(json: unknown, model: string): Anthropic.Message {
  const choice = (json as { choices?: { message?: { content?: string | null; tool_calls?: ChatToolCall[] }; finish_reason?: string }[] }).choices?.[0];
  if (!choice?.message) throw new Error("The model's server answered without a message.");
  const content: Anthropic.ContentBlock[] = [];
  const words = (choice.message.content ?? "").trim();
  if (words) content.push({ type: "text", text: words, citations: null } as Anthropic.ContentBlock);
  (choice.message.tool_calls ?? []).forEach((c, i) => {
    const id = c.id || `call_${Date.now()}_${i}`;
    if (c.extra_content !== undefined) extras.set(id, c.extra_content);
    let input: unknown = {};
    try {
      input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      // The tool answers that its input is missing, and the model can try again.
      input = {};
    }
    content.push({ type: "tool_use", id, name: c.function.name, input } as Anthropic.ContentBlock);
  });
  if (content.length === 0 && choice.finish_reason === "length") throw new Error("The model used its whole answer length before answering. Try a shorter request, or a model that thinks less.");
  const usesTools = content.some((b) => b.type === "tool_use");
  return { id: "", type: "message", role: "assistant", model, content, stop_reason: usesTools ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message;
}

async function failure(provider: KeyedProvider, res: Response): Promise<ProviderError> {
  let message = `${res.status} ${res.statusText}`.trim();
  try {
    const body = (await res.json()) as { error?: { message?: string } } | { error?: { message?: string } }[];
    const error = Array.isArray(body) ? body[0]?.error : body.error;
    if (error?.message) message = error.message;
  } catch {
    // The status alone.
  }
  return new ProviderError(provider, res.status, message);
}

/** The client the exchange uses, for OpenAI or Gemini with the user's key. */
export function chatCompletionsClient(provider: KeyedProvider, apiKey: string, fetchImpl: Fetch = browserFetch): MessagesClient {
  const base = PROVIDERS[provider].base;
  return {
    messages: {
      stream: (params, options) => ({
        finalMessage: async () => {
          const res = await fetchImpl(`${base}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(toChatRequest(params, provider)),
            ...(options?.signal ? { signal: options.signal } : {}),
          });
          if (!res.ok) throw await failure(provider, res);
          return fromChatResponse(await res.json(), params.model);
        },
      }),
    },
  };
}

/** Models offered for chat, newest first; others (speech, images, embeddings, search) are left out. */
export function chatModels(provider: KeyedProvider, json: unknown): string[] {
  const data = (json as { data?: { id?: string; created?: number }[] }).data ?? [];
  const rows = data.filter((m): m is { id: string; created?: number } => typeof m.id === "string").map((m) => ({ id: m.id.replace(/^models\//, ""), created: m.created ?? 0 }));
  const kept =
    provider === "openai"
      ? rows.filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|codex|preview-\d{4})/.test(m.id))
      : rows.filter((m) => /^gemini/.test(m.id) && !/(embedding|image|tts|live|audio|aqa|vision|computer-use|robotics)/.test(m.id));
  return kept.sort((a, b) => b.created - a.created || b.id.localeCompare(a.id)).map((m) => m.id);
}

/** The provider's models that can chat, read with the user's key (listing them costs nothing). */
export async function listChatModels(provider: KeyedProvider, apiKey: string, signal?: AbortSignal, fetchImpl: Fetch = browserFetch): Promise<string[]> {
  const res = await fetchImpl(`${PROVIDERS[provider].base}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, ...(signal ? { signal } : {}) });
  if (!res.ok) throw await failure(provider, res);
  return chatModels(provider, await res.json());
}
