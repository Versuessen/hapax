import { useEffect, useState } from "react";
import { ChevronDown, Code2, Plus, X } from "lucide-react";
import { MAX_NEXT, followersOf, withFollowers } from "../lib/sequence.js";
import { useApp } from "../state/store.jsx";
import { invoke } from "../lib/ipc.js";
import { CORPUS_ORDER, corporaByVariety } from "../nav.js";
import { Checkbox, Field, ICON, Input, Select } from "./ui.jsx";

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
export function QueryBuilder({ query, onChange, onSubmit, compact = false, showCorpus = true, idPrefix = "q" }) {
  const { info } = useApp();
  const [advanced, setAdvanced] = useState(!!(query.meta_value || query.regex));
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
            <Select id={`${idPrefix}-corpus`} value={query.corpus} options={corpusOptions(info)} onChange={(e) => onChange({ ...withFollowers(query, words.map((w) => ({ ...w, field: "word" }))), corpus: e.target.value, meta_attr: "", meta_value: "", field: "word" })} />
          </Field>
        )}
        <Field label="Find by" htmlFor={`${idPrefix}-field`}>
          <Select id={`${idPrefix}-field`} value={query.field} options={fieldOptions(ci)} onChange={(e) => set({ field: e.target.value })} />
        </Field>
        <Field label="Value" htmlFor={`${idPrefix}-value`}>
          <Input id={`${idPrefix}-value`} data-search-term value={query.value} placeholder={field === "pos" ? "e.g. NN1, JJ" : "e.g. jury  ·  I|me for either"} onChange={(e) => set({ value: e.target.value })} spellCheck={false} maxLength={120} />
        </Field>
      </div>

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
        <span className="muted" style={{ fontSize: 12 }}>
          {words.length ? `${words.length + 1}-word sequence · use | for alternatives (I|me)` : "Search for a phrase: add the words that follow"}
        </span>
      </div>

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
          <div className="form-grid">
            <Field label="Document filter" htmlFor={`${idPrefix}-ma`}>
              <Select id={`${idPrefix}-ma`} value={query.meta_attr} options={[["", "No filter"], ...(ci?.metadata || []).map((m) => [m, m])]} onChange={(e) => set({ meta_attr: e.target.value })} />
            </Field>
            <Field label="Exact stored value" htmlFor={`${idPrefix}-mv`} hint="List values under Corpora → Contents & metadata">
              <Input id={`${idPrefix}-mv`} value={query.meta_value} disabled={!query.meta_attr} onChange={(e) => set({ meta_value: e.target.value })} spellCheck={false} maxLength={150} />
            </Field>
            <div style={{ alignSelf: "end", minHeight: 40, display: "flex", alignItems: "center" }}>
              <Checkbox label="Regex" checked={query.regex} onChange={(v) => set({ regex: v })} title="Treat the first value as a CQP regular expression (max 80 characters)" />
            </div>
          </div>
        </div>
      )}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  );
}

export function CqpPreview({ preview, error, empty = "Type a value to see the generated CQP." }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ color: "var(--text-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
        <Code2 {...ICON} size={14} aria-hidden="true" /> Generated CQP · read-only
      </div>
      {error ? (
        <div className="code" style={{ color: "var(--negative)", borderColor: "color-mix(in srgb, var(--negative) 30%, var(--border-subtle))" }} role="alert">{error}</div>
      ) : (
        <pre className="code" aria-live="polite">{preview ? preview.cqp_command : empty}</pre>
      )}
    </div>
  );
}
