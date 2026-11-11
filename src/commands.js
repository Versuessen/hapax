import { useMemo } from "react";
import { useApp } from "./state/store.jsx";
import { CORPORA_VIEWS, NAV, SEARCH_VIEWS } from "./nav.js";
import { isMac } from "./lib/platform.js";

/**
 * Every command the app offers from the keyboard or the palette, in one place.
 * The palette lists them, the key handler (App.jsx) runs them, and the
 * shortcut overview and Help's table print them — so a shortcut cannot exist
 * without being listed, and the lists cannot drift from what the keys do.
 *
 * `keys`: { key, mod?, shift?, alt? } — `mod` is Ctrl (⌘ on macOS). Keys
 * without a modifier never fire while typing in a field.
 * `run` may be absent for keys handled locally (evidence judgements).
 */
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export function keyLabel(k) {
  if (!k) return [];
  const parts = [];
  if (k.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (k.alt) parts.push(isMac ? "⌥" : "Alt");
  if (k.shift) parts.push("Shift");
  const names = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Enter: "Enter", Escape: "Esc", "`": "`" };
  parts.push(names[k.key] || (k.key.length === 1 ? k.key.toUpperCase() : k.key));
  return parts;
}

export function matches(k, e) {
  if (!k) return false;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!!k.mod !== mod || !!k.alt !== e.altKey) return false;
  if (k.key === "?") return e.key === "?";
  if (!!k.shift !== e.shiftKey) return false;
  if (/^[0-9]$/.test(k.key)) return e.key === k.key || e.code === `Digit${k.key}`;
  if (k.key === "`") return e.key === "`" || e.code === "Backquote";
  return e.key.toLowerCase() === k.key.toLowerCase();
}

