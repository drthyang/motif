// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The assistant's conversation and connection, held once for the page: the drawer under the side tabs and the Assistant
 * tab (setup and the whole conversation) both show this one. The connection choice and the keys stay in this browser.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { CLAUDE_MODELS, clientFor, contextWindow, describeError, exchange, KEYED, type AssistantConfig, type AssistantEvent, type Transport } from "../agent/assistant";
import { DEFAULT_LMSTUDIO_URL, ensureLmStudioContext, listLmStudioModels } from "../agent/lmstudio";
import { DEFAULT_OLLAMA_URL, listOllamaModels } from "../agent/ollama";
import { listChatModels, PROVIDERS } from "../agent/openaiCompatible";
import type { Page } from "../agent/tools";

const CONFIG_KEY = "motif.assistant";
/** Where each key is kept in this browser (Claude's under the name it has had from the start). */
const KEY_STORE: Record<string, string> = { "api-key": "motif.assistant.key", openai: "motif.assistant.key.openai", gemini: "motif.assistant.key.gemini" };
const DRAWER_KEY = "motif.assistant.drawer";
const MODE_KEY = "motif.assistant.mode";

export const TRANSPORT_NAMES: Record<Transport, string> = { "api-key": "Claude", openai: "OpenAI", gemini: "Gemini", ollama: "Ollama", lmstudio: "LM Studio" };

interface Stored {
  transport: Transport;
  model: string;
  serverUrl: string;
}

const TRANSPORTS: readonly Transport[] = ["api-key", "openai", "gemini", "ollama", "lmstudio"];

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A browser that keeps nothing (a private window): the choice lasts for this visit.
  }
};

const readStored = (): Stored => {
  try {
    const s = JSON.parse(read(CONFIG_KEY) ?? "{}") as Partial<Stored>;
    return { transport: s.transport && TRANSPORTS.includes(s.transport) ? s.transport : "ollama", model: s.model ?? "", serverUrl: s.serverUrl ?? "" };
  } catch {
    return { transport: "ollama", model: "", serverUrl: "" };
  }
};

export type Line = { who: "you"; text: string } | { who: "assistant"; event: AssistantEvent } | { who: "error"; text: string };

