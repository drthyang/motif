// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The Assistant tab: say how the figure should look, and the assistant changes it with the page's own controls,
 * saying where each one is. The connection (Claude with your key, or a local model) is chosen here; the key and
 * the choice stay in this browser.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { CLAUDE_MODELS, clientFor, describeError, exchange, type AssistantConfig, type AssistantEvent, type Transport } from "../agent/assistant";
import { DEFAULT_LMSTUDIO_URL, ensureLmStudioContext, listLmStudioModels } from "../agent/lmstudio";
import { DEFAULT_OLLAMA_URL, listOllamaModels } from "../agent/ollama";
import type { Page } from "../agent/tools";

const CONFIG_KEY = "motif.assistant";
const API_KEY = "motif.assistant.key";

interface Stored {
  transport: Transport;
  model: string;
  serverUrl: string;
}

const readStored = (): Stored => {
  try {
    const s = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}") as Partial<Stored>;
    return { transport: s.transport ?? "ollama", model: s.model ?? "", serverUrl: s.serverUrl ?? "" };
  } catch {
    return { transport: "ollama", model: "", serverUrl: "" };
  }
};

type Line = { who: "you"; text: string } | { who: "assistant"; event: AssistantEvent } | { who: "error"; text: string };

/** A short line for a tool call, in plain words. */
function toolLine(e: Extract<AssistantEvent, { kind: "tool" }>): string {
  if (e.name === "describe_figure") return "Looked at the figure.";
  if (e.name === "find_setting") return `Looked for a setting: ${(e.input as { words?: string }).words ?? ""}.`;
  return e.isError ? `Could not: ${e.result}` : e.result.replace(/^Done: /, "");
}