export function useCommands() {
  const app = useApp();
  const { screen, setScreen, setDialog, setConsoleOpen, theme, toggleUnit, setGuideOpen, setQuery, setSearch, setAsking } = app;
  const inSearch = screen.startsWith("search");
  return useMemo(() => {
    const toSearch = (fn) => () => { if (!screen.startsWith("search")) setScreen("search"); setTimeout(fn, 30); };
    const list = [
      // ---- go to ----
      ...NAV.map((n, i) => ({
        id: `go.${n.id}`, group: "Go to", label: n.label, keys: { key: String(i + 1), alt: true }, run: () => setScreen(n.id),
      })),
      { id: "go.help.f1", group: "Go to", label: "Methods & help", keys: { key: "F1" }, run: () => setScreen("help"), hidden: true },
      ...SEARCH_VIEWS.map((v, i) => ({
        id: `view.${v.id}`, group: "Search views", label: `${v.label}${v.id === "structure" ? " (EFCAM sentence structure)" : ""}`,
        keys: { key: String(i + 1), mod: true }, run: () => setScreen(`search/${v.id}`),
      })),
      ...CORPORA_VIEWS.map((v) => ({ id: `corpora.${v.id}`, group: "Corpora views", label: `Corpora › ${v.label}`, run: () => setScreen(`corpora/${v.id}`) })),
      // ---- search ----
      { id: "search.run", group: "Search", label: "Run the search", keys: { key: "Enter", mod: true }, run: () => { if (!screen.startsWith("search")) setScreen("search/matches"); setTimeout(() => emit("cqp:search"), 30); } },
      { id: "search.runView", group: "Search", label: "Run the open view (Count, Compare, Inspect…)", keys: { key: "Enter", mod: true, shift: true }, when: () => inSearch, run: () => emit("hapax:run-view") },
      { id: "search.focus", group: "Search", label: "Go to the query (value or CQP box)", keys: { key: "l", mod: true }, run: toSearch(() => document.querySelector("[data-search-term]")?.focus()) },
      { id: "search.next", group: "Search", label: "Next page of matches", keys: { key: "ArrowRight", alt: true }, when: () => screen === "search/matches", run: () => emit("hapax:page", 1) },
      { id: "search.prev", group: "Search", label: "Previous page of matches", keys: { key: "ArrowLeft", alt: true }, when: () => screen === "search/matches", run: () => emit("hapax:page", -1) },
      { id: "search.goto", group: "Search", label: "Go to match number…", keys: { key: "g", mod: true }, when: () => screen === "search/matches", run: () => document.getElementById("goto-match")?.focus() },
      { id: "search.save", group: "Search", label: "Save the search", keys: { key: "s", mod: true }, when: () => inSearch, run: () => emit("cqp:save") },
      { id: "search.export", group: "Search", label: "Export this page of matches", keys: { key: "e", mod: true }, when: () => screen === "search/matches", run: () => emit("cqp:export") },
      { id: "search.evidence", group: "Search", label: "Add this page to the evidence notebook", keys: { key: "e", mod: true, shift: true }, when: () => screen === "search/matches", run: () => emit("hapax:add-evidence") },
      { id: "search.new", group: "Search", label: "New search (clear the query)", keywords: "empty reset", run: toSearch(() => { setQuery((q) => ({ ...q, value: "", next: [], second_value: "", cqp: "", manual: false })); setSearch(null); setAsking(false); document.querySelector("[data-search-term]")?.focus(); }) },
      { id: "mode.form", group: "Search", label: "Query: Build", run: toSearch(() => { setAsking(false); setQuery((q) => ({ ...q, manual: false })); }) },
      { id: "mode.ask", group: "Search", label: "Query: Ask a question (guided search)", run: toSearch(() => setAsking(true)) },
      { id: "mode.cqp", group: "Search", label: "Query: Write CQP", run: toSearch(() => { setAsking(false); setQuery((q) => ({ ...q, manual: true })); }) },
      // ---- evidence (local keys, listed here so they appear in the overview) ----
      { id: "ev.save", group: "Evidence notebook", label: "Save the notebook…", keys: { key: "s", mod: true }, when: () => screen === "evidence", run: () => emit("hapax:save-notebook") },
      { id: "ev.relevant", group: "Evidence notebook", label: "Mark relevant (and go to the next unreviewed)", keys: { key: "1" }, local: true },
      { id: "ev.irrelevant", group: "Evidence notebook", label: "Mark irrelevant", keys: { key: "2" }, local: true },
      { id: "ev.unsure", group: "Evidence notebook", label: "Mark unsure", keys: { key: "3" }, local: true },
      { id: "ev.reset", group: "Evidence notebook", label: "Reset to unreviewed", keys: { key: "0" }, local: true },
      { id: "ev.move", group: "Evidence notebook", label: "Previous / next example", keys: { key: "ArrowUp" }, local: true, alsoKeys: { key: "ArrowDown" } },
      // ---- app ----
      { id: "app.palette", group: "App", label: "Command palette", keys: { key: "k", mod: true }, run: () => setDialog((d) => (d === "palette" ? null : "palette")), always: true, hidden: true },
      { id: "app.shortcuts", group: "App", label: "Keyboard shortcuts", keys: { key: "?" }, run: () => setDialog("shortcuts") },
      { id: "app.guide", group: "App", label: "Show or hide this page's guide", keys: { key: "/", mod: true }, run: () => setGuideOpen((o) => !o) },
      { id: "app.console", group: "App", label: "Show or hide the console (commands sent, replies)", keys: { key: "`", mod: true }, run: () => setConsoleOpen((o) => !o), always: true },
      { id: "app.units", group: "App", label: "Switch rates between per million tokens and words", keywords: "units per million normalise", run: () => toggleUnit() },
      { id: "app.connect", group: "App", label: "Connection settings…", run: () => setDialog("connect") },
      { id: "app.theme.dark", group: "App", label: "Theme: Dark", run: () => theme.setPref("dark") },
      { id: "app.theme.light", group: "App", label: "Theme: Light", run: () => theme.setPref("light") },
      { id: "app.theme.system", group: "App", label: "Theme: Follow system", run: () => theme.setPref("system") },
      { id: "app.updates", group: "App", label: "Check for updates", run: () => emit("hapax:check-updates") },
      { id: "app.close", group: "App", label: "Close a dialog, menu or suggestion list", keys: { key: "Escape" }, local: true },
    ];
    return list;
  }, [screen, inSearch, setScreen, setDialog, setConsoleOpen, theme, toggleUnit, setGuideOpen, setQuery, setSearch, setAsking]); // eslint-disable-line react-hooks/exhaustive-deps
}
