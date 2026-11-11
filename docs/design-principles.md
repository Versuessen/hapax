# Design principles

Rules the interface follows. Use them when adding a screen or a component.

## Structure

- **Navigation is ordered by task**, the way research proceeds: *Home → Search → Combine
  searches → Corpora → Evidence notebook → Methods & help* — six flat destinations. Anything
  that works on the current search is a **view of the Search workspace** (a tab beside Matches),
  not a separate page, so the query and the result stay in view. A corpus fact goes into
  Corpora (About · Metadata · Tags).
- **One title**: the top bar names the page; pages add short context with `PageHeader`
  (portalled into the top bar). Guides open from the top bar's Guide button (`src/guides.js`).
- **Every command lives in `src/commands.js`**: if it has a shortcut, the palette, the shortcut
  overview and Help list it automatically.
- **View settings are remembered** with `useUiState` (`src/lib/uiState.js`), never in the
  backend preferences.
- Labels name the task (“Spread across texts”), not the implementation (“Distribution”).

## Writing

- One sentence of purpose, numbered steps using the exact control labels, and *Good to know*
  limited to facts that change how a result is read.
- No filler (“simply”, “just”, “easily”), no marketing, no exclamation marks.
- Numbers carry their unit and their basis: “per million tokens, punctuation included”.
- Error messages say what happened, why, and what to do next.

## Visual

- **Imagery must carry information.** Icons mark state (connected, offline, error) or category
  (the corpus colour encodes its tagset family). Charts show data. Nothing is added for
  decoration — no illustrations, background art or ornamental graphics inside cards.
- Colours come from the tokens in `src/styles/tokens.css`. Both themes are first-class; every
  change is checked in dark and light.
- Text meets WCAG AA contrast (4.5 : 1) in both themes. Focus is always visible.
- Layouts work from 420 px wide. Below 1100 px the sidebar is an icon rail and the working corpus
  moves to a switcher in the top bar; on phones the rail becomes a bottom bar. Search uses two
  columns (query beside results) from 1040 px of content width.

## Behaviour

- Anything that touches the server is explicit (a button), shows progress, and can be stopped.
- Results that no longer match the current query are marked stale and cannot be exported.
- What the app runs is always inspectable: the generated CQP, the terminal commands and the
  console.
