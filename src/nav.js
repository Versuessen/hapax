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
  { id: "BROWN", label: "Brown family", color: "var(--accent-blue)", corpora: ["BROWN-LEGACY", "FLOB-LEGACY", "FROWN-LEGACY", "LOB-LEGACY"] },
  { id: "PENN", label: "Penn-style", color: "var(--accent-pink)", corpora: ["CLMET"] },
  { id: "DEP", label: "Penn + dependencies", color: "var(--accent-violet)", corpora: ["EFCAM"] },
];

export const corpusColor = (name) => FAMILIES.find((f) => f.corpora.includes(name))?.color || "var(--text-3)";
const DISCOVERED = { id: "NEW", label: "Found on the server", color: "var(--text-3)", corpora: [] };
export const corpusFamily = (name) => FAMILIES.find((f) => f.corpora.includes(name)) || DISCOVERED;
export const CORPUS_ORDER = FAMILIES.flatMap((f) => f.corpora);

/** Every corpus in the live inventory: known ones in family order, then corpora
 *  found on the server (alphabetical). Unavailable ones are kept so the user
 *  sees that they exist but are offline. */
export function orderedCorpora(info) {
  if (!info?.corpora) return [];
  const known = CORPUS_ORDER.filter((c) => info.corpora[c]);
  const extra = Object.keys(info.corpora).filter((c) => !CORPUS_ORDER.includes(c)).sort();
  return [...known, ...extra];
}

/** Searchable right now: present on the server with a charset CWB accepts. */
export const isSearchable = (ci) => !!ci && ci.available !== false && ci.encoding !== "<unsupported>";
