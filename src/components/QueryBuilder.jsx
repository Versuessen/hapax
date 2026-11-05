import { useEffect, useState } from "react";
import { ChevronDown, Plus, Sparkles, X } from "lucide-react";
import { clearFilters, filtersOf, withFilters } from "../lib/filters.js";
import { WORD_CLASSES, hasIrregular, wordForms } from "../lib/inflect.js";
import { FilterEditor } from "./FilterEditor.jsx";
import { MAX_NEXT, followersOf, withFollowers } from "../lib/sequence.js";
import { useApp } from "../state/store.jsx";
import { invoke } from "../lib/ipc.js";
import { CORPUS_ORDER, corporaByVariety } from "../nav.js";
import { Checkbox, Field, ICON, Input, Segmented, Select } from "./ui.jsx";

export const FIELD_LABELS = {
  word: "Written word",
  lexeme: "All forms (lexeme)",
  lemma: "Lemma annotation",
  hw: "Headword (hw)",
  pos: "Part of speech (POS)",
  class: "Broad word class",
  usas: "Semantic tag (USAS)",
  rel: "Dependency relation",
  head: "Dependency head",
  tokid: "Token id",
  type: "Token type",
  flags_before: "flags_before",
  space_after: "space_after",
  offset: "offset",
};
const FOLDABLE = ["word", "lemma", "hw"];

export function fieldOptions(info, { lexeme = true } = {}) {
  if (!info) return [["word", FIELD_LABELS.word]];
  const opts = [];
  info.positional.forEach((p) => {
    opts.push([p, FIELD_LABELS[p] || p]);
    if (p === "word" && lexeme && info.lexeme) opts.push(["lexeme", `${FIELD_LABELS.lexeme} → ${info.lexeme}`]);
  });
  return opts;
}

export function resolvedField(info, field) {
  return field === "lexeme" ? info?.lexeme : field;
}

export function corpusOptions(info) {
  if (!info) return [];
  const one = (c) => {
    const ci = info.corpora[c];
    if (ci.available === false) return [c, `${c} — not on the server`, true];
    return [c, ci.encoding === "<unsupported>" ? `${c} — cannot be searched` : c];
  };
  return corporaByVariety(info).map((g) => ({ group: g.info.label, options: g.corpora.map(one) }));
}

/** Live, debounced CQP preview + validation message from the Rust compiler. */
export function useCqpPreview(query, enabled = true) {
  const [state, setState] = useState({ preview: null, error: null });
  useEffect(() => {
    if (!enabled || !query.value) {
      setState({ preview: null, error: null });
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      invoke("preview_query", { query })
        .then((p) => live && setState({ preview: p, error: null }))
        .catch((e) => live && setState({ preview: null, error: e.message }));
    }, 160);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, enabled]);
  return state;
}

/**
 * Structured query editor. Only allow-listed attributes reach the Rust
 * compiler; nothing typed here is ever sent as raw CQP.
 */
