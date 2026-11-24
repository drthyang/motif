// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The assistant on the page: say how the figure should look, and it changes the figure with the page's own
 * controls, saying where each one is. The chatbox (at the figure's lower right) is where one talks to it; the
 * Assistant tab holds the connection (Claude, OpenAI or Gemini with your key, or Ollama / LM Studio on this
 * computer) and the whole conversation. Both show the one conversation of useAssistant.ts.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CLAUDE_MODELS, KEYED, type AssistantEvent, type Transport } from "../agent/assistant";
import { DEFAULT_LMSTUDIO_URL } from "../agent/lmstudio";
import { DEFAULT_OLLAMA_URL } from "../agent/ollama";
import { PROVIDERS } from "../agent/openaiCompatible";
import { TRANSPORT_NAMES, type AssistantChat, type Line } from "./useAssistant";

/** A short line for a tool call, in plain words. */
function toolLine(e: Extract<AssistantEvent, { kind: "tool" }>): string {
  if (e.name === "describe_figure") return "Looked at the figure.";
  if (e.name === "find_setting") return `Looked for a setting: ${(e.input as { words?: string }).words ?? ""}.`;
  return e.isError ? `Could not: ${e.result}` : e.result.replace(/^Done: /, "");
}

const EXAMPLES = "“make the Se atoms smaller”, “show the Nb–Nb bonds and fill the triangles in blue”, “look along [110]”, “size it for Physical Review, half a column”";

/** The conversation, kept scrolled to its end. */
export function ChatLines({ lines, busy, empty }: { lines: readonly Line[]; busy: boolean; empty: string }) {
  const end = useRef<HTMLDivElement>(null);
  // In braces: newer browsers return a promise from scrollIntoView, and an effect may return only a clean-up.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [lines, busy]);
  return (
    <>
      {lines.length === 0 && <p className="sub">{empty}</p>}
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
    </>
  );
}

/** Where the user types; Enter sends, Shift+Enter starts a new line. */
function ChatInput({ chat, onSetup, prefix, rows, className }: { chat: AssistantChat; onSetup: () => void; prefix: string; rows: number; className: string }) {
  const [text, setText] = useState("");
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const words = text;
    if (!words.trim() || chat.busy) return;
    setText("");
    if (!(await chat.send(words))) {
      setText(words);
      onSetup();
    }
  };
  return (
    <form className={className} onSubmit={send}>
      <textarea
        data-testid={`${prefix}-text`}
        rows={rows}
        placeholder="How should the figure look?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) void send(e);
        }}
      />
      {chat.busy ? (
        <button type="button" data-testid={`${prefix}-stop`} onClick={chat.stop}>
          Stop
        </button>
      ) : (
        <button type="submit" className="button primary" data-testid={`${prefix}-send`} disabled={!text.trim()}>
          Send
        </button>
      )}
    </form>
  );
}

const connectionName = (chat: AssistantChat) => `${TRANSPORT_NAMES[chat.transport]}${chat.model ? ` · ${chat.model}` : ""}`;

