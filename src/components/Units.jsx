import { useEffect } from "react";
import { useApp } from "../state/store.jsx";
import { compact, rate as fmtRate, thousands } from "../lib/format.js";

/**
 * Per million tokens or per million words. Tokens count everything the corpus
 * indexes, punctuation included; words are tokens with a letter or digit,
 * counted once per corpus on the server. Clicking any rate label or corpus size
 * switches every figure in the app between the two.
 *
 * For a part of a corpus (filters, a genre in Spread) only the token size is
 * measured, so its word count is estimated from the whole corpus's share of
 * words and marked ≈.
 */
export function useUnits(corpora = []) {
  const { unit, toggleUnit, wordsOf, needWords, info } = useApp();
  const key = corpora.filter(Boolean).join("|");
  useEffect(() => { if (unit === "words" && key) needWords(key.split("|")); }, [unit, key]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Words for `tokens` tokens of `corpus` (the whole corpus when omitted). */
  const words = (corpus, tokens) => {
    const total = info?.corpora?.[corpus]?.tokens;
    const w = wordsOf(corpus);
    if (w == null || !total) return null;
    if (tokens == null || tokens === total) return { n: w, approx: false };
    return { n: Math.round((tokens * w) / total), approx: true };
  };
  /** Denominator in the current unit: { n, unit, approx, pending }. */
  const denom = (corpus, tokens) => {
    const t = tokens ?? info?.corpora?.[corpus]?.tokens ?? 0;
    if (unit !== "words") return { n: t, unit: "tokens", approx: false, pending: false };
    const w = words(corpus, t);
    return w ? { n: w.n, unit: "words", approx: w.approx, pending: false } : { n: t, unit: "tokens", approx: false, pending: true };
  };
  /** Rate per million in the current unit. */
  const per = (count, corpus, tokens) => {
    const d = denom(corpus, tokens);
    return { ...d, value: d.n ? (count * 1e6) / d.n : 0 };
  };
  return { unit, toggle: toggleUnit, denom, per, words };
}

const TIP = {
  tokens: "Per million tokens: every indexed token, punctuation included. Click to show per million words instead.",
  words: "Per million words: tokens with a letter or digit (punctuation left out). Click to show per million tokens instead.",
};

/** "per million tokens" / "per million words", as a switch. */
export function UnitLabel({ corpora = [], approx = false, prefix = "per million" }) {
  const { unit, toggle, denom } = useUnits(corpora);
  const pending = unit === "words" && corpora.some((c) => denom(c).pending);
  const shown = pending ? "tokens" : unit;
  return (
    <button type="button" className="unit-toggle" onClick={toggle} title={TIP[unit]} aria-label={`${prefix} ${shown}. Switch to per million ${unit === "words" ? "tokens" : "words"}`}>
      {prefix} {approx && shown === "words" ? "≈ " : ""}{shown}{pending ? " (counting words…)" : ""}
    </button>
  );
}

/** A rate figure in the current unit: "41.20". */
export function Rate({ count, corpus, tokens, digits }) {
  const { per } = useUnits([corpus]);
  const r = per(count, corpus, tokens);
  return <span title={r.approx ? "Estimated: the word count of this part is the corpus's share of words applied to its tokens" : undefined}>{r.approx ? "≈ " : ""}{digits != null ? r.value.toFixed(digits) : fmtRate(r.value)}</span>;
}

/** A corpus or part size in the current unit, as a switch: "112M tokens". */
export function Size({ corpus, tokens, format = "compact", bare = false, label = true }) {
  const { unit, toggle, denom } = useUnits([corpus]);
  const d = denom(corpus, tokens);
  const n = format === "thousands" ? thousands(d.n) : compact(d.n);
  const text = `${d.approx ? "≈ " : ""}${n}${label ? ` ${d.unit}` : ""}`;
  if (bare) return <span title={d.approx ? "Estimated from the corpus's share of words" : undefined}>{text}</span>;
  return (
    <button type="button" className="unit-toggle" onClick={toggle} title={TIP[unit]} aria-label={`${text}. Switch to ${unit === "words" ? "tokens" : "words"}`}>
      {text}{d.pending ? " (counting words…)" : ""}
    </button>
  );
}
