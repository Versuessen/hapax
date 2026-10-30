// DEV-ONLY deterministic stand-in for the Rust backend.
//
// Loaded exclusively by src/lib/ipc.js when running `vite dev` in a plain
// browser (no Tauri). Never bundled into production builds. All corpus
// "contexts" below are invented placeholder sentences, not corpus text.
// Purpose: repeatable screenshots and UI checks without touching the shared
// university server.

import corpora from "../../src-tauri/resources/corpora.json";
import codebook from "../../src-tauri/resources/codebook.json";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);
const START_CONNECTED = params.get("fixtures") !== "offline";
const LATENCY = Number(params.get("latency") ?? 220);

let connected = START_CONNECTED;
let prefs = {
  host: "login.fu-berlin.de", user: "jdoe", port: 22, corpus: "BROWN-LEGACY", zoom_percent: 100,
  saved_searches: [
    { name: "BROWN — jury (any case)", query: { corpus: "BROWN-LEGACY", field: "word", value: "jury", ignore_case: true } },
    { name: "BNC-BABY — deliver + adverb", query: { corpus: "BNC-BABY", field: "lexeme", value: "deliver", second_field: "class", second_value: "ADV", sentence_only: true } },
    { name: "CLMET — adjective + noun", query: { corpus: "CLMET", field: "pos", value: "JJ", second_field: "pos", second_value: "NN" } },
  ],
};
const listeners = {};
let cancelled = false;
let consoleSeq = 0;
const consoleLog = [];
function consolePush(e) {
  const entry = { id: ++consoleSeq, at: new Date().toISOString(), response_bytes: 0, response_truncated: false, ...e };
  consoleLog.push(entry);
  if (consoleLog.length > 300) consoleLog.shift();
  emit("console://entry", entry);
  return entry;
}
function consoleUpdate(entry, patch) {
  Object.assign(entry, patch);
  emit("console://entry", { ...entry });
}

const LEFT = [
  "the Fulton County Grand", "took place . the", ". the September-October term", "said the grand", "before the", "told the",
  "members of the", "instructions to the", "the foreman of the", "selected for the", "a decision by the", "as the",
];
const RIGHT = [
  "said Friday an investigation", "further said in term-end", "had been charged by Fulton", "recommended that the city",
  "returned its verdict late", "heard testimony from several", "was dismissed after two", "deliberated for three hours",
  "found no evidence of", "praised the conduct of", "will reconvene next month", "reported that the system",
];
const NODE = ["jury", "Jury", "jury", "jury", "JURY", "jury"];

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Math.abs(h);
}

function totalFor(q) {
  if (!q?.value) return 0;
  if (q.corpus === "BROWN-LEGACY" && q.value.toLowerCase() === "jury") return q.ignore_case ? 67 : 63;
  if (q.corpus === "BNC-BABY" && q.value === "go" && q.field === "lexeme") return 16147;
  if (q.value === "impossible") return 0;
  return 40 + (hash(JSON.stringify([q.corpus, q.field, q.value, q.second_value, q.meta_value])) % 4800);
}

function rowsFor(q, offset, limit, total, ctx = 4) {
  const rows = [];
  const base = 4 + (hash(q.corpus + q.value) % 900);
  for (let i = offset; i < Math.min(total, offset + limit); i++) {
    const words = (s) => s.split(" ").slice(-ctx).join(" ");
    rows.push({
      start: base + i * 17483,
      end: base + i * 17483 + (q.second_value ? 1 : 0),
      left: words(LEFT[i % LEFT.length]),
      text: q.value === "jury" || q.value === "Jury" ? NODE[i % NODE.length] : q.second_value ? `${q.value} ${q.second_value.toLowerCase()}` : q.value,
      right: RIGHT[i % RIGHT.length].split(" ").slice(0, ctx).join(" "),
      source: q.corpus.includes("LEGACY") ? `A${String((i % 44) + 1).padStart(2, "0")}` : `T${100 + (i % 80)}`,
    });
  }
  return rows;
}

