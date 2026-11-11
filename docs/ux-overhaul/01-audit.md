# UX overhaul — 01 Audit

Date: 2026-11-11 · Code state: `fe8af43` (main + one unpushed notes-format commit).
Method: read every screen, component, the store and the styles; walked twelve frequent tasks in the
running app (fixture backend, 1440×900) with a script that counts every click, text entry, select
change and key press (`scratchpad/ux/before.cjs`). Fold positions measured at 1440×900, 1280×800 and
1024×768 (`fold.cjs`, `fold2.cjs`). Nothing here is estimated unless marked *(judgement)*.

---

## 1. Screen and route inventory

Screens are state, not URLs: `screen` in `src/state/store.jsx`, ids in `src/nav.js` (old ids are
aliased by `canonicalScreen`). The sidebar has 7 top-level entries, 3 of them with sub-pages that are
**also** repeated as tabs under each page title (`PageHeader` → `Tabs`).

| Id | Title | Purpose | Reached from | File |
|---|---|---|---|---|
| `home` | Home | Resume: connection, working corpus, evidence stats, current/last search with next steps, 5 recent, 5 saved, session activity | Sidebar, Alt+1, palette, brand | `screens/Overview.jsx` |
| `find/search` | Search | Build query (form or typed CQP), filters, run, read concordance, page/sort/go-to, select match, save, export, copy, add page to evidence | Sidebar ▸ Find examples, tab, Alt+2, Ctrl+Enter, Ctrl+L, palette, many “Open search” buttons | `screens/Search.jsx`, `components/QueryBuilder.jsx` |
| `find/guided` | Guided search | Build a query from a plain-language question; send to Search or Combine | Sidebar sub-item, tab, Home start list, palette | `screens/Learn.jsx` |
| `find/saved` | Saved & recent | Full lists: saved searches (edit/run/delete with confirm), 20 recent (edit/run) | Sidebar sub-item, tab, Home “All”/“Manage” | `screens/Saved.jsx` |
| `analyse/counts` | Count by annotation | Group current search's matches by an annotation and position; extra corpora with own filters; explain a code | Sidebar, tab, Alt+3, “Analyse these matches”, Home | `screens/Analysis.jsx` (`Frequencies`) |
| `analyse/nearby` | Nearby words | Positional collocates L4–R4 of first N matches, chart + table | Sidebar sub-item, tab | `Analysis.jsx` (`Collocates`) |
| `analyse/spread` | Spread across texts | Matches per metadata value with per-million rates, Brown genre roll-up, min size | Sidebar sub-item, tab, Home | `Analysis.jsx` (`Distribution`) |
| `analyse/compare` | Compare corpora | Same search in 2–6 corpora, per-corpus filters, rates, LL | Sidebar sub-item, tab, Home | `screens/Workflows.jsx` (`Compare`) |
| `analyse/syntax` | Sentence structure | EFCAM dependency arcs + table for a token position | Sidebar sub-item, tab, “Inspect syntax” on a selected EFCAM match | `screens/Syntax.jsx` |
| `combine` | Combine searches | Multi-step plan: search / keep-remove / union-intersection-difference; run as matches, counts, sample; open/save plan; preview CQP | Sidebar, Alt+4, Guided “Open in Combine” | `Workflows.jsx` (`Builder`, `StepEditor`) |
| `corpora/details` | Contents & metadata | Corpus table (sortable), corpus card, caveats, token attributes, metadata values → use as filter, re-check registry | Sidebar, tab, Alt+5, Home stat card | `screens/Corpus.jsx` |
| `corpora/tags` | Tag reference | Codes used in a corpus (server, with freq) + offline codebook with filter; explain a code | Sidebar sub-item, tab | `Analysis.jsx` (`Codes`) |
| `evidence` | Evidence notebook | KPI cards, decision filter, table, review card (keys 1/2/3/0), note, remove with undo, open/save JSON, export CSV | Sidebar, Alt+6, Home stat card | `screens/Evidence.jsx` |
| `help` | Methods & help | What numbers mean, shortcuts list, reset guides, links | Sidebar, Alt+7, F1 | `screens/Help.jsx` |

Overlays and panels:

