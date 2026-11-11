# UX overhaul — 02 Redesign spec

Builds on `01-audit.md`. Goal: the frequent loop of corpus work — **write a query → read matches →
count / spread / compare → keep evidence** — happens on one screen with the query, the result state
and the next actions visible together. Nothing that exists today is removed; it moves.

## 1. Information architecture

Six flat destinations instead of 7 sections + 9 sub-pages + duplicated tabs:

| Alt | Destination | Contains |
|---|---|---|
| 1 | **Home** | Resume (current/last search + next steps), status cards, **all saved searches and all recent searches** (run, load, delete with undo), session activity, first-run start list |
| 2 | **Search** (workspace) | Query panel (Build · Ask a question · Write CQP, filters, presets, Query panel) + result views **Matches · Counts · Nearby · Spread · Compare · Structure** |
| 3 | **Combine searches** | Unchanged model; plan now persists; Clear has Undo |
| 4 | **Corpora** | Corpus table + selected corpus with views **About · Metadata · Tags** |
| 5 | **Evidence notebook** | Table with multi-select + side review panel, batch decisions/remove |
| 6 | **Methods & help** | Methods text; shortcut table generated from the command registry |

Global chrome: top bar = page title (+ short context) · Guide button · working-corpus switcher
(always) · busy/Stop · unsaved-notebook pill (only when unsaved) · connection · console ·
shortcuts (?) · theme. Sidebar = the six destinations (collapsible to a rail), Search field for the
palette, no corpus list.

### Old → new mapping

| Old location | New location |
|---|---|
| Home | Home |
| Find examples › Search | Search › Matches |
| Find examples › Guided search | Search › query panel › **Ask a question** |
| Find examples › Saved & recent | Home › Saved searches / Recent searches |
| Analyse › Count by annotation | Search › **Counts** |
| Analyse › Nearby words | Search › **Nearby** |
| Analyse › Spread across texts | Search › **Spread** |
| Analyse › Compare corpora | Search › **Compare** (uses the query panel; per-corpus filters stay in the view) |
| Analyse › Sentence structure | Search › **Structure** (shown for EFCAM, or from a selected EFCAM match, or the palette) |
| Combine searches | Combine searches |
| Corpora › Contents & metadata | Corpora › About + Metadata |
| Corpora › Tag reference | Corpora › Tags |
| Evidence notebook | Evidence notebook |
| Methods & help | Methods & help |
| Sidebar corpus list | Top-bar corpus switcher (always visible) + palette |
| Page tabs under titles | Removed (they repeated the sidebar) |
| Top-bar breadcrumb + 34 px page title | One title in the top bar |
| Page guides (open by default) | Guide button in the top bar; panel opens under it |
| Help › Shortcuts list | Shortcut overview (`?`, palette, top-bar button) + Help table, both from one registry |

All old screen ids stay valid through `canonicalScreen` aliases (palette history, saved state,
in-app jumps), each mapped to the new place and view.

## 2. Consolidation map

| Before | After | How every variant's ability is kept |
|---|---|---|
| Topbar breadcrumb, PageHeader h2, page Tabs | `PageHeader` portals title + context into the top bar | Title, context (“BNC · 112M tokens”, “unsaved changes”), guide all kept |
| Sidebar sub-items + Tabs + Alt-first-child | Flat sidebar + result-view tabs inside Search + Corpora views | Every sub-page is a view with its own key (Ctrl+1…6) and palette entry |
| Sidebar corpus list + collapsed-only switcher | One `CorpusSwitcher`, always in the top bar | Groups by variety, flags, sizes (tokens/words), offline/unsupported states, descriptions in titles |
| `QuerySummary`, `SearchChips`, Saved chip rows | `QueryChips` | Corpus dot, query label, sequence words, sentence limit, filters |
| Home lists + Saved page | `SearchList` on Home | Run, load (edit), delete (undo) on saved; run, load on recent; dates and totals |
| 3 popover-dismiss implementations | `useDismiss` in `ui.jsx` | Outside click, Escape returns focus to trigger |
| 11 table-wrap blocks | `ScrollTable` in `ui.jsx` | Keyboard-scrollable region with name and max height |
| 5 analysis pages with own “current search” card and notices | `ResultViews` in Search with one result bar | One stale/none state for all views; each view keeps its own controls and result |
| Guided search page | Query panel mode **Ask a question** | All 9 question types, preview, Use in Search (now: fills Build), Open in Combine |
| Compare's own query builder | The query panel | Edit the query on the left; corpora and per-corpus filters in the Compare view |
| Tag reference (in Analysis) | Corpora › Tags following the selected corpus | Codes used (server), codebook filter, explain |
| Confirm dialog for saved-search delete | Undo toast | Same pattern as evidence and presets |