function explain(corpus, field, value) {
  const scheme = ["BNC", "BNC-BABY", "DOORCORP"].includes(corpus) ? "C5" : corpus === "BNC2014-S" ? "C7" : corpus.includes("LEGACY") ? "BROWN" : "PENN";
  if (field === "pos") {
    const full = codebook.tagsets[scheme]?.[value];
    if (full) return { short: full, full, note: "This is an automated classification, not a guarantee of grammatical correctness.", reference: codebook.sources[scheme] || "", verified: true };
    return { short: `Unknown POS tag: ${value}`, full: `Not in the available ${scheme} glossary`, note: "Preserved exactly as stored.", reference: "", verified: false };
  }
  if (field === "class" && codebook.class[value]) return { short: codebook.class[value], full: codebook.class[value], note: "Broad corpus class.", reference: "", verified: true };
  if (["word", "lemma", "hw"].includes(field)) return { short: "Written/lexical value (not a grammatical code)", full: value, note: "A word is text, not a grammatical label.", reference: "", verified: true };
  return { short: value, full: value, note: "No verified definition is packaged for this field.", reference: "", verified: false };
}

function compile(q) {
  const esc = (v) => (q.regex ? v : v.replace(/([.\[\]{}()*+?^$|])/g, "\\$1"));
  const info = corpora[q.corpus];
  if (!info) throw { kind: "validation", message: "Unknown corpus" };
  if (info.encoding === "<unsupported>") throw { kind: "validation", message: `${q.corpus} cannot be searched with CQP on this server: its registry declares a character encoding that CWB does not recognise.` };
  if (!q.value || q.value.length > 120) throw { kind: "validation", message: "Search values must contain 1–120 characters" };
  if (/["\\;]/.test(q.value)) throw { kind: "validation", message: "Search values may not contain quotation marks, backslashes, semicolons or control characters" };
  let field = q.field || "word";
  if (field === "lexeme") {
    if (!info.lexeme) throw { kind: "validation", message: "This corpus has no indexed lemma/headword attribute" };
    field = info.lexeme;
  }
  if (!info.positional.includes(field)) throw { kind: "validation", message: `'${field}' is not available in ${q.corpus}` };
  if (q.ignore_case && !["word", "lemma", "hw"].includes(field)) throw { kind: "validation", message: "Case folding is supported for word, lemma and headword searches" };
  let e = `[${field}="${esc(q.value)}"${q.ignore_case ? " %c" : ""}]`;
  const alt = (v) => { const parts = v.trim().split("|").map((x) => x.trim()); if (parts.some((x) => !x)) throw { kind: "validation", message: "Alternatives need a word on both sides of | (for example I|me)" }; return parts.length > 1 ? `(${parts.map(esc).join("|")})` : esc(parts[0]); };
  e = `[${field}="${q.regex ? q.value : alt(q.value)}"${q.ignore_case ? " %c" : ""}]`;
  const rest = [];
  if (q.second_value?.trim()) rest.push({ field: q.second_field || "word", value: q.second_value, gap: Number(q.gap || 0) });
  for (const t of q.next || []) if (t.value?.trim()) rest.push(t);
  if (rest.length > 8) throw { kind: "validation", message: "A sequence can have at most 9 words" };
  rest.forEach((t, i) => {
    let f2 = t.field || "word";
    if (f2 === "lexeme") f2 = info.lexeme;
    const gap = Number(t.gap || 0);
    if (t.optional && i === rest.length - 1) throw { kind: "validation", message: `Word ${i + 2} is the last word, so it can't be optional (CQP would always leave it out). Remove it instead.` };
    e += (gap ? ` []{0,${gap}}` : "") + ` [${f2}="${alt(t.value)}"${q.ignore_case && ["word", "lemma", "hw"].includes(f2) ? " %c" : ""}]${t.optional ? "?" : ""}`;
  });
  if (q.sentence_only) e += " within s";
  if (q.meta_attr && q.meta_value?.trim()) e += ` :: match.${q.meta_attr}="${q.meta_value.trim()}"`;
  return { corpus: q.corpus, expression: e, field };
}

function compilePlan(plan) {
  const steps = plan?.steps || [];
  if (!corpora[plan?.corpus]) throw { kind: "validation", message: "Choose a known corpus for the workflow" };
  if (steps.length < 1 || steps.length > 12) throw { kind: "validation", message: "A workflow needs 1–12 steps" };
  const lines = ["set PrettyPrint off;", `${plan.corpus};`];
  const summaries = [];
  steps.forEach((s, i) => {
    const n = i + 1;
    if (s.kind === "search") {
      const c = compile({ ...s.query, corpus: plan.corpus });
      lines.push(`Q${n} = ${c.expression};`);
      summaries.push(`${n}. Find ${c.field} = '${s.query.value}'`);
    } else if (s.kind === "refine") {
      const clause = `[${s.field}="${s.value}"${s.ignore_case ? " %c" : ""}]`;
      if (s.mode === "exclude") {
        lines.push(`R${n} = subset Q${s.source} where ${s.anchor || "match"}: ${clause};`, `Q${n} = difference Q${s.source} R${n};`);
      } else lines.push(`Q${n} = subset Q${s.source} where ${s.anchor || "match"}: ${clause};`);
      summaries.push(`${n}. ${s.mode === "exclude" ? "Exclude" : "Keep"} matches from step ${s.source} when ${s.anchor || "match"} ${s.field} = '${s.value}'${s.ignore_case ? " (case-insensitive)" : " (case-sensitive)"}`);
    } else if (s.kind === "combine") {
      lines.push(`Q${n} = ${s.method} Q${s.left} Q${s.right};`);
      summaries.push(`${n}. ${s.method[0].toUpperCase() + s.method.slice(1)} results of steps ${s.left} and ${s.right} (exact match spans)`);
    } else throw { kind: "validation", message: `Unknown type of step ${n}` };
  });
  return { script: lines.join("\n") + "\n", result_name: `Q${steps.length}`, summaries, plan };
}

const COLLOCATES = [
  ["the", 312, 4, 18, 9, 3, 61, 40, 12, 9], ["grand", 61, 2, 6, 14, 37, 0, 1, 0, 1], ["said", 48, 1, 2, 3, 1, 26, 8, 4, 3],
  ["federal", 37, 1, 3, 6, 24, 0, 1, 1, 1], ["trial", 33, 3, 4, 2, 0, 14, 6, 3, 1], ["county", 29, 2, 5, 15, 2, 1, 2, 1, 1],
  ["verdict", 26, 0, 1, 0, 0, 3, 11, 7, 4], ["members", 21, 5, 9, 2, 0, 0, 2, 2, 1], ["foreman", 18, 1, 3, 9, 0, 0, 3, 1, 1],
  ["court", 16, 4, 3, 1, 0, 2, 2, 2, 2], ["testimony", 12, 0, 0, 0, 0, 1, 2, 5, 4], ["instructions", 9, 2, 4, 1, 0, 0, 1, 0, 1],
];

const SYNTAX = [
  ["The", "DT", "the", "1", "2", "det"], ["learner", "NN", "learner", "2", "3", "nsubj"], ["wrote", "VBD", "write", "3", "0", "root"],
  ["a", "DT", "a", "4", "6", "det"], ["short", "JJ", "short", "5", "6", "amod"], ["letter", "NN", "letter", "6", "3", "dobj"],
  ["to", "TO", "to", "7", "9", "__UNDEF__"], ["her", "PRP$", "she", "8", "9", "poss"], ["teacher", "NN", "teacher", "9", "3", "prep_to"],
  [".", ".", ".", "10", "3", "punct"],
];

function fakeTerminal(op, r, style) {
  let body;
  if (op === "search") { const c = compile(r); body = `set Context ${r.context || 4} words;\n${c.corpus};\nHits = ${c.expression};\nsize Hits;\ncat Hits ${r.offset || 0} ${(r.offset || 0) + (r.limit || 25) - 1};`; }
  else if (op === "workflow") body = `${compilePlan(r.plan).script}\ncat Q${r.plan.steps.length} 0 ${(r.limit || 25) - 1};`;
  else body = `# ${op} (fixture)`;
  const head = `# Hapax — ${op}\n# read-only commands`;
  return style === "shell"
    ? `${head}\nexport LD_LIBRARY_PATH=...\n/home/s/structeng/cwb/bin/cqp -r /home/s/structeng/firth/registry <<'CQP'\n${body}\nCQP\n`
    : `${head}\n# Start CQP first:  /home/s/structeng/cwb/bin/cqp -e -r /home/s/structeng/firth/registry\n\n${body}\n`;
}

const handlers = {
  get_app_info: () => ({
    app_name: "Hapax", version: "1.0.0-dev", corpora,
    group_positions: [["First matched token", "first"], ["Last matched token", "last"], ["Immediately before match", "before"], ["Immediately after match", "after"]],
    context_sizes: [2, 4, 6, 10], preferences_path: "~/.local/share/CQPExplorer/preferences.json",
    known_hosts_path: "~/.ssh/known_hosts", events: { host_key_prompt: "ssh://host-key-prompt", connection: "ssh://connection" },
  }),
  get_preferences: () => structuredClone(prefs),
  get_console_log: () => consoleLog.slice(),
  clear_console_log: () => { consoleLog.length = 0; },
  export_console_log: ({ path }) => path,
  save_text: ({ path }) => path,
  terminal_commands: ({ op, request, style }) => fakeTerminal(op, request, style),
  terminal_from_payload: ({ payload, style }) => fakeTerminal(payload.op, payload, style),
  save_preferences: ({ preferences }) => (prefs = structuredClone(preferences)),
  save_search: ({ name, query }) => {
    compile(query);
    prefs.saved_searches = prefs.saved_searches.filter((s) => s.name !== name).concat([{ name, query }]);
    return prefs.saved_searches;
  },
  delete_saved_search: ({ name }) => (prefs.saved_searches = prefs.saved_searches.filter((s) => s.name !== name)),
  ssh_status: () => ({ connected, host: connected ? prefs.host : null, user: connected ? prefs.user : null, port: connected ? 22 : null, busy: false }),
  ssh_connect: async ({ args }) => {
    if (!args.user) throw { kind: "validation", message: "Enter host and username" };
    if (args.password === "wrong") throw { kind: "auth", message: "Authentication failed: check username and password" };
    if (params.get("hostkey") === "1") {
      const ok = await new Promise((resolve) => {
        handlers.__pending = resolve;
        emit("ssh://host-key-prompt", { request_id: "fixture-1", host: args.host, port: 22, key_type: "ssh-ed25519", fingerprint: "SHA256:s763e+KFgFWMc3DuvtG+xEApS2w4uQaOswJ3OVXrE3U", known_hosts_path: "~/.ssh/known_hosts" });
      });
      if (!ok) throw { kind: "host_key", message: "SSH server key was not trusted" };
    }
    connected = true;
    prefs.host = args.host; prefs.user = args.user;
    emit("ssh://connection", { connected: true, host: args.host, user: args.user, port: 22, busy: false });
    return { host: args.host, user: args.user, port: 22, engine: "3.5.1", used_saved_password: !args.password, warning: null };
  },
  answer_host_key: ({ trust }) => { handlers.__pending?.(trust); },
  discover_corpora: () => {
    // ?registry=changed simulates an admin removing BNC and adding a corpus.
    const changed = params.get("registry") === "changed";
    const out = {};
    for (const [k, v] of Object.entries(corpora)) out[k] = { ...v, available: !(changed && k === "BNC"), source: "verified" };
    const added = [];
    if (changed) {
      out["SPOTEST"] = { description: "Spoken Test Corpus 2026", tokens: 48213, encoding: "utf8", positional: ["word", "pos", "lemma"], structural: { text: 120, text_genre: 120, s: 3100 }, metadata: ["text_genre"], lexeme: "lemma", available: true, source: "discovered" };
      added.push("SPOTEST");
    }
    Object.assign(corpora, out);
    return { corpora: out, added, missing: changed ? ["BNC"] : [], changed: [] };
  },
  ssh_disconnect: () => { connected = false; const s = { connected: false, host: null, user: null, port: null, busy: false }; emit("ssh://connection", s); return s; },
  cancel_request: () => { cancelled = true; return true; },
  has_saved_password: () => true,
  forget_password: () => true,
  preview_query: ({ query }) => { const c = compile(query); return { ...c, cqp_command: `${c.corpus};\nGUIQuery = ${c.expression};` }; },
  interpret_search: ({ query, total }) => {
    const r = (total * 1e6) / corpora[query.corpus].tokens;
    return `Found ${total.toLocaleString("en-US")} matches for '${query.value}' by ${query.field}. Corpus-wide reference rate: ${r.toFixed(2)} matches per million indexed tokens. This counts written forms, not necessarily every grammatical form of the word. Next: read several examples, then use Count by annotation to see how they are used, or Combine searches to narrow them down.`;
  },
  compile_workflow_plan: ({ plan }) => compilePlan(plan),
  explain_workflow_result: ({ plan, total }) => `Your workflow has ${plan.steps.length} steps and found ${total} matching spans in ${plan.corpus}. Set operations compare exact matched token ranges—not documents or sentences.`,
  explain_annotation: ({ corpus, field, value }) => explain(corpus, field, value),
  explain_field: ({ field }) => { const f = codebook.fields.find((x) => x[0] === field); return { short: f?.[1] || field, full: f?.[1] || field, note: f?.[2] || "", reference: "", verified: !!f }; },
  get_glossary: ({ corpus }) => {
    const scheme = ["BNC", "BNC-BABY", "DOORCORP"].includes(corpus) ? "C5" : corpus === "BNC2014-S" ? "C7" : corpus.includes("LEGACY") ? "BROWN" : "PENN";
    const rows = Object.entries(codebook.tagsets[scheme]).sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, label]) => ({ category: "POS", code, label, note: "This is an automated classification, not a guarantee of grammatical correctness." }));
    codebook.fields.forEach(([code, label, note]) => rows.push({ category: "Field", code, label, note }));
    codebook.concepts.forEach(([code, note]) => rows.push({ category: "Concept", code, label: code, note }));
    return rows;
  },
  get_guided_questions: () => ({ modes: codebook.guided_modes, parts: codebook.parts }),
  build_guided_recipe: ({ input }) => {
    const base = { corpus: input.corpus, field: input.mode === 1 ? "lexeme" : "word", value: input.word || "go", ignore_case: true, second_field: "word", second_value: "", gap: 0, sentence_only: false, meta_attr: "", meta_value: "", regex: false };
    const c = compile(base);
    return { base, steps: null, note: input.mode === 1 ? "Finds related inflected forms through this corpus’s headword/lemma index." : "Searches word forms exactly as written (with case ignored).", preview: `Matching index: ${c.field}.\n\nAdvanced CQP preview:\n${input.corpus};\nGUIQuery = ${c.expression};`, question: codebook.guided_modes[input.mode] };
  },
};

