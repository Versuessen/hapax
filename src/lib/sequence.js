/** Multi-word sequences. Word 1 is query.field/value; the rest live in
 *  `next` (older saved searches may still use second_field/second_value). */
export const MAX_NEXT = 8;

export function followersOf(q) {
  const out = [];
  if (q?.second_value?.trim()) out.push({ field: q.second_field || "word", value: q.second_value, gap: Number(q.gap || 0), optional: false });
  for (const t of q?.next || []) out.push({ field: t.field || "word", value: t.value ?? "", gap: Number(t.gap || 0), optional: !!t.optional });
  return out;
}

/** Store the list in `next` and clear the legacy second-word fields. */
export function withFollowers(q, list) {
  return { ...q, second_field: "word", second_value: "", gap: 0, next: list };
}

export function describeFollowers(q) {
  return followersOf(q)
    .filter((t) => t.value.trim())
    .map((t) => `${t.gap ? `within ${t.gap} → ` : "then "}${t.field} “${t.value}”${t.optional ? " (optional)" : ""}`);
}
