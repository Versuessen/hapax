import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { invoke } from "../lib/ipc.js";
import { CODE_FIELDS, cqpContext, currentSegment, suggestCodes } from "../lib/cqp.js";
import { FIELD_LABELS } from "./QueryBuilder.jsx";

/**
 * Autocomplete for the query form: annotation codes in Value boxes (type a
 * code or a meaning such as "verb"), and attributes, codes and keywords while
 * writing CQP. The list shows only while something is being chosen: it hides
 * when the current value is a complete code, and comes back after | or /.
 */

const glossaries = new Map(); // corpus -> Promise<{ pos, class, usas, rel }>
const CATEGORY = { POS: "pos", Class: "class", USAS: "usas", Dependency: "rel" };

export function useCodes(corpus) {
  const [codes, setCodes] = useState(null);
  useEffect(() => {
    if (!corpus) return;
    let live = true;
    if (!glossaries.has(corpus)) {
      glossaries.set(corpus, invoke("get_glossary", { corpus }).then((rows) => {
        const out = { pos: [], class: [], usas: [], rel: [] };
        for (const r of rows) if (CATEGORY[r.category]) out[CATEGORY[r.category]].push({ code: r.code, label: r.label });
        return out;
      }).catch(() => { glossaries.delete(corpus); return null; }));
    }
    glossaries.get(corpus).then((c) => live && setCodes(c));
    return () => { live = false; };
  }, [corpus]);
  return codes;
}

/** The floating list. `items`: [{ code, label, kind }]. */
function SuggestList({ id, items, active, onPick, label, more = 0, short = false }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <ul ref={ref} id={id} className={`suggest${short ? " suggest--short" : ""}`} role="listbox" aria-label={label}>
      {items.map((it, i) => (
        <li key={`${it.kind}:${it.code}`} id={`${id}-${i}`} role="option" aria-selected={i === active}
          className={`suggest__item${it.kind === "group" ? " suggest__item--group" : ""}`}
          onMouseDown={(e) => { e.preventDefault(); onPick(it); }}>
          <span className="suggest__code mono">{it.code}</span>
          {it.label && <span className="suggest__label">{it.label}</span>}
        </li>
      ))}
      {more > 0 && <li role="presentation" className="suggest__more">{more} more — keep typing to narrow the list</li>}
    </ul>
  );
}

/** Shared keyboard handling for an input or textarea with a SuggestList. */
function useListKeys(items, open, setOpen, pick) {
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [items.length, open]);
  const onKeyDown = (e) => {
    if (!items.length || !open) {
      if (e.key === "ArrowDown" && items.length) { e.preventDefault(); setOpen(true); setActive(0); }
      return false;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); return true; }
    if ((e.key === "Enter" || e.key === "Tab") && active >= 0 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation(); pick(items[active]); return true;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return true; }
    return false;
  };
  return { active, onKeyDown };
}

/**
 * A Value box with code suggestions when `field` holds codes (pos, class,
 * usas, rel). For other fields it is a plain input.
 */
export const CodeInput = forwardRef(function CodeInput({ field, codes, value, onChange, className = "", onKeyDown, ...rest }, fwd) {
  const own = useRef(null);
  const ref = fwd || own;
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const list = CODE_FIELDS.includes(field) ? codes?.[field] : null;
  const seg = currentSegment(value, Math.min(caret, value.length));
  const items = open && list ? suggestCodes(list, seg.text) : [];
  const pick = (it) => {
    const s = currentSegment(value, Math.min(caret, value.length));
    const next = value.slice(0, s.start) + it.code + value.slice(s.end);
    onChange(next);
    const at = s.start + it.code.length;
    setCaret(at);
    requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(at, at); } });
  };
  const keys = useListKeys(items, open, setOpen, pick);
  const shown = items.length > 0;
  return (
    <div className="suggest-wrap">
      <input ref={ref} className={`input ${className}`} value={value} autoComplete="off"
        role={list ? "combobox" : undefined} aria-autocomplete={list ? "list" : undefined}
        aria-expanded={list ? shown : undefined} aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && keys.active >= 0 ? `${listId}-${keys.active}` : undefined}
        onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setOpen(true); }}
        onSelect={(e) => setCaret(e.target.selectionStart ?? value.length)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (!keys.onKeyDown(e)) onKeyDown?.(e); }}
        {...rest} />
      {shown && <SuggestList id={listId} items={items} active={keys.active} onPick={pick} label={`${FIELD_LABELS[field] || field} codes`} />}
    </div>
  );
});

