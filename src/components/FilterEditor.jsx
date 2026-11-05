import { useMemo, useState } from "react";
import { ListFilter, Plus, X } from "lucide-react";
import { useApp } from "../state/store.jsx";
import { MAX_FILTERS } from "../lib/filters.js";
import { thousands } from "../lib/format.js";
import { ICON, Input, Select } from "./ui.jsx";

const MAX_LISTED_REGIONS = 10000; // same limit as the backend's metadata decoding
const valueCache = new Map(); // `${corpus}/${attr}` -> [{ value, regions, tokens }]

/** "text_publication_date" -> "Publication date · text_publication_date". */
export function attrLabel(a) {
  let words = a.split("_").filter(Boolean);
  if (words[0] === "text" && words.length > 2) words = words.slice(1); // text_publication_date -> publication date
  const EXPAND = { u: "utterance", s: "sentence", n: "number of", rec: "recording", id: "ID", cefr: "CEFR" };
  const human = words.map((w) => EXPAND[w] ?? w).join(" ").replace(/^\w/, (c) => c.toUpperCase());
  return human.toLowerCase() === a.replace(/_/g, " ").toLowerCase() && !/_/.test(a) ? a : `${human} · ${a}`;
}

const OPS = [["is", "is"], ["not", "is not"], ["years", "year from–to"]];
const splitValues = (v) => String(v || "").split("|").map((x) => x.trim()).filter(Boolean);

/**
 * Document filters for one corpus: every row must hold (AND). Values are
 * exact; several values in one row (picked from the list or typed with |)
 * mean any of them (OR).
 */
export function FilterEditor({ corpus, filters, onChange, idPrefix = "flt", compact = false }) {
  const { info, run } = useApp();
  const ci = info?.corpora?.[corpus];
  const attrs = ci?.metadata || [];
  const [open, setOpen] = useState(null); // index of the row whose value list is open
  const set = (i, patch) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  if (!attrs.length) {
    return <div className="muted" style={{ fontSize: "var(--fs-mono)" }}>{corpus} has no document metadata to filter by.</div>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {filters.map((f, i) => (
        <div key={i} className="filter-row">
          <Select small aria-label={`Filter ${i + 1}: attribute`} value={f.attr} options={[["", "Choose attribute…"], ...attrs.map((a) => [a, attrLabel(a)])]}
            onChange={(e) => { set(i, { attr: e.target.value, value: "" }); setOpen(null); }} />
          <Select small aria-label={`Filter ${i + 1}: condition`} value={f.op || "is"} options={OPS} onChange={(e) => set(i, { op: e.target.value })} />
          {f.op === "years" ? (
            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <Input mono type="number" aria-label={`Filter ${i + 1}: from year`} placeholder="from" value={f.from ?? ""} min={1000} max={2100}
                onChange={(e) => set(i, { from: e.target.value === "" ? null : Number(e.target.value) })} />
              <span className="muted">–</span>
              <Input mono type="number" aria-label={`Filter ${i + 1}: to year`} placeholder="to" value={f.to ?? ""} min={1000} max={2100}
                onChange={(e) => set(i, { to: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
          ) : (
            <Input id={`${idPrefix}-v${i}`} aria-label={`Filter ${i + 1}: values`} value={f.value} placeholder={f.attr ? "value · several with |" : ""}
              disabled={!f.attr} spellCheck={false} maxLength={4000} onChange={(e) => set(i, { value: e.target.value })} />
          )}
          <button type="button" className="btn btn--ghost btn--icon" title="Pick from the values in the corpus" aria-label={`Filter ${i + 1}: pick values`}
            disabled={!f.attr || (ci.structural?.[f.attr] || 0) > MAX_LISTED_REGIONS} aria-expanded={open === i}
            onClick={async () => {
              const key = `${corpus}/${f.attr}`;
              if (!valueCache.has(key)) {
                const out = await run(`Loading values of ${f.attr}`, "run_metadata", { request: { corpus, attribute: f.attr } });
                if (!out) return;
                valueCache.set(key, out.data.groups);
              }
              setOpen(open === i ? null : i);
            }}>
            <ListFilter {...ICON} size={14} />
          </button>
          <button type="button" className="btn btn--ghost btn--icon" aria-label={`Remove filter ${i + 1}`} title="Remove filter"
            onClick={() => { onChange(filters.filter((_, j) => j !== i)); setOpen(null); }}>
            <X {...ICON} size={14} />
          </button>
          {open === i && valueCache.has(`${corpus}/${f.attr}`) && (
            <ValuePicker groups={valueCache.get(`${corpus}/${f.attr}`)} filter={f} corpusTokens={ci.tokens}
              onYears={(from, to) => set(i, { op: "years", from, to })}
              onValues={(vals) => set(i, { value: vals.join("|"), op: f.op === "years" ? "is" : f.op })} />
          )}
        </div>
      ))}
      <div className="row" style={{ gap: 10 }}>
        <button type="button" className="btn btn--ghost" disabled={filters.length >= MAX_FILTERS}
          onClick={() => onChange([...filters, { attr: "", op: "is", value: "" }])}>
          <Plus {...ICON} size={14} /> Add filter
        </button>
        {!compact && (
          <span className="muted" style={{ fontSize: "var(--fs-mono)" }}>
            {filters.length > 1 ? "Matches must meet every filter." : "Limit matches to documents, speakers or periods."}
          </span>
        )}
      </div>
    </div>
  );
}

/** Checkbox list of an attribute's stored values with their share of the corpus. */
function ValuePicker({ groups, filter, corpusTokens, onValues, onYears }) {
  const [q, setQ] = useState("");
  const chosen = new Set(splitValues(filter.value));
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? groups.filter((g) => String(g.value).toLowerCase().includes(s)) : groups).slice(0, 300);
  }, [groups, q]);
  const years = useMemo(() => {
    const ys = groups.map((g) => /^(\d{4})/.exec(String(g.value))?.[1]).filter(Boolean).map(Number);
    return ys.length >= groups.length * 0.5 ? [Math.min(...ys), Math.max(...ys)] : null;
  }, [groups]);
  const toggle = (v) => {
    const next = new Set(chosen);
    next.has(v) ? next.delete(v) : next.add(v);
    onValues([...next]);
  };
  return (
    <div className="value-picker">
      <div className="row" style={{ gap: 8 }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${groups.length} values`} aria-label="Filter values" style={{ flex: 1 }} />
        {years && (
          <button type="button" className="btn btn--ghost" onClick={() => onYears(years[0], years[1])} title="Values start with a year">
            Use year range {years[0]}–{years[1]}
          </button>
        )}
      </div>
      <ul className="value-picker__list" role="group" aria-label="Values">
        {shown.map((g) => (
          <li key={g.value}>
            <label className="check">
              <input type="checkbox" checked={chosen.has(g.value)} onChange={() => toggle(g.value)} />
              <span className="value-picker__v">{g.value || "(empty)"}</span>
              <span className="mono muted value-picker__n">{thousands(g.tokens)} tokens · {corpusTokens ? ((g.tokens / corpusTokens) * 100).toFixed(1) : "?"}%</span>
            </label>
          </li>
        ))}
        {!shown.length && <li className="muted">No value contains “{q}”.</li>}
      </ul>
    </div>
  );
}
