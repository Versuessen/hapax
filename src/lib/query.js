import { describeFilter, filtersOf } from "./filters.js";
import { followersOf } from "./sequence.js";

/** Typed-CQP mode ("Write CQP") is on. */
export const isManual = (q) => !!q?.manual;

/**
 * Something to search for: typed CQP, a value, a following word, or just
 * filters (then every word of the filtered documents is listed).
 */
export function hasQuery(q) {
  if (!q) return false;
  if (q.manual) return !!q.cqp?.trim();
  return !!(q.value?.trim() || followersOf(q).some((t) => t.value.trim()) || filtersOf(q).some((f) => describeFilter(f)));
}

/** Short label of what a search looks for, for chips, logs and save names. */
export function queryLabel(q, max = 60) {
  if (!q) return "";
  if (q.manual) {
    const t = String(q.cqp || "").replace(/\s+/g, " ").trim();
    return `CQP ${t.length > max ? `${t.slice(0, max - 1)}…` : t}`;
  }
  if (!q.value?.trim()) return followersOf(q).some((t) => t.value.trim()) ? "any word, then …" : "every word";
  return `${q.field || "word"} = ${q.value}${q.ignore_case ? " %c" : ""}`;
}