const TOP_KEYWORDS = [
  ["within", "limit matches to one region, e.g. within s"],
  ["cut", "keep only the first N matches, e.g. cut 100"],
  ["expand", "widen each match, e.g. expand to s"],
];

// Regions people limit matches to most, first; annotated attributes (text_id…) last.
const REGION_ORDER = ["s", "p", "u", "text", "utterance", "sp", "div"];
const rank = (a) => (REGION_ORDER.includes(a) ? REGION_ORDER.indexOf(a) : a.includes("_") ? 100 : 50);

/** Suggestions for the caret position in typed CQP. */
function cqpItems(ctx, info, codes) {
  if (!ctx || !info) return [];
  const has = (arr, t) => arr.some((x) => x.code === t);
  const pref = (arr) => {
    const t = ctx.text.toLowerCase();
    const out = arr.filter((x) => x.code.toLowerCase().startsWith(t));
    return t && has(out, ctx.text) && out.length === 1 ? [] : out;
  };
  const positional = info.positional.map((p) => ({ code: p, label: FIELD_LABELS[p] || "", kind: "attr" }));
  const meta = (info.metadata || []).map((m) => ({ code: m, label: "document or region attribute", kind: "attr" }));
  switch (ctx.kind) {
    case "value":
      return ctx.attr && CODE_FIELDS.includes(ctx.attr) && info.positional.includes(ctx.attr) ? suggestCodes(codes?.[ctx.attr], ctx.text, { regex: true }) : [];
    case "attr":
      return pref([...positional, { code: "_", label: "this word (as in _.text_genre)", kind: "attr" }]);
    case "meta":
      return pref(ctx.anchor === "match" || ctx.anchor === "matchend" ? meta : [...positional, ...meta]);
    case "struct":
      return pref(Object.keys(info.structural || {}).sort((x, y) => rank(x) - rank(y) || x.localeCompare(y)).map((s) => ({ code: s, label: s === "s" ? "sentence" : s === "text" ? "text / document" : s === "u" ? "utterance" : "", kind: "attr" })));
    case "keyword":
      return pref(TOP_KEYWORDS.map(([code, label]) => ({ code, label, kind: "kw" })));
    default:
      return [];
  }
}

/** Multi-line CQP box with context suggestions. */
export function CqpEditor({ id, value, onChange, info, codes, describedBy }) {
  const ref = useRef(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const ctx = cqpContext(value, Math.min(caret, value.length));
  // A short list that never needs scrolling: the caret stays in the text, the list follows it.
  const all = open ? cqpItems(ctx, info, codes) : [];
  const items = all.slice(0, 8);
  const pick = (it) => {
    const c = cqpContext(value, Math.min(caret, value.length));
    if (!c) return;
    // An attribute name inside [ ] or after "." gets ="" with the caret inside.
    let ins = it.code, back = 0;
    const after = value.slice(c.end);
    if (it.kind === "attr" && it.code !== "_" && (c.kind === "attr" || c.kind === "meta") && !/^\s*!?=/.test(after)) { ins = `${it.code}=""`; back = 1; }
    else if (it.kind === "attr" && it.code === "_") { ins = "_."; }
    else if (it.kind === "kw") ins = `${it.code} `;
    const next = value.slice(0, c.start) + ins + after;
    onChange(next);
    const at = c.start + ins.length - back;
    setCaret(at);
    requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(at, at); } });
  };
  const keys = useListKeys(items, open, setOpen, pick);
  const shown = items.length > 0;
  return (
    <div className="suggest-wrap">
      <textarea ref={ref} id={id} className="input input--mono cqp-editor" value={value} rows={3} spellCheck={false} autoComplete="off"
        aria-autocomplete="list" aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && keys.active >= 0 ? `${listId}-${keys.active}` : undefined}
        aria-describedby={describedBy} maxLength={600}
        placeholder={'e.g. [pos="VV.*"] [pos="AT0"] [class="SUBST"]'}
        onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setOpen(true); }}
        onSelect={(e) => setCaret(e.target.selectionStart ?? value.length)}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        data-search-term
        onKeyDown={keys.onKeyDown} />
      {shown && <SuggestList id={listId} items={items} active={keys.active} onPick={pick} label="CQP suggestions" more={all.length - items.length} short />}
    </div>
  );
}