export interface AssistantChat {
  readonly transport: Transport;
  readonly serverUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** Models to choose from (Claude's, the provider's or the local server's). */
  readonly models: readonly string[];
  /** Why there are no models, if so. */
  readonly modelNote: string;
  /** No connection was ever chosen in this browser. */
  readonly unset: boolean;
  readonly lines: readonly Line[];
  readonly busy: boolean;
  /** How much of the model's context the conversation uses: tokens in the last request, of the window. */
  readonly context: { readonly used: number; readonly size: number; readonly estimated: boolean; readonly approximate: boolean } | null;
  /** The drawer under the side tabs is open. */
  readonly drawerOpen: boolean;
  readonly setTransport: (t: Transport) => void;
  readonly setServerUrl: (url: string) => void;
  readonly setModel: (model: string) => void;
  readonly setApiKey: (key: string) => void;
  readonly setDrawerOpen: (open: boolean) => void;
  /**
   * The person has turned to the assistant (opened its tab or drawer, clicked into its box, chose a connection or
   * sent words). Only then is a local model server contacted: a page that reached for the visitor's own computer as
   * soon as it opened would raise errors (Firefox) or a permission prompt (Chrome). The user's choice, 2026-11-26.
   */
  readonly engage: () => void;
  /** Auto: changes are made at once (the default). Ask: each change waits for the user's Allow or Deny. */
  readonly mode: "auto" | "ask";
  readonly setMode: (mode: "auto" | "ask") => void;
  /** In Ask mode, the change waiting for the user's answer, in plain words. */
  readonly pending: string | null;
  readonly answer: (allow: boolean) => void;
  /** What the assistant is doing now ("Thinking…", "Changing: …"), while busy. */
  readonly activity: string;
  /** A model is chosen and, for a keyed connection, a key given. */
  readonly ready: boolean;
  /** Send the user's words; false if nothing was sent (no words, busy, or no model chosen). */
  readonly send: (words: string) => Promise<boolean>;
  readonly stop: () => void;
  readonly clear: () => void;
}

export function useAssistant(page: Page): AssistantChat {
  const [stored, setStored] = useState<Stored>(readStored);
  const [unset, setUnset] = useState(() => read(CONFIG_KEY) === null);
  const [keys, setKeys] = useState<Record<string, string>>(() => Object.fromEntries(KEYED.map((t) => [t, read(KEY_STORE[t]!) ?? ""])));
  const [models, setModels] = useState<string[]>([]);
  const [modelNote, setModelNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [history, setHistory] = useState<MessageParam[]>([]);
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState<AssistantChat["context"]>(null);
  // LM Studio's loaded context, once known (the meter's window).
  const lmContext = useRef<number | null>(null);
  const [drawerOpen, setDrawerOpenState] = useState(() => read(DRAWER_KEY) !== "shut");
  const [engaged, setEngaged] = useState(false);
  const [mode, setModeState] = useState<"auto" | "ask">(() => (read(MODE_KEY) === "ask" ? "ask" : "auto"));
  const [pending, setPending] = useState<string | null>(null);
  const resolver = useRef<((allow: boolean) => void) | null>(null);
  const [activity, setActivity] = useState("");
  const engage = useCallback(() => setEngaged(true), []);
  const stopper = useRef<AbortController | null>(null);

  const keep = (s: Stored) => {
    setStored(s);
    setUnset(false);
    write(CONFIG_KEY, JSON.stringify(s));
  };
  const apiKey = keys[stored.transport] ?? "";
  const keyed = KEYED.includes(stored.transport);

  // The models the chosen connection offers (those that can call tools, for a local server).
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setModelNote("");
    if (stored.transport === "api-key") {
      setModels(CLAUDE_MODELS.map((m) => m.id));
      return;
    }
    if (stored.transport === "openai" || stored.transport === "gemini") {
      const { name } = PROVIDERS[stored.transport];
      setModels([]);
      if (!apiKey) {
        setModelNote(`Add your ${name} key to list its models.`);
        return;
      }
      // Wait until the key has been typed or pasted whole.
      const timer = setTimeout(() => {
        listChatModels(stored.transport as "openai" | "gemini", apiKey, controller.signal)
          .then((names) => {
            if (!alive) return;
            setModels(names);
            if (names.length === 0) setModelNote(`${name} lists no chat models for this key; type a model's name.`);
          })
          .catch(() => {
            if (!alive) return;
            setModelNote(`Could not list ${name}'s models with this key. Check the key, or type a model's name.`);
          });
      }, 500);
      return () => {
        alive = false;
        clearTimeout(timer);
        controller.abort();
      };
    }
    // A local server is contacted only once the person has turned to the assistant (see `engage`).
    if (!engaged) {
      setModels([]);
      return;
    }
    const url = stored.serverUrl || (stored.transport === "ollama" ? DEFAULT_OLLAMA_URL : DEFAULT_LMSTUDIO_URL);
    const list =
      stored.transport === "ollama"
        ? listOllamaModels(url, controller.signal).then((ms) => ms.filter((m) => m.tools).map((m) => m.name))
        : listLmStudioModels(url, controller.signal).then((ms) => ms.filter((m) => m.toolUse).map((m) => m.key));
    list
      .then((names) => {
        if (!alive) return;
        setModels(names);
        if (names.length === 0) setModelNote("This server has no model that can use tools.");
      })
      .catch(() => {
        if (!alive) return;
        setModels([]);
        setModelNote(`Could not reach ${TRANSPORT_NAMES[stored.transport]} at ${url}. Is it running?`);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [stored.transport, stored.serverUrl, apiKey, engaged]);

  // With OpenAI or Gemini any model's name may be typed; otherwise the choice must be one offered.
  const model = keyed && stored.transport !== "api-key" ? stored.model || (models[0] ?? "") : models.includes(stored.model) ? stored.model : (models[0] ?? "");

  const send = async (text: string): Promise<boolean> => {
    const words = text.trim();
    if (!words || busy) return false;
    setEngaged(true);
    const config: AssistantConfig = { transport: stored.transport, model, ...(stored.serverUrl ? { serverUrl: stored.serverUrl } : {}), ...(apiKey ? { apiKey } : {}) };
    if (!model || (keyed && !apiKey)) {
      setLines((l) => [...l, { who: "error", text: keyed && !apiKey ? `Add your ${TRANSPORT_NAMES[stored.transport]} key first (Assistant tab, Setup).` : "Choose a model first (Assistant tab, Setup)." }]);
      return false;
    }
    setLines((l) => [...l, { who: "you", text: words }]);
    setBusy(true);
    const controller = new AbortController();
    stopper.current = controller;
    try {
      // LM Studio loads a model with its own default context when first asked, which can be far too small for the
      // tools and instructions (the prompt is then cut without a word): load it with room first (MATERIA's helper).
      if (stored.transport === "lmstudio") {
        const { notice, context: loaded } = await ensureLmStudioContext(stored.serverUrl || DEFAULT_LMSTUDIO_URL, model, controller.signal);
        lmContext.current = loaded;
        if (notice) setLines((l) => [...l, { who: "assistant", event: { kind: "stopped", reason: notice } }]);
      }
      const next = await exchange(
        clientFor(config),
        model,
        history,
        words,
        page,
        (event) => {
          if (event.kind === "working") setActivity(event.what);
          else if (event.kind === "usage") {
            const window = contextWindow(stored.transport, lmContext.current);
            setContext({ used: event.used, size: window.size, estimated: event.estimated, approximate: window.approximate });
          } else setLines((l) => [...l, { who: "assistant", event }]);
        },
        controller.signal,
        mode === "ask"
          ? (call) =>
              new Promise<boolean>((resolve) => {
                resolver.current = resolve;
                setPending(call.words);
              })
          : undefined,
      );
      setHistory(next);
    } catch (error) {
      if (!controller.signal.aborted) setLines((l) => [...l, { who: "error", text: describeError(error, config) }]);
      else setLines((l) => [...l, { who: "assistant", event: { kind: "stopped", reason: "Stopped." } }]);
    } finally {
      setBusy(false);
      setActivity("");
      setPending(null);
      resolver.current = null;
    }
    return true;
  };

  return {
    transport: stored.transport,
    serverUrl: stored.serverUrl,
    apiKey,
    model,
    models,
    modelNote,
    unset,
    lines,
    busy,
    context,
    drawerOpen,
    setTransport: (transport) => keep({ ...stored, transport, model: "" }),
    setServerUrl: (serverUrl) => keep({ ...stored, serverUrl }),
    setModel: (m) => keep({ ...stored, model: m }),
    setApiKey: (key) => {
      setKeys((k) => ({ ...k, [stored.transport]: key }));
      write(KEY_STORE[stored.transport]!, key);
    },
    engage,
    setDrawerOpen: (open) => {
      if (open) setEngaged(true);
      setDrawerOpenState(open);
      write(DRAWER_KEY, open ? "open" : "shut");
    },
    mode,
    setMode: (m) => {
      setModeState(m);
      write(MODE_KEY, m);
    },
    pending,
    answer: (allow) => {
      const r = resolver.current;
      resolver.current = null;
      setPending(null);
      r?.(allow);
    },
    activity,
    ready: model !== "" && (!keyed || apiKey !== ""),
    send,
    stop: () => {
      // A change waiting for an answer is declined, so the exchange can end.
      const r = resolver.current;
      resolver.current = null;
      setPending(null);
      r?.(false);
      stopper.current?.abort();
    },
    clear: () => {
      setContext(null);
      setLines([]);
      setHistory([]);
    },
  };
}
