import {
  CircleHelp, Database, LayoutGrid, NotebookPen, TextSearch, Workflow,
} from "lucide-react";
import { ui } from "./lib/uiState.js";

/**
 * Six destinations, in the order research usually happens. Search is one
 * workspace whose result views replace the former Analyse pages; Corpora has
 * three views. Screen ids are "search/<view>" and "corpora/<view>".
 */
export const SEARCH_VIEWS = [
  { id: "matches", label: "Matches" },
  { id: "counts", label: "Counts" },
  { id: "nearby", label: "Nearby" },
  { id: "spread", label: "Spread" },
  { id: "compare", label: "Compare" },
  { id: "structure", label: "Structure" },
];
export const CORPORA_VIEWS = [
  { id: "about", label: "About" },
  { id: "metadata", label: "Metadata" },
  { id: "tags", label: "Tags" },
];

export const NAV = [
  { id: "home", label: "Home", icon: LayoutGrid },
  { id: "search", label: "Search", icon: TextSearch, views: SEARCH_VIEWS },
  { id: "combine", label: "Combine searches", icon: Workflow },
  { id: "corpora", label: "Corpora", icon: Database, views: CORPORA_VIEWS },
  { id: "evidence", label: "Evidence notebook", icon: NotebookPen, meta: "evidence" },
  { id: "help", label: "Methods & help", icon: CircleHelp },
];

/** Older screen ids (links, saved state, in-app jumps) -> current ids. */
const ALIASES = {
  overview: "home",
  saved: "home",
  "find/saved": "home",
  find: "search/matches",
  "find/search": "search/matches",
  learn: "search/matches",
  "find/guided": "search/matches",
  analysis: "search/counts",
  analyse: "search/counts",
  "analysis/frequencies": "search/counts",
  "analyse/counts": "search/counts",
  "analysis/collocates": "search/nearby",
  "analyse/nearby": "search/nearby",
  "analysis/distribution": "search/spread",
  "analyse/spread": "search/spread",
  "workflows/compare": "search/compare",
  "analyse/compare": "search/compare",
  syntax: "search/structure",
  "analyse/syntax": "search/structure",
  "analysis/codes": "corpora/tags",
  corpus: "corpora",
  "corpora/details": "corpora/about",
  workflows: "combine",
  "workflows/builder": "combine",
};

/** Guided search lives in the query panel now; these ids open it there. */
export const ASK_IDS = new Set(["learn", "find/guided"]);

/**
 * Current id for any id. A bare workspace id ("search", "corpora") opens the
 * view used last there.
 */
export function canonicalScreen(id) {
  const x = ALIASES[id] || id || "home";
  const n = NAV.find((v) => v.id === x);
  if (n?.views) {
    const last = ui.get(`view.${n.id}`);
    return `${n.id}/${n.views.some((v) => v.id === last) ? last : n.views[0].id}`;
  }
  const [head, view] = x.split("/");
  const parent = NAV.find((v) => v.id === head);
  if (!parent) return "home";
  if (parent.views && !parent.views.some((v) => v.id === view)) return `${head}/${parent.views[0].id}`;
  return parent.views ? x : head;
}

/** Alt+1…6 order. */
export const SCREENS = NAV.map((n) => n.id);

export function findNav(screen) {
  const id = canonicalScreen(screen);
  const [head, view] = id.split("/");
  const item = NAV.find((n) => n.id === head) || NAV[0];
  return { item, view: item.views?.find((v) => v.id === view) || null };
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