## 3. Layout model

```
┌ sidebar ┐┌ top bar: Title · context  [Guide]   [Corpus ▾] [busy|Stop] [● unsaved] [conn] [⌘] [?] [◐] ┐
│ Home    ││┌ query panel (sticky) ┐┌ result bar: 4,530 matches · 41.2 per million tokens · 0.8 s · stale? ┐│
│ Search  │││ Build|Ask|Write CQP  ││ Matches | Counts | Nearby | Spread | Compare | Structure            ││
│ Combine │││ corpus, value, words ││ view controls (sort/page · field/position · sample · attribute)    ││
│ Corpora │││ filters, presets     ││ view result                                                        ││
│ Evidence│││ [Save] [Search]      ││ selected match inspector                                           ││
│ Help    │││ Query (CQP)          │└────────────────────────────────────────────────────────────────────┘│
└─────────┘└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

* ≥ 1280 px: two columns; the query panel (380 px) scrolls on its own and stays beside the results.
* < 1280 px: query panel above results; **Focus results** hides it (as today).
* The result bar is shared by all views: total, rate (tokens/words switch), time, “results are from an
  earlier query — Run again”, and the views. Each view keeps its last result per search, so moving
  between Matches and Counts loses nothing.
* Corpora: table on top, selected corpus below with About · Metadata · Tags.
* Evidence: table left, review panel right (sticky), so the selected line, its decision keys and its
  note are always on screen.

## 4. Interaction principles (applied everywhere)

1. **Frequent = one click or one key.** Run (Ctrl+Enter), run the current view (Ctrl+Shift+Enter),
   switch view (Ctrl+1…6), page (Alt+←/→), go to match (Ctrl+G), focus query (Ctrl+L), save (Ctrl+S),
   export page (Ctrl+E), add page to evidence (Ctrl+Shift+E), palette (Ctrl+K), shortcuts (?).
2. **Progressive disclosure, not separate screens**: Ask / Build / Write CQP in one panel; Advanced and
   presets stay folded; guides on demand.
3. **One command registry** (`src/commands.js`) drives the palette, the shortcut overview, Help's table
   and the key handler, so a shortcut can't exist without being listed.
4. **Inline over modal**: guided questions and compare settings move inline; dialogs stay only for
   connect, host key, save name, partial export, plan preview and step editing.
5. **Persistent state** (per viewer, `localStorage`, wrapped in try/catch): last screen, result view,
   view settings (page size, context, sort, count field/position, sample size, spread attribute/min
   size/order, compare corpora), Corpora selection and view, Combine plan, sidebar collapse, units.
6. **Always-visible status**: running request + Stop, unsaved notebook pill, stale results banner,
   connection pill, console error badge.
7. **Batch where users repeat**: evidence multi-select (mark, remove), select all shown.
8. **Proportional safety**: undo for list removals (saved searches, evidence rows, presets, Combine
   Clear); confirm only for the partial 5,000-row export (it costs server time) .

## 5. Visual system

The design language (supplied by the project owner, see `docs/design-principles.md`) is kept:
palette, fonts, radii, surfaces. Departures are density only, each for a measured gain:

| Token | Old | New | Why |
|---|---|---|---|
| `--header-h` | 64 px | 52 px | Top bar now carries the title; 12 px back for content |
| `--sidebar-w` | 280 px | 224 px | No corpus list; labels fit; 56 px more for the workspace |
| `--fs-display` (page title) | 34 px | moves to the top bar at `--fs-title-page` 17 px | The title is orientation, not content; ~70 px back |
| `--content-pad` | 30 px | 24 px | Denser work tool; still the 8-px rhythm |
| `--panel-w` (new) | — | 380 px | Query panel width: Find by + Value fit side by side |
| `--space-section` (new) | — | 16 px | One gap between workspace blocks |

Motion, radii, colours and semantic states (`--positive`, `--warning`, `--negative`, `--info`) are
unchanged. All tokens stay in `src/styles/tokens.css`.

## 6. Before / after (projected; real numbers in 03-report)

| Task | Before (measured) | Projected after | Main change |
|---|---|---|---|
| T1 Search a word | 3 | 3 (2 by keyboard: Ctrl+L, type, Ctrl+Enter) | Value box above the fold |
| T2 Count by POS | 3, concordance gone | 3, concordance one key away, query visible | Counts view |
| T3 Spread | 3, 2 screens | 2, 0 screens | Spread view |
| T4 Compare 3 corpora | 5, 2 screens | 4, 0 screens | Compare view |
| T5 Tag for “plural noun” | 7, 3 screens, memory | 3, 0 screens | Suggestions (already) + no detour |
| T6 Rerun saved search | 2 | 1 (Run on Home) | Run buttons on Home |
| T7 Evidence: add + judge 3 | 6 | 6, review beside table | Pill / Ctrl+Shift+E |
| T8 Metadata value → filter | 6, 3 screens | 5, 2 screens | No section memory detour |
| T9 Guided question → run | 5, 3 screens | 4, 0 screens | Ask mode |
| T10 Switch corpus | 1 wide / 2 narrow | 2 everywhere | One switcher |
| T11 EFCAM match → structure | 6, 2 screens | 5, 0 screens | Structure view |
| T12 Matches + counts together | impossible | both kept, one key apart, query and total always visible | Workspace |

T10 gets one click slower on wide windows; accepted because the same control now works at every
width and the sidebar loses 45 % of its height.

## 7. Risks and open questions

* **Bundle size of Search**: analysis views load lazily inside the workspace, as the pages did.
* **Compare without its own builder**: comparing a query that differs from the current search now
  means editing the query panel. Nuance kept: the Compare view states which query it runs.
* **Structure for non-EFCAM corpora**: the view appears only when relevant; the palette entry opens
  it anyway (the tool always reads EFCAM).
* **Saved state from older versions**: `cqp.sidebar`, guide keys, query draft, presets, units stay
  readable; analysis results were never persisted, so nothing to migrate there.
* **Older automated checks** in the scratchpad target removed selectors (tabs, sidebar corpus list);
  they are replaced by a new walkthrough suite rather than patched.
* **Shortcuts in a browser preview**: Ctrl+1…6 switch browser tabs in Chrome; in the Tauri app they
  are free. The palette and buttons cover the preview.

## 8. Decisions for the user (proceeding with the recommendation)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Analyses become views of the Search workspace; the *Find examples* and *Analyse results* sections and their sub-menus disappear (this also supersedes the sidebar accordion tuned on 2026-11-11). | **Do it** — removes 2 screen changes from every analysis and keeps the query in view. |
| D2 | Sidebar corpus list removed; the top-bar switcher is the one place to change corpus. | **Do it** — one control at every window width; costs one click on wide windows. |
| D3 | Guides closed by default, opened from the top bar. | **Do it** — puts the value box above the fold for new users. |
| D4 | Compare uses the query panel instead of its own builder. | **Do it** — one query, one place. |
| D5 | Saved & recent page merged into Home. | **Do it** — Home is where resuming already happens. |