const remote = {
  run_health: () => ({ message: "CWB runtime reachable", version: "3.5.1" }),
  run_search: ({ request }) => {
    compile(request);
    const total = totalFor(request);
    return { total, results: rowsFor(request, request.offset || 0, request.limit || 25, total, request.context || 4) };
  },
  run_frequencies: ({ request }) => {
    compile(request);
    const vals = request.group_field === "pos" ? [["NN", 61, "Singular or mass noun"], ["NN-TL", 4, "Unknown POS tag: NN-TL"], ["NN-HL", 2, "Unknown POS tag: NN-HL"]]
      : request.group_field === "word" ? [["jury", 58, null], ["Jury", 7, null], ["JURY", 2, null]] : [["SUBST", 67, "Substantive"]];
    return { total: totalFor(request), truncated: false, groups: vals.map(([value, count, m]) => ({ value, count, meaning: m || explain(request.corpus, request.group_field, value).short })) };
  },
  run_collocates: ({ request }) => {
    compile(request);
    const total = totalFor(request);
    const keys = ["Word", "Total", "L4", "L3", "L2", "L1", "R1", "R2", "R3", "R4"];
    return {
      total, sampled: Math.min(total, request.sample_limit || 100),
      groups: COLLOCATES.map((r) => {
        const o = Object.fromEntries(keys.map((k, i) => [k, String(r[i])]));
        o.Left = String(r[2] + r[3] + r[4] + r[5]); o.Right = String(r[6] + r[7] + r[8] + r[9]);
        return o;
      }),
    };
  },
  run_lexicon: ({ request }) => {
    const scheme = ["BNC", "BNC-BABY", "DOORCORP"].includes(request.corpus) ? "C5" : request.corpus.includes("LEGACY") ? "BROWN" : "PENN";
    const codes = Object.keys(codebook.tagsets[scheme]).slice(0, 40);
    return { truncated: false, groups: codes.map((value, i) => ({ value, count: Math.round(180000 / (i + 1.3)), meaning: explain(request.corpus, "pos", value).short })) };
  },
  run_metadata: ({ request }) => {
    const n = corpora[request.corpus].structural[request.attribute] || 0;
    if (n > 10000) throw { kind: "validation", message: "That attribute covers over 10,000 regions. Enter a filter value manually to avoid loading a very large metadata index on the shared server." };
    const vals = request.attribute === "text_genre" ? ["Narrative fiction", "Treatise", "Letters", "Drama", "Other"] : ["A01", "A02", "B01", "C17", "J22"];
    return { truncated: false, groups: vals.map((value, i) => ({ value, regions: Math.max(1, Math.round(n / (i + 2.2))), tokens: Math.round(9_100_000 / (i + 1.4)) })) };
  },
  run_distribution: ({ request }) => {
    const n = corpora[request.corpus].structural[request.attribute] || 0;
    if (!n) throw { kind: "validation", message: "Unknown metadata attribute" };
    const total = totalFor(request);
    const vals = request.attribute === "text_genre" ? ["Narrative fiction", "Treatise", "Letters", "Drama", "Other"] : ["A01", "A02", "B01", "C17", "J22", "K05", "L11", "N03"];
    const rows = vals.map((value, i) => { const tokens = Math.round(900_000 / (i + 1.4)); const hits = Math.round((total / vals.length) * (1.6 - i * 0.15)); return { value, hits: Math.max(0, hits), regions: Math.max(1, Math.round(n / (i + 2.2))), tokens, per_million: Number(((Math.max(0, hits) * 1e6) / tokens).toFixed(2)) }; });
    return { total, counted: total, rows, truncated: false };
  },
  run_syntax: ({ request }) => {
    const tokens = SYNTAX.map(([word, pos, lemma, id, head, rel], i) => ({ position: request.position - 2 + i, word, pos, lemma, id, head, rel }));
    return { start: request.position - 2, tokens, diagnostics: { roots: ["3"], undefined: 1, invalid_heads: [], cycle_nodes: [], sequential: true } };
  },
  run_compare: ({ request }) => {
    if (new Set(request.corpora).size !== request.corpora.length || request.corpora.length < 2) throw { kind: "validation", message: "Select 2–6 different corpora" };
    return { results: request.corpora.map((c) => { const total = totalFor({ ...(request.query || request), corpus: c }); const tokens = corpora[c].tokens; return { corpus: c, total, tokens, per_million_tokens: Number(((total * 1e6) / tokens).toFixed(4)) }; }) };
  },
  run_workflow: ({ request }) => {
    const c = compilePlan(request.plan);
    const counts = request.plan.steps.map((s, i) => ({ step: i + 1, kind: s.kind, matches: s.kind === "search" ? totalFor({ ...s.query, corpus: request.plan.corpus }) : s.kind === "refine" ? 61 : 67 + i }));
    const total = counts.at(-1).matches;
    if (request.mode === "group") return { total, groups: [{ value: "NN", count: 61, meaning: "Singular or mass noun" }, { value: "NP", count: 6, meaning: "Proper noun" }], truncated: false, step_counts: counts, sampling_method: "corpus order", seed: null, results: undefined, _script: c.script };
    const q = request.plan.steps.find((s) => s.kind === "search")?.query || { value: "x" };
    return { total, results: rowsFor({ ...q, corpus: request.plan.corpus }, request.mode === "sample" ? 7 : request.offset || 0, request.limit || 25, total), truncated: false, step_counts: counts, sampling_method: request.mode === "sample" ? "full-result seeded random ordering" : "corpus order", seed: request.mode === "sample" ? request.seed ?? 42 : null };
  },
};

