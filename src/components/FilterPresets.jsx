import { useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown, X } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { describeFilter } from "../lib/filters.js";
import { ICON } from "./ui.jsx";

/**
 * Named sets of document filters, per corpus (metadata differs between
 * corpora), kept on this computer. Shared by every FilterEditor: Search,
 * Count by annotation and Compare.
 */
const KEY = "hapax.filterPresets";
const readAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } };
const writeAll = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: presets unavailable */ } };
const complete = (f) => !!describeFilter(f);

export function FilterPresets({ corpus, filters, onChange }) {
  const { toast } = useApp();
  const [all, setAll] = useState(readAll);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef(null);
  const trigger = useRef(null);
  const list = all[corpus] || [];
  const usable = filters.filter(complete);
  const taken = list.some((p) => p.name === name.trim());

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  useEffect(() => { if (open) setAll(readAll()); }, [open]); // another editor may have saved one

  if (!list.length && !usable.length) return null; // nothing to apply and nothing to save

  const save = (next) => { const a = { ...readAll(), [corpus]: next }; if (!next.length) delete a[corpus]; writeAll(a); setAll(a); };
  const add = () => {
    const n = name.trim();
    if (!n || !usable.length) return;
    save([...list.filter((p) => p.name !== n), { name: n, filters: usable }].sort((a, b) => a.name.localeCompare(b.name)));
    setName("");
    toast(`Saved filter preset “${n}” for ${corpus}.`, "positive", 4000);
  };
  const apply = (p) => {
    const before = filters;
    onChange(p.filters.map((f) => ({ ...f })));
    setOpen(false);
    trigger.current?.focus();
    if (before.some(complete)) toast(`Applied “${p.name}”.`, "neutral", 7000, { label: "Undo", onClick: () => onChange(before) });
  };
  const remove = (p) => {
    save(list.filter((x) => x.name !== p.name));
    toast(`Deleted preset “${p.name}”.`, "neutral", 7000, { label: "Undo", onClick: () => save([...readAll()[corpus] || [], p].sort((a, b) => a.name.localeCompare(b.name))) });
  };

  return (
    <div ref={ref} className="presets">
      <button ref={trigger} type="button" className="btn btn--ghost" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title="Save these filters under a name, or apply saved ones">
        <Bookmark {...ICON} size={14} /> Presets{list.length ? <span className="mono muted"> {list.length}</span> : null}
        <ChevronDown {...ICON} size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="presets__menu" role="dialog" aria-label={`Filter presets for ${corpus}`}>
          {list.length ? (
            <ul className="presets__list">
              {list.map((p) => (
                <li key={p.name} className="presets__item">
                  <button type="button" className="presets__apply" onClick={() => apply(p)} title={p.filters.map(describeFilter).join(" · ")}>
                    <span>{p.name}</span>
                    <span className="presets__desc">{p.filters.map(describeFilter).join(" · ")}</span>
                  </button>
                  <button type="button" className="btn btn--ghost btn--icon presets__del" aria-label={`Delete preset ${p.name}`} title="Delete preset" onClick={() => remove(p)}>
                    <X {...ICON} size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="presets__empty">No presets for {corpus} yet.</p>
          )}
          {usable.length > 0 && (
            // A div, not a form: the editor already sits inside the query form.
            <div className="presets__save">
              <label className="presets__label" htmlFor={`preset-name-${corpus}`}>Save the current {usable.length === 1 ? "filter" : `${usable.length} filters`} as</label>
              <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <input id={`preset-name-${corpus}`} className="input input--sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
                  placeholder="e.g. spoken, 1990s" autoComplete="off"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); add(); } }} />
                <button type="button" className="btn btn--primary" disabled={!name.trim()} onClick={add}>{taken ? "Replace" : "Save"}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