export function QueryBuilder({ query, onChange, onSubmit, compact = false, showCorpus = true, showFilters = true, idPrefix = "q" }) {
  const { info } = useApp();
  const [advanced, setAdvanced] = useState(!!query.regex);
  const [formsOpen, setFormsOpen] = useState(false);
  const filters = filtersOf(query);
  const words = followersOf(query);
  const setWords = (list) => onChange(withFollowers(query, list));
  const setWord = (i, patch) => setWords(words.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const ci = info?.corpora?.[query.corpus];
  const set = (patch) => onChange({ ...query, ...patch });
  const field = resolvedField(ci, query.field);
  const foldable = FOLDABLE.includes(field);
  const hasS = !!ci?.structural?.s;

  useEffect(() => {
    if (query.ignore_case && !foldable) set({ ignore_case: false });
    if (query.sentence_only && !hasS) set({ sentence_only: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldable, hasS]);

  const submit = (e) => {
    e.preventDefault();
    onSubmit?.();
  };

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
      <div className="form-grid">
        {showCorpus && (
          <Field label="Corpus" htmlFor={`${idPrefix}-corpus`}>
            <Select id={`${idPrefix}-corpus`} value={query.corpus} options={corpusOptions(info)} onChange={(e) => onChange({ ...clearFilters(withFollowers(query, words.map((w) => ({ ...w, field: "word" })))), corpus: e.target.value, field: "word" })} />
          </Field>
        )}
        <Field label="Find by" htmlFor={`${idPrefix}-field`}>
          <Select id={`${idPrefix}-field`} value={query.field} options={fieldOptions(ci)} onChange={(e) => set({ field: e.target.value })} />
        </Field>
        <Field label="Value" htmlFor={`${idPrefix}-value`}>
          <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <Input id={`${idPrefix}-value`} data-search-term value={query.value} placeholder={field === "pos" ? "e.g. NN1, JJ" : "e.g. jury  ·  I|me for either"} onChange={(e) => set({ value: e.target.value })} spellCheck={false} maxLength={120} style={{ flex: 1 }} />
            {(query.field === "word" || query.field === "lexeme") && (
              <button type="button" className="btn btn--ghost" aria-expanded={formsOpen} onClick={() => setFormsOpen((o) => !o)} title="Find every form of this word"
                disabled={!query.value.trim() || query.value.includes("|") || /\s/.test(query.value.trim())}>
                <Sparkles {...ICON} size={14} /> All forms
              </button>
            )}
          </div>
        </Field>
      </div>

      {formsOpen && (
        <FormsHelper query={query} ci={ci} onApply={(patch) => { set(patch); setFormsOpen(false); }} onClose={() => setFormsOpen(false)} />
      )}

      {words.length > 0 && (
        <ol className="seq" aria-label="Following words">
          {words.map((w, i) => {
            const n = i + 2;
            const last = i === words.length - 1;
            const f = resolvedField(ci, w.field);
            return (
              <li key={i} className="seq__row">
                <span className="seq__n mono" aria-hidden="true">{n}</span>
                <Select small aria-label={`Word ${n}: position`} value={String(w.gap)} onChange={(e) => setWord(i, { gap: Number(e.target.value) })}
                  options={[["0", "right after"], ...Array.from({ length: 10 }, (_, k) => [String(k + 1), `within ${k + 1} word${k ? "s" : ""}`])]} />
                <Select small aria-label={`Word ${n}: find by`} value={w.field} options={fieldOptions(ci)} onChange={(e) => setWord(i, { field: e.target.value })} />
                <Input id={`${idPrefix}-w${n}`} aria-label={`Word ${n}: value`} value={w.value} spellCheck={false} maxLength={120}
                  placeholder={f === "pos" ? "e.g. NN1" : f === "class" ? "e.g. ADV" : "e.g. and  ·  I|me"}
                  onChange={(e) => setWord(i, { value: e.target.value })} />
                <Checkbox label="Optional" checked={w.optional} disabled={last && !w.optional} onChange={(v) => setWord(i, { optional: v })}
                  title={last ? "The last word can't be optional — remove it instead" : "Match with or without this word"} />
                <button type="button" className="btn btn--ghost btn--icon" aria-label={`Remove word ${n}`} title="Remove word"
                  onClick={() => setWords(words.filter((_, j) => j !== i))}>
                  <X {...ICON} size={14} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="row" style={{ gap: 10 }}>
        <button type="button" className="btn btn--ghost" disabled={words.length >= MAX_NEXT}
          onClick={() => {
            setWords([...words, { field: "word", value: "", gap: 0, optional: false }]);
            setTimeout(() => document.getElementById(`${idPrefix}-w${words.length + 2}`)?.focus(), 0);
          }}>
          <Plus {...ICON} size={14} /> Add word
        </button>
        <span className="muted" style={{ fontSize: "var(--fs-mono)" }}>
          {words.length ? `${words.length + 1}-word sequence · use | for alternatives (I|me)` : "Search for a phrase: add the words that follow"}
        </span>
      </div>

      {showFilters && <div className="stack" style={{ gap: 8 }}>
        <div className="section-label">Only in documents where</div>
        <FilterEditor corpus={query.corpus} filters={filters} idPrefix={`${idPrefix}-f`} onChange={(list) => onChange(withFilters(query, list))} />
      </div>}

      <div className="row" style={{ gap: 18 }}>
        <Checkbox label="Ignore case" checked={query.ignore_case} disabled={!foldable} onChange={(v) => set({ ignore_case: v })} title={foldable ? "" : "Case folding works for word, lemma and headword"} />
        <Checkbox label="Within one sentence" checked={query.sentence_only} disabled={!hasS} onChange={(v) => set({ sentence_only: v })} title={hasS ? "" : "This corpus has no sentence attribute"} />
        <span className="spacer" />
        <button type="button" className="btn btn--ghost" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
          Advanced
          <ChevronDown {...ICON} size={14} style={{ transform: advanced ? "rotate(180deg)" : "none", transition: "transform var(--dur)" }} />
        </button>
      </div>

      {advanced && (
        <div className="stack" style={{ gap: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
          <div className="row" style={{ gap: 18 }}>
            <Checkbox label="Regex" checked={query.regex} onChange={(v) => set({ regex: v })} title="Treat the first value as a CQP regular expression (max 80 characters)" />
            <span className="muted" style={{ fontSize: "var(--fs-mono)" }}>Treats the first word's value as a CQP regular expression (up to 80 characters). Other values are always matched literally.</span>
          </div>
        </div>
      )}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  );
}

/**
 * "All forms" for the first word. Corpora with a lemma index search the
 * lexeme exactly; the others get rule-based forms (plus a table of irregular
 * words and pronouns) that the user reviews before they become alternatives.
 */
function FormsHelper({ query, ci, onApply, onClose }) {
  const [cls, setCls] = useState("adjective");
  const base = query.value.trim();
  const generated = wordForms(base, cls);
  const [off, setOff] = useState(() => new Set());
  const forms = generated.filter((f) => !off.has(f));
  return (
    <div className="forms" role="region" aria-label="All forms of the word">
      {ci?.lexeme ? (
        <>
          <div style={{ fontSize: "var(--fs-small)" }}>
            {query.corpus} has a lemma index (<code>{ci.lexeme}</code>), so <strong>All forms (lexeme)</strong> finds every form of
            “{base}” exactly, including irregular ones. With Ignore case, capitalisation does not matter either.
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--primary" onClick={() => onApply({ field: "lexeme", ignore_case: true })}>Search all forms (lexeme)</button>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
          </div>
        </>
      ) : (
        <>
          <div className="row" style={{ gap: 12 }}>
            <span style={{ fontSize: "var(--fs-small)", flex: 1, minWidth: 220 }}>
              {query.corpus} has no lemma index, so Hapax suggests the forms of “{base}”. Select a form to leave it out.
            </span>
            {!hasIrregular(base) && <Segmented small value={cls} onChange={(v) => { setCls(v); setOff(new Set()); }} label="Word class" options={WORD_CLASSES} />}
          </div>
          <div className="forms__chips">
            {generated.map((f) => (
              <button key={f} type="button" className={`chip-toggle${off.has(f) ? "" : " is-on"}`} aria-pressed={!off.has(f)}
                onClick={() => setOff((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; })}>{f}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--primary" disabled={!forms.length} onClick={() => onApply({ field: "word", value: forms.join("|"), ignore_case: true, regex: false })}>
              Search these {forms.length} forms
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <span className="muted" style={{ fontSize: "var(--fs-mono)" }}>Ignore case is switched on. Forms are generated by rule — check them.</span>
          </div>
        </>
      )}
    </div>
  );
}

