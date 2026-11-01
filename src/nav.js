import {
  ChartLine, CircleHelp, Database, LayoutGrid, NotebookPen, TextSearch, Workflow,
} from "lucide-react";

/**
 * Navigation is organised by task, in the order research usually happens:
 * find examples -> analyse them -> combine searches -> check the corpus -> keep evidence.
 */
export const NAV = [
  { id: "home", label: "Home", icon: LayoutGrid },
  {
    id: "find", label: "Find examples", icon: TextSearch,
    children: [
      { id: "find/search", label: "Search" },
      { id: "find/guided", label: "Guided search" },
      { id: "find/saved", label: "Saved & recent", meta: "saved" },
    ],
  },
  {
    id: "analyse", label: "Analyse results", icon: ChartLine,
    children: [
      { id: "analyse/counts", label: "Count by annotation" },
      { id: "analyse/nearby", label: "Nearby words" },
      { id: "analyse/spread", label: "Spread across texts" },
      { id: "analyse/compare", label: "Compare corpora" },
      { id: "analyse/syntax", label: "Sentence structure" },
    ],
  },
  { id: "combine", label: "Combine searches", icon: Workflow },
  {
    id: "corpora", label: "Corpora", icon: Database,
    children: [
      { id: "corpora/details", label: "Contents & metadata" },
      { id: "corpora/tags", label: "Tag reference" },
    ],
  },
  { id: "evidence", label: "Evidence notebook", icon: NotebookPen, meta: "evidence" },
  { id: "help", label: "Methods & help", icon: CircleHelp },
];

/** Older screen ids (links, saved state, in-app jumps) -> current ids. */
const ALIASES = {
  overview: "home",
  search: "find/search",
  learn: "find/guided",
  saved: "find/saved",
  find: "find/search",
  analysis: "analyse/counts",
  "analysis/frequencies": "analyse/counts",
  "analysis/collocates": "analyse/nearby",
  "analysis/distribution": "analyse/spread",
  "analysis/codes": "corpora/tags",
  analyse: "analyse/counts",
  workflows: "combine",
  "workflows/builder": "combine",
  "workflows/compare": "analyse/compare",
  syntax: "analyse/syntax",
  corpus: "corpora/details",
  corpora: "corpora/details",
};

export function canonicalScreen(id) {
  return ALIASES[id] || id || "home";
}

/** Flat list in Alt+1…7 order (first child of each group). */
export const SCREENS = NAV.map((n) => (n.children ? n.children[0].id : n.id));

export function findNav(screen) {
  const id = canonicalScreen(screen);
  for (const n of NAV) {
    if (n.id === id) return { item: n };
    const c = n.children?.find((x) => x.id === id);
    if (c) return { item: n, child: c };
  }
  return { item: NAV[0] };
}

/**
 * Tagset families double as the accent colour of each corpus — so the five
 * reference accents carry meaning (which annotation scheme) instead of decoration.
 */
export const FAMILIES = [
  { id: "C5", label: "BNC · C5 tags", color: "var(--accent-yellow)", corpora: ["BNC", "BNC-BABY", "DOORCORP"] },
  { id: "C7", label: "BNC2014 · CLAWS7", color: "var(--accent-green)", corpora: ["BNC2014-S"] },
  { id: "BROWN", label: "Brown family", color: "var(--accent-blue)", corpora: ["BROWN-LEGACY", "LOB-LEGACY", "FROWN-LEGACY", "FLOB-LEGACY"] },
  { id: "PENN", label: "Penn-style", color: "var(--accent-pink)", corpora: ["CLMET"] },
  { id: "DEP", label: "Penn + dependencies", color: "var(--accent-violet)", corpora: ["EFCAM"] },
];

export const corpusColor = (name) => FAMILIES.find((f) => f.corpora.includes(name))?.color || "var(--text-3)";
const DISCOVERED = { id: "NEW", label: "Found on the server", color: "var(--text-3)", corpora: [] };
export const corpusFamily = (name) => FAMILIES.find((f) => f.corpora.includes(name)) || DISCOVERED;
export const CORPUS_ORDER = FAMILIES.flatMap((f) => f.corpora);

/**
 * Language varieties, in sidebar order. `variety` on a corpus is a BCP 47-style
 * tag (en-GB, en-US, …), `en-learner`, a bare language code, or null.
 */
export const VARIETIES = [
  { id: "en-GB", label: "British English", flag: "GB" },
  { id: "en-US", label: "American English", flag: "US" },
  { id: "en-AU", label: "Australian English", flag: "AU" },
  { id: "en-NZ", label: "New Zealand English", flag: "NZ" },
  { id: "en-CA", label: "Canadian English", flag: "CA" },
  { id: "en-IE", label: "Irish English", flag: "IE" },
  { id: "en-IN", label: "Indian English", flag: "IN" },
  { id: "en-learner", label: "Learner English", kind: "learner" },
];
const LANGS = { en: "English", de: "German", fr: "French", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese", sv: "Swedish", ru: "Russian", zh: "Chinese", ja: "Japanese" };

export function varietyInfo(v) {
  const known = VARIETIES.find((x) => x.id === v);
  if (known) return known;
  if (v) {
    const base = v.split("-")[0].toLowerCase();
    return { id: v, label: LANGS[base] ? `${LANGS[base]} (variety unknown)` : `Language: ${v}`, kind: "language" };
  }
  return { id: "unknown", label: "Variety unknown", kind: "unknown" };
}

const varietyRank = (v) => {
  const i = VARIETIES.findIndex((x) => x.id === v);
  return i >= 0 ? i : v ? VARIETIES.length : VARIETIES.length + 1; // other languages, then unknown
};

/** Every corpus in the live inventory, grouped by language variety (British,
 *  American, …, learner, other, unknown); within a group, known corpora keep
 *  their family order and discovered ones follow alphabetically. Unavailable
 *  corpora are kept so the user sees that they exist but are offline. */
export function orderedCorpora(info) {
  if (!info?.corpora) return [];
  const pos = (c) => { const i = CORPUS_ORDER.indexOf(c); return i < 0 ? 1e6 : i; };
  return Object.keys(info.corpora).sort((a, b) => {
    const r = varietyRank(info.corpora[a].variety) - varietyRank(info.corpora[b].variety);
    if (r) return r;
    return pos(a) - pos(b) || a.localeCompare(b);
  });
}

/** orderedCorpora split into labelled variety groups for lists. */
export function corporaByVariety(info) {
  const groups = [];
  for (const c of orderedCorpora(info)) {
    const v = info.corpora[c].variety || null;
    const key = v || "unknown";
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, variety: v, info: varietyInfo(v), corpora: [] }));
    g.corpora.push(c);
  }
  return groups;
}

/** Searchable right now: present on the server with a charset CWB accepts. */
export const isSearchable = (ci) => !!ci && ci.available !== false && ci.encoding !== "<unsupported>";