const files = {
  export_table: ({ path, rows }) => ({ path, rows: rows.length, total: null, provenance_path: null }),
  export_concordance_page: ({ path, rows, total }) => ({ path, rows: rows.length, total, provenance_path: path.replace(/\.\w+$/, "_provenance.json") }),
  export_search_all: ({ path, request }) => { const t = totalFor(request); return { path, rows: Math.min(5000, t), total: t, provenance_path: path.replace(/\.\w+$/, "_provenance.json") }; },
  export_workflow_all: ({ path }) => ({ path, rows: 67, total: 67, provenance_path: path.replace(/\.\w+$/, "_provenance.json") }),
  export_workflow_view: ({ path, result }) => ({ path, rows: (result.results || result.groups || []).length, total: result.total, provenance_path: path.replace(/\.\w+$/, "_provenance.json") }),
  export_comparison: ({ path }) => ({ path, rows: 2, total: null, provenance_path: path.replace(/\.\w+$/, "_provenance.json") }),
  export_syntax: ({ path }) => path,
  workflow_save: ({ path }) => path,
  workflow_load: () => ({ corpus: "BNC-BABY", steps: [{ kind: "search", query: { field: "lexeme", value: "deliver", second_field: "class", second_value: "ADV", gap: 0, sentence_only: true } }] }),
  evidence_add: ({ notebook, corpus, rows, query }) => {
    const seen = new Set(notebook.map((r) => `${r.corpus}|${r.start}|${r.end}`));
    const added = [];
    for (const r of rows) {
      const k = `${corpus}|${r.start}|${r.end}`;
      if (seen.has(k)) continue;
      seen.add(k);
      added.push({ corpus, start: r.start, end: r.end, source: r.source || "", left: r.left, text: r.text, right: r.right, query: JSON.stringify(query), decision: "Unreviewed", note: "" });
    }
    return { rows: notebook.concat(added), added: added.length };
  },
  evidence_save: ({ path }) => path,
  evidence_open: () => [],
  evidence_export: ({ path, rows }) => ({ path, rows: rows.length, total: null, provenance_path: null }),
};

