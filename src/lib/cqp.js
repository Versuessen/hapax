/**
 * Helpers for typed CQP and for value suggestions.
 *
 * `checkCqp` mirrors src-tauri/src/cqp.rs (the Rust check is the one that
 * counts; this copy serves the dev fixture backend). `cqpContext` and
 * `suggestCodes` drive the autocomplete in the query form.
 */

export const CQP_KEYWORDS = ["within", "match", "matchend", "target", "keyword", "expand", "to", "left", "right", "cut",
  "contains", "matches", "distance", "distabs", "lbound", "rbound", "lbound_of", "rbound_of", "int", "ambiguity"];
const ANCHORS = ["_", "match", "matchend", "target", "keyword"];
const MAX_LEN = 600;

const fail = (message) => { throw { kind: "validation", message }; };

/** Same rules as cqp.rs `check`; returns { expression, constraintAt, hasCut, allTokens }. */
export function checkCqp(corpus, info, text) {
  const src = String(text || "").replace(/[\n\r\t]/g, " ").trim();
  if (!src) fail('Type a CQP query, for example [pos="NN1"] — or [] for every word.');
  if ([...src].length > MAX_LEN) fail(`A CQP query can have at most ${MAX_LEN} characters`);
  if (/[\u0000-\u001f\u007f]/.test(src)) fail("The query contains a control character");
  const lex = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= src.length) fail(`A value starting at character ${i + 1} has no closing ${c}`);
        const d = src[j];
        if (d === c) break;
        if (d === ";") fail("Values in a CQP query can't contain a semicolon");
        if (d === "\\") {
          const e = src[j + 1];
          if (e === '"' || e === "'") fail("Values in a CQP query can't contain quotation marks");
          if (e === undefined) fail("A value ends with a backslash");
          j += 2; continue;
        }
        if (d === '"' || d === "'") fail("Values in a CQP query can't contain quotation marks");
        j++;
      }
      lex.push({ at: i, t: "str" }); i = j + 1; continue;
    }
    if (c === "%") {
      let j = i + 1;
      while (/[cdl]/.test(src[j] || "")) j++;
      if (j === i + 1 || /[A-Za-z0-9]/.test(src[j] || "")) fail("After a value, only the flags %c (ignore case), %d (ignore accents) and %l (literal) are allowed");
      lex.push({ at: i, t: "flag" }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (/[A-Za-z0-9_]/.test(src[j] || "")) j++;
      lex.push({ at: i, t: "name", v: src.slice(i, j) }); i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (/[0-9]/.test(src[j] || "")) j++;
      lex.push({ at: i, t: "num" }); i = j; continue;
    }
    if ("[](){}<>/=!&|?*+,.:@-".includes(c)) { lex.push({ at: i, t: "p", v: c }); i++; continue; }
    const what = c === ";" ? "a semicolon (it would end the query and start a command)" : c === "\\" ? "a backslash outside a quoted value" : `“${c}”`;
    fail(`CQP queries here can't contain ${what} (character ${i + 1})`);
  }
  const labels = [];
  lex.forEach((x, k) => {
    const n = lex[k + 1], m = lex[k + 2];
    if (x.t === "name" && n?.t === "p" && n.v === ":" && !(m?.t === "p" && m.v === ":" && m.at === n.at + 1)) labels.push(x.v);
  });
  const isAttr = (n) => info.positional.includes(n) || n in (info.structural || {});
  const names = () => {
    const st = Object.keys(info.structural || {});
    return `${info.positional.join(", ")}${st.length ? `; structural: ${st.slice(0, 6).join(", ")}${st.length > 6 ? ` and ${st.length - 6} more` : ""}` : ""}`;
  };
  const stack = [];
  let inTag = false, constraintAt = null, hasCut = false, patterns = 0;
  lex.forEach((x, k) => {
    const next = lex[k + 1];
    if (x.t === "name") {
      const n = x.v;
      if (n === "cut") hasCut = true;
      const anchor = ANCHORS.includes(n) || labels.includes(n);
      if (next?.t === "p" && next.v === "." && !anchor && !isAttr(n)) fail(`Unknown label “${n}”. Define it first, as in ${n}:[pos="NN1"], or use _ for the current word`);
      if (!(isAttr(n) || CQP_KEYWORDS.includes(n) || anchor)) fail(`“${n}” is not an attribute of ${corpus} or a CQP query keyword. Attributes: ${names()}`);
      const a = lex[k - 1], b = lex[k - 2];
      if (a?.t === "p" && a.v === "." && b?.t === "name" && (ANCHORS.includes(b.v) || labels.includes(b.v)) && !isAttr(n)) fail(`“${b.v}.${n}”: ${corpus} has no attribute “${n}”. Attributes: ${names()}`);
    } else if (x.t === "str") patterns++;
    else if (x.t === "p") {
      const c = x.v;
      if ("[({".includes(c)) stack.push(c);
      else if ("])}".includes(c)) {
        if (stack.pop() !== { "]": "[", ")": "(", "}": "{" }[c]) fail(`Unbalanced “${c}” at character ${x.at + 1}`);
        if (c === "]") patterns++;
      } else if (c === "<" && !stack.length) { inTag = true; patterns++; }
      else if (c === ">") {
        if (inTag && !stack.length) inTag = false;
        else if (next?.t === "str" || (next?.t === "p" && next.v === ">")) fail("A “>” comparison can't be followed by a quoted value here");
      } else if (c === ":" && next?.t === "p" && next.v === ":" && next.at === x.at + 1 && constraintAt == null) {
        if (stack.length) fail("“::” (conditions on the whole match) must come after the token patterns, outside brackets");
        constraintAt = x.at;
      }
    }
  });
  if (stack.length) fail(`“${stack.at(-1)}” is never closed`);
  if (inTag) fail("A “<” tag is never closed with “>”");
  if (!patterns) fail('The query needs at least one token pattern, such as [pos="NN1"] or "word" — or [] for every word');
  const expression = collapse(src);
  return { expression, constraintAt: constraintAt == null ? null : firstOutside(expression, "::"), hasCut, allTokens: expression.replace(/ /g, "") === "[]" };
}

