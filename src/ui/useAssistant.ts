// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The assistant's conversation and connection, held once for the page: the drawer under the side tabs and the Assistant
 * tab (setup and the whole conversation) both show this one. The connection choice and the keys stay in this browser.
 */

import { useEffect, useRef, useState } from "react";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { CLAUDE_MODELS, clientFor, describeError, exchange, KEYED, type AssistantConfig, type AssistantEvent, type Transport } from "../agent/assistant";
import { DEFAULT_LMSTUDIO_URL, ensureLmStudioContext, listLmStudioModels } from "../agent/lmstudio";
import { DEFAULT_OLLAMA_URL, listOllamaModels } from "../agent/ollama";
import { listChatModels, PROVIDERS } from "../agent/openaiCompatible";
import type { Page } from "../agent/tools";

const CONFIG_KEY = "motif.assistant";
/** Where each key is kept in this browser (Claude's under the name it has had from the start). */
const KEY_STORE: Record<string, string> = { "api-key": "motif.assistant.key", openai: "motif.assistant.key.openai", gemini: "motif.assistant.key.gemini" };
const DRAWER_KEY = "motif.assistant.drawer";

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
  /** The drawer under the side tabs is open. */
  readonly drawerOpen: boolean;
  readonly setTransport: (t: Transport) => void;
  readonly setServerUrl: (url: string) => void;
  readonly setModel: (model: string) => void;
  readonly setApiKey: (key: string) => void;
  readonly setDrawerOpen: (open: boolean) => void;
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
  const [drawerOpen, setDrawerOpenState] = useState(() => read(DRAWER_KEY) !== "shut");
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
  }, [stored.transport, stored.serverUrl, apiKey]);

  // With OpenAI or Gemini any model's name may be typed; otherwise the choice must be one offered.
  const model = keyed && stored.transport !== "api-key" ? stored.model || (models[0] ?? "") : models.includes(stored.model) ? stored.model : (models[0] ?? "");

  const send = async (text: string): Promise<boolean> => {
    const words = text.trim();
    if (!words || busy) return false;
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
        const { notice } = await ensureLmStudioContext(stored.serverUrl || DEFAULT_LMSTUDIO_URL, model, controller.signal);
        if (notice) setLines((l) => [...l, { who: "assistant", event: { kind: "stopped", reason: notice } }]);
      }
      const next = await exchange(clientFor(config), model, history, words, page, (event) => setLines((l) => [...l, { who: "assistant", event }]), controller.signal);
      setHistory(next);
    } catch (error) {
      if (!controller.signal.aborted) setLines((l) => [...l, { who: "error", text: describeError(error, config) }]);
      else setLines((l) => [...l, { who: "assistant", event: { kind: "stopped", reason: "Stopped." } }]);
    } finally {
      setBusy(false);
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
    drawerOpen,
    setTransport: (transport) => keep({ ...stored, transport, model: "" }),
    setServerUrl: (serverUrl) => keep({ ...stored, serverUrl }),
    setModel: (m) => keep({ ...stored, model: m }),
    setApiKey: (key) => {
      setKeys((k) => ({ ...k, [stored.transport]: key }));
      write(KEY_STORE[stored.transport]!, key);
    },
    setDrawerOpen: (open) => {
      setDrawerOpenState(open);
      write(DRAWER_KEY, open ? "open" : "shut");
    },
    send,
    stop: () => stopper.current?.abort(),
    clear: () => {
      setLines([]);
      setHistory([]);
    },
  };
}
