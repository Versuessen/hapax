import { useEffect, useState } from "react";
import { ChevronRight, Code2, Copy, Download, SquareTerminal } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke, saveDialog } from "../lib/ipc.js";
import { ICON, Segmented } from "./ui.jsx";

/** Terminal commands for a request, fetched from the backend (debounced). */
function useTerminalText({ op, request, payload, style, enabled = true }) {
  const [text, setText] = useState(null);
  const [error, setError] = useState(null);
  const key = JSON.stringify([op, request, payload, style, enabled]);
  useEffect(() => {
    if (!enabled) { setText(null); setError(null); return; }
    let live = true;
    const t = setTimeout(() => {
      const call = payload
        ? invoke("terminal_from_payload", { payload, style })
        : invoke("terminal_commands", { op, request, style });
      call.then((s) => live && (setText(s), setError(null))).catch((e) => live && (setText(null), setError(e.message)));
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { text, error };
}

const readLS = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* per-viewer convenience only */ } };

async function saveText({ text, cqp, toast }) {
  const path = await saveDialog({ defaultPath: cqp ? "cqp-query.cqp" : "cqp-query.sh", filters: [{ name: cqp ? "CQP commands" : "Shell script", extensions: [cqp ? "cqp" : "sh", "txt"] }] });
  if (!path) return;
  try { await invoke("save_text", { path, text }); toast(`Saved ${path}`, "positive"); } catch (e) { toast(e.message, "negative"); }
}

/**
 * The one "Query" disclosure on Search: the generated CQP and the same query
 * as commands for your own SSH session. Closed, the bar still shows the CQP
 * on one line; a validation error is always shown, never folded away.
 */
export function QueryPanel({ preview, error, op, request, errorId = "query-error", empty = "Type a value to see the generated CQP." }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(() => readLS("hapax.query.open", readLS("hapax.term.open", "0")) === "1");
  const [view, setView] = useState(() => readLS("hapax.query.view", "cqp"));
  const canTerm = !!request && !!preview && !error;
  // Closed, the bar shows (and copies) the CQP; the other views exist only when open.
  const shown = open && canTerm ? view : "cqp";
  const term = useTerminalText({ op, request, style: shown === "shell" ? "shell" : "cqp", enabled: canTerm && shown !== "cqp" && open });
  const cqp = preview?.cqp_command || "";
  // The peek drops the "CORPUS;" activation and "GUIQuery =" so a narrow bar shows the query itself.
  const peek = cqp.replace(/^[^;]*;\s*/, "").replace(/^\w+\s*=\s*/, "").replace(/;\s*$/, "");
  const text = shown === "cqp" ? cqp : term.text;
  const toggle = () => setOpen((o) => { writeLS("hapax.query.open", o ? "0" : "1"); return !o; });
  const pick = (v) => { setView(v); writeLS("hapax.query.view", v); if (v !== "cqp") writeLS("cqp.termStyle", v === "shell" ? "shell" : "cqp"); };
  const VIEWS = [["cqp", "CQP"], ["prompt", "cqp> prompt"], ["shell", "Shell script"]];

  return (
    <div className={`term query-panel${open ? "" : " is-closed"}`}>
      <div className="term__bar">
        <button type="button" className="term__toggle" aria-expanded={open} aria-controls={open ? "query-panel-body" : undefined} onClick={toggle}>
          <ChevronRight {...ICON} size={14} className="term__chev" aria-hidden="true" />
          <Code2 {...ICON} size={14} aria-hidden="true" />
          <span>Query</span>
        </button>
        {!open && (
          <code className="query-panel__peek" title={cqp || undefined}>
            {error ? "" : peek || empty}
          </code>
        )}
        <span className="spacer" />
        {open && canTerm && <Segmented small value={shown} onChange={pick} label="Show the query as" options={VIEWS} />}
        <button type="button" className="btn btn--ghost btn--icon" aria-label={shown === "cqp" ? "Copy CQP" : "Copy commands"} title="Copy" disabled={!text || !!error}
          onClick={() => navigator.clipboard?.writeText(text).then(() => toast(shown === "cqp" ? "CQP copied" : "Commands copied — paste them into your SSH session", "positive", 3000))}>
          <Copy {...ICON} size={14} />
        </button>
        {open && (
          <button type="button" className="btn btn--ghost btn--icon" aria-label="Save to a file" title="Save…" disabled={!text || !!error}
            onClick={() => saveText({ text, cqp: shown !== "shell", toast })}>
            <Download {...ICON} size={14} />
          </button>
        )}
      </div>
      {error && <pre id={errorId} className="term__pre term__pre--err" role="alert">{error}</pre>}
      {open && !error && (
        <div id="query-panel-body">
          <pre className="term__pre" aria-live="polite">{shown === "cqp" ? (cqp || empty) : term.error || (term.text ?? "…")}</pre>
          <div className="query-panel__note">
            {shown === "cqp"
              ? "Generated from the form and validated · read-only. Exactly what runs on the server."
              : "Paste into your own SSH session on the server. Same validated query as the GUI runs."}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Copy-paste commands for your own SSH session, generated by the backend from
 * the same validated request the GUI runs. Pass either `op` + `request`
 * (not yet run) or `payload` (a request logged in the console).
 */
export function TerminalBlock({ op, request, payload, compact }) {
  const { toast } = useApp();
  const [style, setStyle] = useState(() => readLS("cqp.termStyle", "cqp"));
  // In the console the commands are the point; elsewhere they start folded away (remembered).
  const [open, setOpen] = useState(() => compact || readLS("hapax.term.open", "0") === "1");
  const toggle = () => setOpen((o) => { writeLS("hapax.term.open", o ? "0" : "1"); return !o; });
  const { text, error } = useTerminalText({ op, request, payload, style });
  const pick = (v) => { setStyle(v); writeLS("cqp.termStyle", v); };

  return (
    <div className={`term${open ? "" : " is-closed"}`}>
      <div className="term__bar">
        {compact ? (
          <>
            <SquareTerminal {...ICON} size={14} aria-hidden="true" />
            <span>Terminal</span>
          </>
        ) : (
          <button type="button" className="term__toggle" aria-expanded={open} onClick={toggle}>
            <ChevronRight {...ICON} size={14} className="term__chev" aria-hidden="true" />
            <SquareTerminal {...ICON} size={14} aria-hidden="true" />
            <span>Run this in your own SSH terminal</span>
          </button>
        )}
        <span className="spacer" />
        <Segmented small value={style} onChange={pick} label="Command style" options={[["cqp", "cqp> prompt"], ["shell", "Shell script"]]} />
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Copy commands" title="Copy" disabled={!text}
          onClick={() => navigator.clipboard?.writeText(text).then(() => toast("Commands copied — paste them into your SSH session", "positive", 3000))}>
          <Copy {...ICON} size={14} />
        </button>
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Save commands to a file" title="Save…" disabled={!text}
          onClick={() => saveText({ text, cqp: style !== "shell", toast })}>
          <Download {...ICON} size={14} />
        </button>
      </div>
      {open && (error ? <pre className="term__pre term__pre--err" role="alert">{error}</pre> : <pre className="term__pre">{text ?? "…"}</pre>)}
    </div>
  );
}
