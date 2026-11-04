/** Document filters on a query. Older searches may carry one legacy
 *  meta_attr/meta_value pair; it is shown as the first filter and moved into
 *  `filters` on the first edit. */
export const MAX_FILTERS = 6;

export function filtersOf(q) {
  const out = [];
  if (q?.meta_attr && q?.meta_value?.trim()) out.push({ attr: q.meta_attr, op: "is", value: q.meta_value.trim() });
  for (const f of q?.filters || []) out.push({ attr: f.attr || "", op: f.op || "is", value: f.value ?? "", from: f.from ?? null, to: f.to ?? null });
  return out;
}

export function withFilters(q, list) {
  return { ...q, meta_attr: "", meta_value: "", filters: list };
}

/** Corpus changed: filters name that corpus's attributes, so they are dropped. */
export const clearFilters = (q) => ({ ...q, meta_attr: "", meta_value: "", filters: [] });

export function describeFilter(f) {
  if (!f.attr) return null;
  if (f.op === "years") return `${f.attr}: ${f.from ?? "…"}–${f.to ?? "…"}`;
  const vals = String(f.value || "").split("|").map((v) => v.trim()).filter(Boolean);
  if (!vals.length) return null;
  const shown = vals.length > 3 ? `${vals.slice(0, 3).join(", ")} +${vals.length - 3}` : vals.join(", ");
  return `${f.attr} ${f.op === "not" ? "is not" : "is"} ${shown}`;
}

export const describeFilters = (q) => filtersOf(q).map(describeFilter).filter(Boolean);