/** The Assistant tab: the connection, and the whole conversation, which can be carried on here too. */
export function AssistantPanel({ chat }: { chat: AssistantChat }) {
  const keyed = KEYED.includes(chat.transport);
  const provider = chat.transport === "openai" || chat.transport === "gemini" ? PROVIDERS[chat.transport] : null;
  return (
    <div className="assistant-panel" data-testid="assistant">
      <div className="assistant-head">
        <span className="sub">{connectionName(chat)}</span>
        <span className="row">
          {!chat.boxOpen && (
            <button className="plain-text" data-testid="assistant-open-box" onClick={() => chat.setBoxOpen(true)}>
              Open the chatbox
            </button>
          )}
          {chat.lines.length > 0 && (
            <button className="plain-text" data-testid="assistant-clear" disabled={chat.busy} onClick={chat.clear}>
              New chat
            </button>
          )}
        </span>
      </div>

      <div className="assistant-setup rule">
        <div className="row">
          <span className="lab">model from</span>
          <select data-testid="assistant-transport" value={chat.transport} onChange={(e) => chat.setTransport(e.target.value as Transport)}>
            <option value="ollama">Ollama (on this computer)</option>
            <option value="lmstudio">LM Studio (on this computer)</option>
            <option value="api-key">Claude (your API key)</option>
            <option value="openai">OpenAI (your API key)</option>
            <option value="gemini">Gemini (your API key)</option>
          </select>
        </div>
        {keyed ? (
          <div className="row">
            <span className="lab">API key</span>
            <input
              type="password"
              className="grow"
              data-testid="assistant-key"
              placeholder={provider ? provider.keyHint : "sk-ant-…"}
              autoComplete="off"
              value={chat.apiKey}
              onChange={(e) => chat.setApiKey(e.target.value)}
            />
          </div>
        ) : (
          <div className="row">
            <span className="lab">server</span>
            <input
              type="text"
              className="grow"
              data-testid="assistant-server"
              placeholder={chat.transport === "ollama" ? DEFAULT_OLLAMA_URL : DEFAULT_LMSTUDIO_URL}
              value={chat.serverUrl}
              onChange={(e) => chat.setServerUrl(e.target.value)}
            />
          </div>
        )}
        <div className="row">
          <span className="lab">model</span>
          {provider ? (
            // Any model's name may be typed; the list is what the key can use.
            <>
              <input type="text" className="grow" data-testid="assistant-model" list="assistant-models" placeholder={chat.models[0] ?? "model name"} value={chat.model} onChange={(e) => chat.setModel(e.target.value)} />
              <datalist id="assistant-models">
                {chat.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          ) : (
            <select data-testid="assistant-model" value={chat.model} onChange={(e) => chat.setModel(e.target.value)}>
              {chat.models.map((m) => (
                <option key={m} value={m}>
                  {CLAUDE_MODELS.find((c) => c.id === m)?.label ?? m}
                </option>
              ))}
            </select>
          )}
        </div>
        {chat.modelNote && <p className="sub" data-testid="assistant-model-note">{chat.modelNote}</p>}
        <p className="sub">
          {keyed
            ? `Your key stays in this browser and goes only to ${provider ? provider.company : "Anthropic"}. What the assistant reads about the figure (the cell, the elements, the settings) is sent to ${provider ? provider.company : "Anthropic"} with your words.`
            : "Nothing leaves this computer. A local server must allow this page: for Ollama, set OLLAMA_ORIGINS to this page's address."}
        </p>
      </div>

      <div className="assistant-lines" data-testid="assistant-lines">
        <ChatLines lines={chat.lines} busy={chat.busy} empty={`Say how the figure should look, here or in the chatbox at the figure's lower right, for example: ${EXAMPLES}. The assistant changes the controls and says where each one is.`} />
      </div>
      <ChatInput chat={chat} onSetup={() => undefined} prefix="assistant" rows={2} className="assistant-input" />
    </div>
  );
}

/** The chatbox over the figure's lower right corner; folded, a small button. */
export function AssistantChatbox({ chat, onSetup }: { chat: AssistantChat; onSetup: () => void }) {
  if (!chat.boxOpen) {
    return (
      <button className="chatbox-fab" data-testid="chatbox-open" title="Ask the assistant to change the figure" onClick={() => chat.setBoxOpen(true)}>
        Assistant
      </button>
    );
  }
  return (
    <div className="chatbox" data-testid="chatbox" role="dialog" aria-label="Assistant">
      <div className="chatbox-head">
        <b>Assistant</b>
        <span className="sub chatbox-model" title={connectionName(chat)}>
          {connectionName(chat)}
        </span>
        <span className="chatbox-actions">
          <button className="plain-text" data-testid="chatbox-setup" onClick={onSetup}>
            Setup
          </button>
          {chat.lines.length > 0 && (
            <button className="plain-text" data-testid="chatbox-clear" disabled={chat.busy} onClick={chat.clear}>
              New
            </button>
          )}
          <button className="chatbox-fold" data-testid="chatbox-fold" title="Fold the chatbox" aria-label="Fold the chatbox" onClick={() => chat.setBoxOpen(false)}>
            ▾
          </button>
        </span>
      </div>
      <div className="chatbox-lines" data-testid="chatbox-lines">
        <ChatLines lines={chat.lines} busy={chat.busy} empty={chat.unset ? "Choose a model in Setup, then say how the figure should look." : "How should the figure look? For example: “look along [110]”."} />
      </div>
      <ChatInput chat={chat} onSetup={onSetup} prefix="chatbox" rows={1} className="chatbox-input" />
    </div>
  );
}