| Overlay | Purpose | Trigger | File |
|---|---|---|---|
| Connect dialog | Host/user/port/password, remember/forget password, disconnect, error help; resumes a refused run | Status pill, any remote run while offline, palette | `components/Dialogs.jsx` |
| Host-key dialog | Trust an unknown SSH key | Connect | `Dialogs.jsx` |
| Command palette | Jump to screens, corpora, recent, saved; theme, connection, console, updates | Ctrl+K, sidebar search field | `Dialogs.jsx` |
| Console panel (drawer) | Every request: CQP/commands, raw reply, timing; filter, copy, terminal commands, export, clear | Ctrl+\`, top-bar icon | `components/ConsolePanel.jsx` |
| Query panel (inline) | Generated CQP; cqp> / shell script; copy; save | Under every search form | `components/TerminalBlock.jsx` |
| Step editor (dialog) | Add/edit a Combine step (search uses full QueryBuilder) | Combine | `Workflows.jsx` |
| Generated-CQP dialog | Workflow script + terminal commands | Combine ▸ Preview CQP | `Workflows.jsx` |
| Save-search dialog | Name, replace warning | Search ▸ Save, Ctrl+S | `Search.jsx` |
| Export-5,000 confirm | Partial-export warning | Search | `Search.jsx` |
| Delete saved search confirm | | Saved | `Saved.jsx` |
| Update notice | New version, notes, install | Start-up, palette | `components/UpdateNotice.jsx` |
| Toasts | Feedback, Undo actions | everywhere | `Dialogs.jsx` |
| Theme menu, corpus switcher menu, filter-presets menu, value picker, suggestion lists | | Top bar / forms | `Topbar.jsx`, `FilterPresets.jsx`, `FilterEditor.jsx`, `Suggest.jsx` |
| Page guide (collapsible) | Purpose, steps, notes per screen | Every page header | `PageHeader.jsx`, `guides.js` |
| Narrow drawer | Full sidebar as overlay < 1100 px | Rail toggle | `App.jsx`, `Sidebar.jsx` |

## 2. Component inventory and consolidation candidates

76 exported components, hooks and helpers in `components/` and `screens/`. Groups that do the same job:

| # | Group | Members | Verdict |
|---|---|---|---|
| G1 | **Page title / location** | `Topbar` h1 breadcrumb (section › page) **and** `PageHeader` h2 (page title) **and** `Tabs` repeating the sidebar's sub-items | **Consolidate**: three indicators of one fact; the tabs duplicate the sidebar sub-nav item for item |
| G2 | **Navigation to sub-pages** | Sidebar sub-items, page `Tabs`, Alt+digit (first child only), palette | **Consolidate** with G1 |
| G3 | **Working-corpus picker** | Sidebar corpus list (wide), `CorpusSwitcher` menu (top bar, only when collapsed/narrow), Search form `Corpus` select, palette corpora | **Consolidate**: list and switcher show the same groups, flags, sizes, states |
| G4 | **Search summary chips** | `QuerySummary` (Analysis), `SearchChips` (Overview), inline chip rows ×2 (Saved), `describe()` (Workflows) | **Consolidate** into one `QueryChips` |
| G5 | **Saved / recent lists** | Home lists (5 + 5), Saved page (full), palette groups | **Consolidate**: one list component, one page |
| G6 | **Popover dismissal** | `useDismiss` (Topbar), own effect in `ThemeMenu`, own effect in `FilterPresets`, Suggest blur logic | **Consolidate** into one hook/popover |
| G7 | **Scrollable result tables** | 11 hand-written `<div tabIndex=0 role=region className="table-wrap" style={{--table-max}}>` blocks across Analysis (5), Corpus (3), Evidence, Syntax, Workflows | **Consolidate** into `ScrollTable` |
| G8 | **Analysis screens** | `Frequencies`, `Collocates`, `Distribution`, `Compare` (in Workflows!), `Syntax` — each a separate page with its own “current search” summary card and stale/none notices (`BaseNotice`) | **Consolidate** into result views of the Search workspace |
| G9 | **Code explanation** | `ExplainPanel` (counts, tag reference), `FieldNote` (corpus), suggestion labels | Keep `ExplainPanel`; tag reference becomes part of Corpora |
| G10 | **Query entry** | `QueryBuilder` (Build / Write CQP), `Learn` (guided form + preview), Compare's builder copy, step editor | **Consolidate** Guided into the QueryBuilder as a third way in |
| G11 | **Destructive confirmation** | Confirm dialog (saved search delete), Undo toast (evidence, presets), none (workflow Clear) | **Consolidate** on Undo toasts |
| G12 | **Export actions** | “Export…”, “Export page…”, “Export view…”, “Export up to 5,000…”, “Copy page” | Keep (they differ in scope); unify labels/positions *(judgement)* |
| G13 | **KPI cards** | `Stat` on Home (3) and Evidence (4) | Keep |
| G14 | **Buttons** | `Button`, `IconButton`, raw `<button className="btn …">` in 9 places | Prefer `Button`; raw ones are fine where styling differs |

## 3. Task flows (measured, 1440×900, fixtures)

“Total” = clicks + text entries + select changes + key presses. Screen changes = how often the page
title changed. Memory = things the user must carry from one screen to another.

| Task | Current path | Total | Screen changes | Memory / context loss |
|---|---|---|---|---|
| T1 Search a word, read matches | Find examples → type value → Search | 3 | 1 | — |
| T2 Count those matches by POS | Analyse these matches → Grouped by: POS → Count | 3 | 1 | Concordance disappears; to read lines behind a count you go back |
| T3 Spread across texts | Analyse these matches → Spread tab → Count | 3 | 2 | same |
| T4 Compare in 3 corpora | Analyse these matches → Compare tab → +LOB → +FLOB → Compare | 5 | 2 | same |
| T5 Find the tag for “plural noun” and search it | Find by: POS → Corpora → Tag reference → filter “plural noun” → Find examples → type the code → Search | 7 | 3 | **Code must be remembered across screens** *(the in-form suggestions added on 2026-11-11 already offer a shortcut: type “plural noun” in the value box — 3 actions, but nothing tells the user it exists)* |
| T6 Rerun a saved search | Home: click saved → Search | 2 | 1 | — |
| T7 Add page to evidence, judge 3 | Add page to evidence → Evidence notebook → click first row → 1, 2, 1 | 6 | 1 | Concordance context lost while judging |
| T8 Use a metadata value as a filter | Corpora → (tab back to Contents, because the section remembers Tag reference) → select corpus → attribute → Load values → filter icon | 6 | 3 | — |
| T9 Guided question → run | Find examples → Guided tab → question → Use in Search → Search | 5 | 3 | — |
| T10 Switch working corpus (wide) | Click it in the sidebar | 1 | 0 | Narrow/collapsed: top-bar switcher, 2 |
| T11 EFCAM match → sentence structure | EFCAM in sidebar → Find examples (Home stays put) → type → Search → select line → Inspect syntax | 6 | 2 | Concordance lost |
| T12 See concordance and counts together | — | n/a | — | **Not possible**: every analysis replaces the page |

Fold measurements on the Search page (first visit, guides open by default):

| Window | Value box top | Search button top | KWIC rows visible at scroll 0 after a search |
|---|---|---|---|
| 1440×900 | 1168 px (below fold) | 809 | 0 |
| 1280×800 | 978 (below fold) | 849 | 0 |
| 1024×768 | 1018 (below fold) | 890 | 0 |
| 1440×900, guides closed | 650 | 291 | 9 |
| 1280×800, guides closed | 420 | 291 | 0 |

The primary input of the most frequent task is below the fold on every supported window size for a
new user.

## 4. Friction log

| # | Problem | Evidence (files) | Severity |
|---|---|---|---|
| F1 | Guide panels open by default push the Search form below the fold (table above). The guide repeats Help text. | `PageHeader.jsx` `initiallyOpen`, `guides.js` | High |
| F2 | Analyses are separate pages: concordance, counts, spread and compare are never visible together; every analysis page repeats a “current search” card and its own stale/none notice. | `Analysis.jsx` `useBase`, `BaseNotice`, `QuerySummary`; `App.jsx` `Screen` | High |
| F3 | Triple location indicator: top-bar breadcrumb, 34 px page title, tabs that repeat the sidebar sub-items. ~110 px of chrome before content. | `Topbar.jsx`, `PageHeader.jsx`, `tokens.css --fs-display` | Medium |
| F4 | Compare corpora lives in `Workflows.jsx` and Tag reference in `Analysis.jsx`: code layout contradicts IA; Tag reference is a corpus fact filed under Corpora but implemented as an analysis. | `App.jsx` switch | Low (dev) |
| F5 | Three places for saved/recent (Home, Saved page, palette) with different capabilities: delete only on the Saved page, run-now only on Saved, load-only on Home. | `Overview.jsx`, `Saved.jsx`, `Dialogs.jsx` | Medium |
| F6 | Working corpus shown in sidebar list *and* top-bar switcher (only when collapsed) *and* the form select. Picking a corpus on Home does not open Search, so T11 needs an extra navigation. | `Sidebar.jsx` `usePickCorpus`, `Topbar.jsx` | Medium |
| F7 | Guided search is a separate screen although it only fills the search form. | `Learn.jsx` | Medium |
| F8 | Section memory sends you to the last sub-page (T8 needed an extra tab click). | `Sidebar.jsx` `lastIn` | Low |
| F9 | Analysis parameters (field, position, sample size, attribute, order), page size/context/sort, active corpus on Corpora and the Combine plan are lost on restart; Combine plan only survives via a file. | `Analysis.jsx`, `Search.jsx`, `Corpus.jsx`, `store.jsx` workflow | Medium |
| F10 | Command palette only navigates; it cannot run the search, count, export, save, add to evidence, switch query mode or units. No shortcut overview except reading Help. | `Dialogs.jsx` `CommandPalette`, `Help.jsx` SHORTCUTS | Medium |
| F11 | Alt+1…7 reach only the first sub-page; no keys for analyses, next/previous page, focus results. | `App.jsx` `useShortcuts` | Medium |
| F12 | Evidence: one example at a time; no multi-select, no “mark all shown”, no batch remove. | `Evidence.jsx` | Medium |
| F13 | Unsaved notebook visible only on the Evidence page; nothing global says “unsaved”. | `Evidence.jsx` PageHeader aside | Medium |
| F14 | Destructive actions inconsistent: confirm dialog for saved searches, Undo toast for evidence and presets, nothing for “Clear” in Combine. | `Saved.jsx`, `Workflows.jsx` | Medium |
| F15 | 11 copies of scrollable-table boilerplate; 4 query-summary variants; 3 popover-dismiss implementations. | see G4, G6, G7 | Low (consistency) |
| F16 | At 1440 the Search query card is a narrow column, so Corpus, Find by and Value stack: value box at 650 px even with guides closed. | `layout.css` `.search-layout`, `components.css .form-grid` | High |
| F17 | Results of an analysis are kept per search, but switching to another analysis loses sight of the previous one (only one page visible). | `store.jsx analysis` | Medium |
| F18 | Sidebar corpus list costs ~45 % of the sidebar height for something used occasionally; the top-bar switcher is better and already exists. | `Sidebar.jsx` | Low |
| F19 | Syntax page empty unless you come from a selected match or know a token position. | `Syntax.jsx` | Low |
| F20 | Evidence review card sits below a 460 px table: selecting a row near the bottom puts the review card off screen. | `Evidence.jsx` | Medium |
| F21 | Missing states: Nearby/Spread/Compare show nothing between Count and the reply except the top-bar spinner; Combine “Clear” has no undo; Corpora metadata error only as toast. | various | Low |

Keyboard and accessibility state (from earlier audits, re-checked): every control is a native
button/input, focus is visible, axe 0 violations on audited states. Gaps are reach (F10, F11), not
operability.

## 5. Capability ledger (regression contract)

Every item must be reachable after the overhaul. IDs are referenced in the report.

**Connection & app**
- C1 Connect (host, user, port, password), keyboard-interactive/key login handled by backend
- C2 Remember password in OS keychain; forget saved password
- C3 Host-key verification dialog (trust / refuse)
- C4 Disconnect
- C5 A run refused for lack of connection resumes after sign-in
- C6 Busy indicator with elapsed time and Stop (cancel request)
- C7 Last-run timing (cached / SSH)
- C8 Console: list of requests, detail (commands, reply), copy, filter, terminal commands, export log, clear; error badge
- C9 Theme: system / light / dark
- C10 Check for updates; update notice with notes; install and restart; Later
- C11 Corpus registry discovery on connect; Check again; offline/unsupported/discovered states
- C12 Sidebar collapse to rail; narrow drawer
- C13 Toasts with Undo actions
- C14 Page guides (purpose, steps, notes) and Reset guides
- C15 Tokens / words switch on every rate and size; word counts cached

**Search**
- S1 Corpus choice (grouped by variety, flags, sizes, offline/unsupported disabled)
- S2 Find by any positional attribute; All forms (lexeme)
- S3 Value with `*` wildcards, `|` and `/` alternatives; tag suggestions by code or meaning
- S4 All-forms helper (lemma index or generated forms with review)
- S5 Multi-word sequence: up to 9 words, gap 0–10, optional words, remove word
- S6 Ignore case, Within one sentence, Regex (Advanced)
- S7 Write CQP mode with checks and suggestions; examples
- S8 Document filters: is / is not / years; value picker from corpus with sizes; up to 6
- S9 Filter presets per corpus: save/replace/apply (undo)/delete (undo)
- S10 Filter-only search (every word of filtered documents)
- S11 Query panel: generated CQP, cqp> prompt / shell script, copy, save to file
- S12 Run search (button, Ctrl+Enter); stale-result notice; run again
- S13 Concordance: sort (server), page size 25/50/100, context ±2/4/6/10, previous/next, Go to match N
- S14 Focus results mode
- S15 Select a line → Selected match card: copy, cite, inspect syntax (EFCAM)
- S16 Interpretation text under the count
- S17 Export page (CSV + provenance), export up to 5,000 (confirm), copy page (TSV)
- S18 Add page to evidence
- S19 Save search definition (name, replace warning), Ctrl+S
- S20 Query form kept across restarts
- S21 Guided search: 9 question types, per-corpus translation, preview, Use in Search, Open in Combine

**Saved & recent**
- R1 Saved searches list: load (edit), run, delete
- R2 Recent searches (20): load, run
- R3 Palette access to saved and recent

**Analyse**
- A1 Count by annotation: position (matched word, word N, whole phrase, before, after), grouped by any groupable attribute; explain a code by selecting a row; export
- A2 Count in extra corpora (up to 5) each with own filters; side-by-side shares
- A3 Nearby words: sample size 1–500, chart (top 5 + mirrored 6–10), table L4–R4, export
- A4 Spread across texts: attribute (≤10,000 regions), min size, order by rate/matches/A–Z, Brown genre roll-up, filtered-size notice, export
- A5 Compare corpora: 2–6 corpora (first = reference), per-corpus filters, use current search, own query builder, rates, × ref, LL with stars, filtered-part notices, export, terminal commands
- A6 Sentence structure (EFCAM): token position input, arcs with hover, token table, diagnostics, export

**Combine searches**
- W1 Corpus for the plan; steps search / keep-remove / combine; edit, reorder, remove (reference checks); up to 12
- W2 Example plan; start from current search; from Guided
- W3 Run as matches (paging), counts (field + token), random sample (size, seed)
- W4 Per-step counts; explain result; preview CQP + terminal commands
- W5 Open / save plan file; export view; export up to 5,000; add sample to evidence

**Corpora**
- K1 Corpus table: sort by name, variety, size, annotation, metadata, status; select
- K2 Corpus card: description, variety, size, encoding, family, caveats, notices; Search this corpus
- K3 Token attributes with explanations
- K4 Metadata attribute values with regions/tokens/share; use value as filter
- K5 Tag reference: codes used (server, with frequency), offline codebook with filter, explain code

**Evidence**
- E1 Add from search page or workflow sample (deduplicated)
- E2 KPIs (examples, relevant + distinct sources, unsure, irrelevant)
- E3 Filter by decision; table
- E4 Review: decision (buttons, keys 1/2/3/0, auto-advance), note
- E5 Remove with undo
- E6 Open / save JSON; export CSV; unsaved draft kept across restarts

**Help**
- H1 Methods text (numbers, rates, LL, caveats), shortcut list, links, reset guides

**Keyboard**
- Kb1 Ctrl+K, Ctrl+Enter, Ctrl+L, Ctrl+S, Ctrl+E, Alt+1…7, F1, Ctrl+\`, Esc, evidence 1/2/3/0, arrow keys in menus/suggestions