function emit(event, payload) {
  (listeners[event] || []).forEach((cb) => cb({ event, payload }));
}

export function createFixtureBackend() {
  console.info("[fixtures] Using the DEV-ONLY fixture backend. Data is synthetic.");
  return {
    kind: "fixtures",
    async invoke(cmd, args = {}) {
      await delay(cmd in remote ? LATENCY : 10);
      if (cmd in remote) {
        if (!connected) throw { kind: "not_connected", message: "Not connected. Use Connect in the SSH panel first." };
        cancelled = false;
        const req = args.request || {};
        const entry = consolePush({
          kind: "request", op: cmd.replace("run_", ""), status: "pending",
          summary: `${req.corpus || req.plan?.corpus || ""} · ${req.value ?? ""} (fixture)`,
          exec: "python3 -c '<remote worker, remote/worker.py>'   # request JSON on stdin",
          commands: "# fixture backend — the real app shows the exact CQP/CWB commands here",
          request: req,
        });
        try {
          const r = remote[cmd](args);
          if (cancelled) throw { kind: "cancelled", message: "Request interrupted." };
          const body = JSON.stringify({ ok: true, ...r }, null, 2);
          consoleUpdate(entry, { status: "ok", response: body.slice(0, 4000), response_bytes: body.length, elapsed_seconds: LATENCY / 1000 + 0.31 });
          return { data: r, elapsed_seconds: LATENCY / 1000 + 0.31, cached: false };
        } catch (err) {
          consoleUpdate(entry, { status: "error", error: err.message, elapsed_seconds: 0.05 });
          throw err;
        }
      }
      const h = handlers[cmd] || files[cmd];
      if (!h) throw { kind: "unknown", message: `Fixture has no command ${cmd}` };
      return h(args);
    },
    async listen(event, cb) {
      (listeners[event] ||= []).push(cb);
      return () => (listeners[event] = listeners[event].filter((x) => x !== cb));
    },
    save: async ({ defaultPath }) => `/tmp/fixture/${defaultPath || "export.csv"}`,
    open: async () => "/tmp/fixture/notebook.json",
    openUrl: async (u) => window.open(u, "_blank", "noopener"),
    setTheme: async () => {},
  };
}
