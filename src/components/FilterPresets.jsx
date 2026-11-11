import { useRef, useState } from "react";
import { Bookmark, ChevronDown, X } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { invoke } from "../lib/ipc.js";
import { describeFilter } from "../lib/filters.js";
import { ICON, useDismiss } from "./ui.jsx";

/**
 * Named sets of document filters, per corpus (metadata differs between
 * corpora), stored in preferences.json beside saved searches. Shared by every
 * FilterEditor: the Search query panel, the Counts view and the Compare view.
 */
const complete = (f) => !!describeFilter(f);
const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

export function FilterPresets({ corpus, filters, onChange }) {
  const { toast, prefs, setPrefs } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef(null);
  const trigger = useRef(null);
  const list = prefs?.filter_presets?.[corpus] || [];
  const usable = filters.filter(complete);
  const taken = list.some((p) => p.name === name.trim());

  useDismiss(open, setOpen, ref, trigger);

  if (!list.length && !usable.length) return null; // nothing to apply and nothing to save

  // The backend validates every filter and answers with all presets; adopt that copy.
  const save = async (next) => {
    try {
      const all = await invoke("set_filter_presets", { corpus, presets: next });
      setPrefs((p) => (p ? { ...p, filter_presets: all } : p));
      return true;
    } catch (e) {
      toast(`Could not save presets: ${e.message}`, "negative");
      return false;
    }
  };
  const add = async () => {
    const n = name.trim();
    if (!n || !usable.length) return;
    if (await save([...list.filter((p) => p.name !== n), { name: n, filters: usable }].sort(byName))) {
      setName("");
      toast(`Saved filter preset “${n}” for ${corpus}.`, "positive", 4000);
    }
  };
  const apply = (p) => {
    const before = filters;
    onChange(p.filters.map((f) => ({ ...f })));
    setOpen(false);
    trigger.current?.focus();
    if (before.some(complete)) toast(`Applied “${p.name}”.`, "neutral", 7000, { label: "Undo", onClick: () => onChange(before) });
  };
  const remove = async (p) => {
    if (await save(list.filter((x) => x.name !== p.name)))
      toast(`Deleted preset “${p.name}”.`, "neutral", 7000, {
        label: "Undo",
        // Re-add to whatever the list is by then, not the list at deletion time.
        onClick: () => invoke("get_preferences").then((cur) => save([...(cur.filter_presets?.[corpus] || []).filter((x) => x.name !== p.name), p].sort(byName))),
      });
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
