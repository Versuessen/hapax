import { useId, useRef, useState } from "react";
import { ChevronDown, FileDown } from "lucide-react";
import { thousands } from "../lib/format.js";
import { useUiState } from "../lib/uiState.js";
import { ICON, useDismiss } from "./ui.jsx";

/** Most rows one export may hold (EXPORT_MAX in commands.rs). */
export const EXPORT_MAX = 250_000;
/** Rows per server request (SEARCH_LIMIT in corpora.rs). */
const CHUNK = 5000;

/**
 * One "Export…" menu for a result: the rows on screen ("This page"), or the
 * first N of the whole result, chosen by number or with a preset (10%, half,
 * all up to EXPORT_MAX). The server is asked in requests of 5,000 rows.
 */
export function ExportMenu({ total = 0, unit = "matches", onPage, pageLabel = "This page", pageRows = 0, onExport, disabled = false, sortNote = "in the current sort order", placement = "up" }) {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useUiState("export.count", CHUNK);
  const [text, setText] = useState("");
  const ref = useRef(null);
  const trigger = useRef(null);
  const id = useId();
  useDismiss(open, setOpen, ref, trigger);

  const cap = Math.min(total, EXPORT_MAX);
  const parsed = Number(String(text).replace(/[\s,._']/g, ""));
  const valid = Number.isInteger(parsed) && parsed >= 1;
  const n = valid ? Math.min(parsed, cap) : 0;
  const requests = Math.ceil(n / CHUNK);

  const presets = [
    total > 1000 && [1000, "1,000"],
    total >= 20 && [Math.ceil(total * 0.1), "10%"],
    total >= 4 && [Math.ceil(total * 0.5), "50%"],
    [cap, total > EXPORT_MAX ? `All (max ${thousands(EXPORT_MAX)})` : "All"],
  ].filter(Boolean).filter(([v], i, a) => v <= cap && a.findIndex(([w]) => w === v) === i);

  const toggle = () => {
    if (!open) setText(String(Math.min(last || CHUNK, cap) || cap));
    setOpen((o) => !o);
  };
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const go = () => {
    if (!n) return;
    setLast(n);
    close();
    onExport(n);
  };

  return (
    <div ref={ref} className={`export-menu${placement === "down" ? " export-menu--down" : ""}`}>
      <button ref={trigger} type="button" className="btn" aria-haspopup="dialog" aria-expanded={open} onClick={toggle} disabled={disabled}>
        <FileDown {...ICON} aria-hidden="true" /> Export…
        <ChevronDown {...ICON} size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="export-menu__pop" role="dialog" aria-label="Export">
          {onPage && (
            <button type="button" className="export-menu__page" disabled={!pageRows} onClick={() => { close(); onPage(); }}>
              <span>{pageLabel}</span>
              <span className="export-menu__desc">{thousands(pageRows)} rows, as shown</span>
            </button>
          )}
          <form className="export-menu__all" onSubmit={(e) => { e.preventDefault(); go(); }}>
            <label htmlFor={`${id}-n`} className="export-menu__label">
              First <span className="muted">of {thousands(total)} {unit}</span>
            </label>
            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <input id={`${id}-n`} className="input mono export-menu__n" inputMode="numeric" autoComplete="off" autoFocus value={text}
                aria-describedby={`${id}-hint`} onChange={(e) => setText(e.target.value)} onFocus={(e) => e.target.select()} />
              <span className="muted" style={{ fontSize: "var(--fs-small)" }}>{unit}</span>
            </div>
            <div className="export-menu__presets" role="group" aria-label="Presets">
              {presets.map(([v, label]) => (
                <button key={label} type="button" className={`chip-toggle${n === v ? " is-on" : ""}`} aria-pressed={n === v}
                  title={`${thousands(v)} ${unit}`} onClick={() => setText(String(v))}>{label}</button>
              ))}
            </div>
            <div id={`${id}-hint`} className="export-menu__hint">
              {!valid && text.trim() ? "Type a whole number." : (
                <>The first {thousands(n)} {unit} {sortNote}{parsed > cap ? ` (at most ${thousands(cap)})` : ""}
                  {requests > 1 ? ` · ${requests} server requests; Stop cancels` : ""}.</>
              )}
            </div>
            <button type="submit" className="btn btn--primary" disabled={!n}>Export {thousands(n)} {unit}…</button>
          </form>
        </div>
      )}
    </div>
  );
}