export function AssistantPanel({ page }: { page: Page }) {
  const [stored, setStored] = useState<Stored>(readStored);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY) ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [modelNote, setModelNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [history, setHistory] = useState<MessageParam[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(() => !localStorage.getItem(CONFIG_KEY));
  const stop = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const keep = (s: Stored) => {
    setStored(s);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(s));
  };

  // The models the chosen server offers (those that can call tools), or Claude's.
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setModelNote("");
    if (stored.transport === "api-key") {
      setModels(CLAUDE_MODELS.map((m) => m.id));
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
        setModelNote(`Could not reach ${stored.transport === "ollama" ? "Ollama" : "LM Studio"} at ${url}. Is it running?`);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [stored.transport, stored.serverUrl]);

  const model = models.includes(stored.model) ? stored.model : (models[0] ?? "");
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const words = text.trim();
    if (!words || busy) return;
    const config: AssistantConfig = { transport: stored.transport, model, ...(stored.serverUrl ? { serverUrl: stored.serverUrl } : {}), ...(apiKey ? { apiKey } : {}) };
    if (!model) {
      setLines((l) => [...l, { who: "error", text: "Choose a model first (Setup)." }]);
      setShowSetup(true);
      return;
    }
    setText("");
    setLines((l) => [...l, { who: "you", text: words }]);
    setBusy(true);
    stop.current = new AbortController();
    try {
      // LM Studio loads a model with its own default context when first asked, which can be far too small for the
      // tools and instructions (the prompt is then cut without a word): load it with room first (MATERIA's helper).
      if (stored.transport === "lmstudio") {
        const { notice } = await ensureLmStudioContext(stored.serverUrl || DEFAULT_LMSTUDIO_URL, model, stop.current.signal);
        if (notice) setLines((l) => [...l, { who: "assistant", event: { kind: "stopped", reason: notice } }]);
      }
      const next = await exchange(clientFor(config), model, history, words, page, (event) => setLines((l) => [...l, { who: "assistant", event }]), stop.current.signal);
      setHistory(next);
    } catch (error) {
      if (!stop.current.signal.aborted) setLines((l) => [...l, { who: "error", text: describeError(error, config) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="assistant" data-testid="assistant">
      <div className="assistant-head">
        <span className="sub">
          {stored.transport === "api-key" ? "Claude" : stored.transport === "ollama" ? "Ollama" : "LM Studio"}
          {model ? ` · ${model}` : ""}
        </span>
        <span className="row">
          <button className="plain-text" data-testid="assistant-setup" onClick={() => setShowSetup((x) => !x)}>
            {showSetup ? "Done" : "Setup"}
          </button>
          {lines.length > 0 && (
            <button
              className="plain-text"
              data-testid="assistant-clear"
              disabled={busy}
              onClick={() => {
                setLines([]);
                setHistory([]);
              }}
            >
              New chat
            </button>
          )}
        </span>
      </div>

      {showSetup && (
        <div className="assistant-setup rule">
          <div className="row">
            <span className="lab">model from</span>
            <select data-testid="assistant-transport" value={stored.transport} onChange={(e) => keep({ ...stored, transport: e.target.value as Transport, model: "" })}>
              <option value="ollama">Ollama (on this computer)</option>
              <option value="lmstudio">LM Studio (on this computer)</option>
              <option value="api-key">Claude (your API key)</option>
            </select>
          </div>
          {stored.transport === "api-key" ? (
            <div className="row">
              <span className="lab">API key</span>
              <input
                type="password"
                className="grow"
                data-testid="assistant-key"
                placeholder="sk-ant-…"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  localStorage.setItem(API_KEY, e.target.value);
                }}
              />
            </div>
          ) : (
            <div className="row">
              <span className="lab">server</span>
              <input
                type="text"
                className="grow"
                data-testid="assistant-server"
                placeholder={stored.transport === "ollama" ? DEFAULT_OLLAMA_URL : DEFAULT_LMSTUDIO_URL}
                value={stored.serverUrl}
                onChange={(e) => keep({ ...stored, serverUrl: e.target.value })}
              />
            </div>
          )}
          <div className="row">
            <span className="lab">model</span>
            <select data-testid="assistant-model" value={model} onChange={(e) => keep({ ...stored, model: e.target.value })}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          {modelNote && <p className="sub">{modelNote}</p>}
          <p className="sub">
            {stored.transport === "api-key"
              ? "Your key stays in this browser and goes only to Anthropic. What the assistant reads about the figure (the cell, the elements, the settings) is sent to Anthropic with your words."
              : "Nothing leaves this computer. A local server must allow this page: for Ollama, set OLLAMA_ORIGINS to this page's address."}
          </p>
        </div>
      )}

      <div className="assistant-lines" data-testid="assistant-lines">
        {lines.length === 0 && (
          <p className="sub">
            Say how the figure should look, for example: “make the Se atoms smaller”, “show the Nb–Nb bonds and fill the triangles in blue”, “look along [110]”, “size it for Physical Review, half a column”. The assistant changes the controls and says where each one is.
          </p>
        )}
        {lines.map((l, i) =>
          l.who === "you" ? (
            <p key={i} className="said you">{l.text}</p>
          ) : l.who === "error" ? (
            <p key={i} className="said error">{l.text}</p>
          ) : l.event.kind === "text" ? (
            <p key={i} className="said assistant">{l.event.text}</p>
          ) : l.event.kind === "tool" ? (
            <p key={i} className={`said step${l.event.isError ? " failed" : ""}`}>{toolLine(l.event)}</p>
          ) : (
            <p key={i} className="said step">{l.event.reason}</p>
          ),
        )}
        {busy && <p className="said step">…</p>}
        <div ref={end} />
      </div>

      <form className="assistant-input" onSubmit={send}>
        <textarea
          data-testid="assistant-text"
          rows={2}
          placeholder="How should the figure look?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) void send(e);
          }}
        />
        {busy ? (
          <button type="button" data-testid="assistant-stop" onClick={() => stop.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="button primary" data-testid="assistant-send" disabled={!text.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
