import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Copy, Download, Trash2, X } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke, saveDialog } from "../lib/ipc.js";
import { Button, ICON, Segmented } from "./ui.jsx";
import { thousands } from "../lib/format.js";
import { TerminalBlock } from "./TerminalBlock.jsx";

const STATUS_COLOR = {
  ok: "var(--positive)",
  cached: "var(--info)",
  pending: "var(--warning)",
  error: "var(--negative)",
  cancelled: "var(--warning)",
  info: "var(--text-3)",
};

const time = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

function Block({ label, text, meta, tone }) {
  const { toast } = useApp();
  if (!text) return null;
  return (
    <div className="console-block">
      <div className="console-block__head">
        <span>{label}</span>
        {meta && <span className="console-block__meta">{meta}</span>}
        <button type="button" className="btn btn--ghost btn--icon console-copy" aria-label={`Copy ${label}`} title="Copy"
          onClick={() => navigator.clipboard?.writeText(text).then(() => toast(`${label} copied`, "neutral", 2000))}>
          <Copy {...ICON} size={13} />
        </button>
      </div>
      <pre className={`console-pre${tone ? ` console-pre--${tone}` : ""}`}>{text}</pre>
    </div>
  );
}

function Entry({ e, open, onToggle }) {
  return (
    <li className="console-entry" data-status={e.status}>
      <button type="button" className="console-row" aria-expanded={open} onClick={onToggle}>
        <ChevronRight {...ICON} size={13} className="console-row__chev" aria-hidden="true" />
        <span className="console-row__time">{time(e.at)}</span>
        <span className="dot" style={{ background: STATUS_COLOR[e.status], color: STATUS_COLOR[e.status], width: 7, height: 7 }} aria-hidden="true" />
        <span className="console-row__op">{e.kind === "event" ? e.op : `${e.op}`}</span>
        <span className="console-row__summary">{e.summary}</span>
        <span className="console-row__time">
          {e.status === "pending" ? "running…" : e.elapsed_seconds != null ? `${e.elapsed_seconds.toFixed(2)} s` : ""}
          {e.status === "cached" ? " · cached" : ""}
        </span>
        <span className="sr-only">status {e.status}</span>
      </button>
      {open && (
        <div className="console-detail">
          {e.kind === "event" ? (
            <Block label="Event" text={e.summary} />
          ) : (
            <>
              {e.request && <TerminalBlock payload={e.request} compact />}
              <Block label="SSH exec (what the app ran)" text={e.exec} />
              <Block label="Request → stdin" text={e.request ? JSON.stringify(e.request, null, 2) : null} />
              <Block label="Response ← stdout" text={e.response} meta={`${thousands(e.response_bytes)} bytes${e.response_truncated ? " · truncated to 64 KB in this log" : ""}`} />
              <Block label="stderr" text={e.stderr} tone="warn" />
              <Block label="Error" text={e.error} tone="neg" />
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function ConsolePanel() {
  const { consoleOpen, setConsoleOpen, consoleLog, clearConsole, toast } = useApp();
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(() => new Set());
  const [height, setHeight] = useState(() => {
    try {
      return Number(localStorage.getItem("cqp.consoleHeight")) || 300;
    } catch {
      return 300;
    }
  });
  const listRef = useRef(null);
  const stick = useRef(true);

  const shown = useMemo(
    () =>
      consoleLog.filter((e) =>
        filter === "errors" ? ["error", "cancelled"].includes(e.status) : filter === "requests" ? e.kind === "request" : true
      ),
    [consoleLog, filter]
  );
  const errors = consoleLog.filter((e) => e.status === "error").length;

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown, consoleOpen]);

  const startDrag = (ev) => {
    ev.preventDefault();
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
    const y0 = ev.clientY, h0 = height;
    const move = (e) => setHeight(Math.max(140, Math.min(window.innerHeight - 160, h0 + (y0 - e.clientY))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setHeight((h) => {
        try {
          localStorage.setItem("cqp.consoleHeight", String(h));
        } catch {
          /* convenience only */
        }
        return h;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!consoleOpen) return null;
  return (
    <section className="console" style={{ height }} aria-label="Request console">
      <div
        className="console__grip"
        onPointerDown={startDrag}
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label="Resize console (arrow keys)"
        aria-valuenow={Math.round(height)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const h = Math.max(140, Math.min(window.innerHeight - 160, height + (e.key === "ArrowUp" ? 40 : -40)));
            setHeight(h);
            try { localStorage.setItem("cqp.consoleHeight", String(h)); } catch { /* convenience only */ }
          }
        }}
      />
      <header className="console__bar">
        <span className="console__title">Console</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
          {consoleLog.length} {consoleLog.length === 1 ? "entry" : "entries"}{errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""} · this session, in memory
        </span>
        <span className="spacer" />
        <Segmented small value={filter} onChange={setFilter} label="Filter console" options={[["all", "All"], ["requests", "Requests"], ["errors", "Errors"]]} />
        <Button variant="ghost" icon={Download} title="Save the log (.log/.json) or every request as runnable commands (.sh/.cqp)"
          onClick={async () => {
            const path = await saveDialog({ defaultPath: "hapax-console.log", filters: [{ name: "Text log", extensions: ["log", "txt"] }, { name: "JSON", extensions: ["json"] }, { name: "Shell script (all requests)", extensions: ["sh"] }, { name: "CQP commands (all requests)", extensions: ["cqp"] }] });
            if (!path) return;
            try {
              await invoke("export_console_log", { path });
              toast(`Console saved to ${path}`, "positive");
            } catch (e) {
              toast(e.message, "negative");
            }
          }}>Save…</Button>
        <Button variant="ghost" icon={Trash2} onClick={() => { clearConsole(); setExpanded(new Set()); }}>Clear</Button>
        <Button variant="ghost" icon={X} aria-label="Close console" title="Close (Ctrl+`)" onClick={() => setConsoleOpen(false)} />
      </header>
      <ul
        className="console__list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {shown.length === 0 && (
          <li className="console-empty mono">
            {consoleLog.length ? "No entries match this filter." : "Nothing yet. Connect or run a search — every command sent to the server and its reply appear here."}
          </li>
        )}
        {shown.map((e) => (
          <Entry key={e.id} e={e} open={expanded.has(e.id)}
            onToggle={() => setExpanded((s) => { const n = new Set(s); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n; })} />
        ))}
      </ul>
    </section>
  );
}
