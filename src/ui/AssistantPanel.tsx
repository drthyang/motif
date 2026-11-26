// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The assistant on the page: say how the figure should look, and it changes the figure with the page's own
 * controls, saying where each one is. The conversation lives in the drawer at the foot of the side panel, under
 * every tab, so the figure stays in full view; the Assistant tab holds only the connection (Claude, OpenAI or
 * Gemini with your key, or Ollama / LM Studio on this computer). The user's layout, 2026-11-26: the drawer on its
 * own, the context meter and the Auto / Ask switch at its foot, as in Claude.
 */

import { replyBlocks, type Span } from "../agent/reply";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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


/** The conversation, kept scrolled to its end. */
export function ChatLines({ lines, busy, activity, empty }: { lines: readonly Line[]; busy: boolean; activity: string; empty: ReactNode }) {
  const end = useRef<HTMLDivElement>(null);
  // In braces: newer browsers return a promise from scrollIntoView, and an effect may return only a clean-up.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [lines, busy]);
  return (
    <>
      {lines.length === 0 && <div className="sub chat-empty">{empty}</div>}
      {lines.map((l, i) =>
        l.who === "you" ? (
          <p key={i} className="said you">{l.text}</p>
        ) : l.who === "error" ? (
          <p key={i} className="said error">{l.text}</p>
        ) : l.event.kind === "text" ? (
          <Reply key={i} text={l.event.text} />
        ) : l.event.kind === "tool" ? (
          <p key={i} className={`said step${l.event.isError ? " failed" : ""}`}>{toolLine(l.event)}</p>
        ) : l.event.kind === "stopped" ? (
          <p key={i} className="said step">{l.event.reason}</p>
        ) : null,
      )}
      {busy && (
        <p className="said working" data-testid="assistant-working">
          {activity || "Working…"}
        </p>
      )}
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
        placeholder={chat.ready ? "Ask for a change, e.g. “size it for Nature, one column”" : "Set up a model first"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={chat.engage}
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

/** The Assistant tab: the connection only (the conversation is in the drawer). */
export function AssistantPanel({ chat, shown }: { chat: AssistantChat; shown: boolean }) {
  // The Assistant tab shown (it stays mounted when hidden): the person has turned to the assistant, so its local
  // server may be contacted.
  const { engage } = chat;
  useEffect(() => {
    if (shown) engage();
  }, [shown, engage]);
  const keyed = KEYED.includes(chat.transport);
  const provider = chat.transport === "openai" || chat.transport === "gemini" ? PROVIDERS[chat.transport] : null;
  return (
    <div className="assistant-panel" data-testid="assistant">
      <div className="assistant-head">
        <span className="sub">{connectionName(chat)}</span>
        <span className="row">
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

      <p className="sub">Talk to the assistant in the drawer at the foot of the side panel. It changes the figure with the page's own controls and says where each one is.</p>
    </div>
  );
}

/** What the drawer says before a conversation: how to start, or what is missing. */
function DrawerStart({ chat, onSetup }: { chat: AssistantChat; onSetup: () => void }) {
  if (!chat.ready)
    return (
      <>
        <p>The assistant changes this figure for you: colours, bonds, orbitals, the view, the cells shown, a journal's size.</p>
        <p>
          It needs a model: Claude, OpenAI or Gemini with your own key, or one on this computer (Ollama, LM Studio).{" "}
          <button className="plain-text" data-testid="drawer-start-setup" onClick={onSetup}>
            Set up a model
          </button>
        </p>
        {chat.modelNote && <p>{chat.modelNote}</p>}
      </>
    );
  return (
    <>
      <p>Say what the figure should show, for example:</p>
      <ul>
        <li>“Size it for Physical Review, one column”</li>
        <li>“Draw the Mn–O bonds and the octahedra round Mn”</li>
        <li>“Look along [110] and make the O atoms smaller”</li>
      </ul>
    </>
  );
}

/** The drawer at the foot of the side panel: a bar when shut; open, the conversation, the input, and at its foot the
 * Auto / Ask switch and the context meter. */
export function AssistantDrawer({ chat, onSetup }: { chat: AssistantChat; onSetup: () => void }) {
  const open = chat.drawerOpen;
  return (
    <div className={`drawer${open ? " open" : ""}`} data-testid="drawer" role="region" aria-label="Assistant">
      <div className="drawer-head">
        <button className="drawer-toggle" data-testid="drawer-toggle" aria-expanded={open} title={open ? "Shut the assistant's drawer" : "Open the assistant's drawer"} onClick={() => chat.setDrawerOpen(!open)}>
          <b>Assistant</b>
          <span className="sub drawer-model">{chat.ready ? connectionName(chat) : "not set up"}</span>
          {chat.busy && !open && <span className="sub">{chat.pending ? "waiting for you…" : "working…"}</span>}
          <span className="drawer-chevron" aria-hidden="true">{open ? "▾" : "▴"}</span>
        </button>
        {open && (
          <span className="drawer-actions">
            <button className="plain-text" data-testid="drawer-setup" onClick={onSetup}>
              Setup
            </button>
            {chat.lines.length > 0 && (
              <button className="plain-text" data-testid="drawer-clear" disabled={chat.busy} onClick={chat.clear}>
                New chat
              </button>
            )}
          </span>
        )}
      </div>
      {open && (
        <>
          <div className="drawer-lines" data-testid="drawer-lines">
            <ChatLines lines={chat.lines} busy={chat.busy && !chat.pending} activity={chat.activity} empty={<DrawerStart chat={chat} onSetup={onSetup} />} />
            {chat.pending && (
              <div className="approve" data-testid="approve">
                <p>
                  <b>Allow this change?</b> {chat.pending}
                </p>
                <span className="row">
                  <button className="button primary" data-testid="approve-allow" onClick={() => chat.answer(true)}>
                    Allow
                  </button>
                  <button data-testid="approve-deny" onClick={() => chat.answer(false)}>
                    Deny
                  </button>
                </span>
              </div>
            )}
          </div>
          <ChatInput chat={chat} onSetup={onSetup} prefix="drawer" rows={1} className="drawer-input" />
          <div className="drawer-foot">
            <span className="mode-switch" role="radiogroup" aria-label="How changes are made" title="Auto: the assistant makes each change at once. Ask: it shows each change and waits for you to allow it.">
              {(["auto", "ask"] as const).map((m) => (
                <button key={m} role="radio" aria-checked={chat.mode === m} className={chat.mode === m ? "on" : ""} data-testid={`mode-${m}`} onClick={() => chat.setMode(m)}>
                  {m === "auto" ? "Auto" : "Ask"}
                </button>
              ))}
            </span>
            <ContextMeter chat={chat} />
          </div>
        </>
      )}
    </div>
  );
}

/** A reply as paragraphs, lists and bold (agent/reply.ts); never inserted as HTML. */
function Reply({ text }: { text: string }) {
  const line = (spans: readonly Span[]) => spans.map((s, k) => (s.bold ? <b key={k}>{s.text}</b> : s.code ? <code key={k}>{s.text}</code> : <span key={k}>{s.text}</span>));
  return (
    <div className="said assistant">
      {replyBlocks(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>
            {b.lines.map((l, k) => (
              <span key={k}>
                {k > 0 && <br />}
                {line(l)}
              </span>
            ))}
          </p>
        ) : b.kind === "ul" ? (
          <ul key={i}>{b.items.map((it, k) => <li key={k}>{line(it)}</li>)}</ul>
        ) : (
          <ol key={i}>{b.items.map((it, k) => <li key={k}>{line(it)}</li>)}</ol>
        ),
      )}
    </div>
  );
}

/** How much of the model's context the conversation uses: "context 7.4k of 32k". Amber from 70 %, red from 90 %. */
export function ContextMeter({ chat }: { chat: AssistantChat }) {
  const c = chat.context;
  if (!c) return null;
  const k = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n));
  const share = Math.min(1, c.used / c.size);
  const level = share >= 0.9 ? " full" : share >= 0.7 ? " filling" : "";
  const title =
    `The conversation uses ${c.estimated ? "about " : ""}${c.used.toLocaleString()} of ${c.approximate ? "about " : ""}${c.size.toLocaleString()} tokens of the model's context` +
    `${c.estimated ? " (estimated: this server gives no count)" : ""}. Near the end the model starts to lose the beginning; New chat starts again.`;
  return (
    <span className={`context-meter${level}`} data-testid="context-meter" title={title}>
      <span className="context-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(2, share * 100)}%` }} />
      </span>
      {c.estimated ? "~" : ""}
      {k(c.used)} / {c.approximate ? "~" : ""}
      {k(c.size)}
    </span>
  );
}