function walk(s, onOutside) {
  let q = null, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === q) q = null; onOutside(i, c, true); continue; }
    if (c === '"' || c === "'") q = c;
    if (onOutside(i, c, false) === false) return;
  }
}
function collapse(s) {
  let out = "", prev = false;
  walk(s, (i, c, inside) => {
    if (inside || c !== " ") { out += c; prev = false; return; }
    if (!prev) out += " ";
    prev = true;
  });
  return out;
}
function firstOutside(s, needle) {
  let at = null;
  walk(s, (i, c, inside) => { if (!inside && s.startsWith(needle, i)) { at = i; return false; } });
  return at;
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

/** Fields whose values are codes the glossary can suggest. */
export const CODE_FIELDS = ["pos", "class", "usas", "rel"];

const VERBISH = /\b(be|do|have|is|was|are|were|am|been|being|did|doing|done|does|had|has|having)\b|modal|auxiliar|catenative/i;

/** The part of a value after the last `|` or `/`: what is being typed now. */
export function currentSegment(value, caret = value.length) {
  const before = value.slice(0, caret);
  const start = Math.max(before.lastIndexOf("|"), before.lastIndexOf("/")) + 1;
  let end = caret;
  while (end < value.length && !"|/".includes(value[end])) end++;
  return { start, end, text: value.slice(start, end) };
}

/**
 * Codes matching what is typed: by code ("VV", "nn1") or by meaning ("verb",
 * "plural noun" — every word must start a word of the meaning). Adds wildcard
 * groups (VV* = every code starting VV) when all codes of a prefix match.
 * `regex` writes groups as VV.* for typed CQP. Returns [] when the segment is
 * already a complete code or a pattern, so the list stays out of the way.
 */
export function suggestCodes(codes, segment, { regex = false, limit = 60 } = {}) {
  const s = segment.trim();
  if (!codes?.length) return [];
  if (s && (codes.some((c) => c.code === s) || /[*.]/.test(s))) return [];
  if (!s) return codes.slice(0, limit).map((c) => ({ ...c, kind: "code" }));
  const lower = s.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const byMeaning = (c) => {
    // Forms of be/do/have and modals are verbs even where the gloss doesn't say so.
    const label = VERBISH.test(c.label) ? `${c.label} verb` : c.label;
    const ws = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return words.every((w) => ws.some((x) => x.startsWith(w)));
  };
  const byCode = codes.filter((c) => c.code.toLowerCase().startsWith(lower));
  const meaning = codes.filter((c) => !byCode.includes(c) && byMeaning(c));
  const hits = [...byCode, ...meaning];
  if (!hits.length) return [];
  // Wildcard groups: a prefix whose every code is among the hits.
  const groups = [];
  const prefixes = new Set();
  for (const h of hits) for (const n of [1, 2]) if (h.code.length > n && /^[A-Za-z]+$/.test(h.code.slice(0, n))) prefixes.add(h.code.slice(0, n));
  for (const p of [...prefixes].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    const all = codes.filter((c) => c.code.startsWith(p));
    if (all.length < 2 || !all.every((c) => hits.includes(c))) continue;
    if (groups.some((g) => p.startsWith(g.prefix) && g.count === all.length)) continue;
    groups.push({ prefix: p, count: all.length });
  }
  const shown = groups.slice(0, 6);
  const groupItems = shown.map((g) => ({
    code: regex ? `${g.prefix}.*` : `${g.prefix}*`, kind: "group",
    label: `every code starting ${g.prefix} (${g.count})`,
  }));
  return [...groupItems, ...hits.slice(0, limit).map((c) => ({ ...c, kind: "code" }))];
}

/**
 * What the caret in a typed CQP query is in, for suggestions:
 * { kind: "value", attr, start, end, text } inside a quoted value,
 * { kind: "attr", start, end, text } for a name inside [ ],
 * { kind: "meta", start, end, text } after match. / _. / label.,
 * { kind: "struct", start, end, text } after < or </,
 * { kind: "keyword", start, end, text } for a name between patterns, or null.
 */
export function cqpContext(text, caret) {
  const s = text.slice(0, caret);
  // Inside a quoted value?
  let q = null, qStart = -1, esc = false, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; qStart = i; } else if (c === "[") depth++; else if (c === "]") depth = Math.max(0, depth - 1);
  }
  if (q) {
    const head = s.slice(0, qStart);
    const m = head.match(/(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*!?=\s*$/);
    const inner = s.slice(qStart + 1);
    const seg = Math.max(inner.lastIndexOf("|"), inner.lastIndexOf("(")) + 1;
    let end = caret;
    while (end < text.length && !`|)${q}`.includes(text[end])) end++;
    return { kind: "value", attr: m?.[2] || null, anchor: m?.[1] || null, start: qStart + 1 + seg, end, text: inner.slice(seg) };
  }
  const w = s.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  const start = caret - (w ? w[0].length : 0);
  let end = caret;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end++;
  const word = w ? w[0] : "";
  const before = s.slice(0, start).replace(/\s+$/, "");
  const prev = before.slice(-1);
  if (prev === ".") return { kind: "meta", start, end, text: word, anchor: before.match(/([A-Za-z_][A-Za-z0-9_]*)\.$/)?.[1] || null };
  if (prev === "<" || before.endsWith("</") || /(^|\s)within$/.test(before)) return { kind: "struct", start, end, text: word };
  if (depth > 0 && (prev === "[" || prev === "&" || prev === "|" || prev === "(" || prev === "!" || (word && prev === ""))) return { kind: "attr", start, end, text: word };
  if (depth === 0 && word) return { kind: "keyword", start, end, text: word };
  return null;
}
