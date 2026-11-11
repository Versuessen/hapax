/**
 * In-app guide for every screen, shown in the collapsible panel under the title.
 *
 * Writing rules (keep them when editing):
 *  - `purpose`: one sentence saying what the screen is for, in the reader's terms.
 *  - `steps`: what to do, in order, using the exact labels of the controls.
 *  - `notes`: only facts that change how a result should be read or used.
 *  - No marketing, no filler, no "simply"/"just". Name the control, then the effect.
 */
export const GUIDES = {
  home: {
    title: "Home",
    purpose: "Pick up where you left off: your connection, the corpus you are working in, and your current or last search with its next steps.",
    steps: [
      "If Corpus server says Not connected, select it and sign in with your university account.",
      "Under Current search, go back to the results or straight to an analysis. Without one, Continue where you left off reruns your last search.",
      "Select any recent or saved search to load it into Search.",
    ],
    notes: [
      "Hapax only reads from the corpus server. Nothing you do here changes the corpora.",
      "Recent searches are kept on this computer (the last 20). This session's activity is cleared when you close the app.",
    ],
  },

  "search/matches": {
    title: "Search",
    purpose: "Find every occurrence of a word, tag or phrase in one corpus and read each one in context.",
    steps: [
      "Choose what to match in Find by: the written word, all forms of a word (lexeme), or an annotation such as a part-of-speech tag. To type a CQP query yourself, select Write CQP above the form.",
      "Type the value. For a tag field, type the tag or what it means (verb, plural noun) and pick from the list. * stands for any ending (walk*, VV*); I|me or I/me matches either. For a phrase, select Add word for each following word. All forms finds every inflection of the word (bigger, biggest).",
      "To search only part of the corpus, select Add filter under Only in documents where — for example spoken texts, a speaker group or a range of years. Every filter must hold. Presets saves a set of filters under a name for reuse here, in Count by annotation and in Compare; presets are kept in preferences.json with your saved searches. With filters and no value, Search lists every word of those documents.",
      "Select Search (Ctrl+Enter). The count covers the whole (filtered) corpus; the list shows one page at a time. In a long list, type a number in Go to # to jump to that match.",
    ],
    notes: [
      "The form is kept as you left it, run or not, and comes back when you reopen Hapax.",
      "Values match exactly apart from * (any ending) and | or / (alternatives). Use Ignore case for capitalisation and Regex (under Advanced) for other patterns; to find a slash or asterisk itself, use Regex.",
      "Write CQP accepts one query, checked before it runs: attributes of the corpus, quoted values (regular expressions), and query keywords such as within and ::. Commands and ; are refused. Filters under Only in documents where are added to it.",
      "In a filter, several values (picked from the list, or typed with |) mean any of them. A year range matches values that start with a year in that range, so “1985-1993” counts as 1985.",
      "Query, under the form, shows the generated CQP — exactly what runs on the server. Open it to switch to cqp> prompt or Shell script and copy the commands into your own SSH session.",
      "Per-million rates on this page divide by the whole corpus — also when filters are set. Use Spread across texts or Compare corpora for rates of a filtered part.",
      "Select a “per million” label or a corpus size to switch the whole app between tokens (punctuation included) and words (tokens with a letter or digit). Word counts are measured once per corpus; for parts of a corpus they are estimated and marked ≈.",
    ],
  },



  "search/counts": {
    title: "Count by annotation",
    purpose: "Break all matches of the current search down by an annotation — which word forms, parts of speech or whole phrases occur — in one corpus or several side by side.",
    steps: [
      "Run a search first; this page analyses its results, including its filters.",
      "In Count, choose what to count: for a phrase, any of its words (Word 3 · I|me) or the whole matched phrase; for any search, also the word just before or after.",
      "In Grouped by, choose the annotation, for example Written word or Part of speech.",
      "To compare, select corpora under Also count in and give each its own filters (for example only spoken data). Then select Count.",
    ],
    notes: [
      "Counts cover every match on the server, not only the page you viewed. Whole-phrase counts use the first 200,000 matches.",
      "Shares are within each corpus, so corpora of different sizes can be compared directly.",
      "An optional word that is missing from a match is counted under (none).",
      "Annotation comes from automatic taggers and contains errors. Read examples before reporting a category.",
    ],
  },

  "search/nearby": {
    title: "Nearby words",
    purpose: "See which words occur up to four positions to the left and right of your matches.",
    steps: [
      "Run a search first.",
      "Set Matches to sample (1–500). They are taken in corpus order.",
      "Select Count.",
    ],
    notes: [
      "These are raw positional counts from the university's collocates script, not association measures such as MI or log-likelihood.",
      "A sample of the first matches can be dominated by a few texts. When the total is small, sample all of it.",
    ],
  },

  "search/spread": {
    title: "Spread across texts",
    purpose: "Find out whether matches are spread evenly or concentrated in particular genres, periods, speakers or files.",
    steps: [
      "Run a search first.",
      "In Across, choose the metadata attribute to break the results down by.",
      "Select Count. Order by Per million to compare groups of different sizes.",
    ],
    notes: [
      "Each rate is computed from that group's own size, so a small genre is not hidden by a large one.",
      "When the search has filters, group sizes count only the filtered documents, provided the attribute is on the same level as the filters (for example all text attributes). Otherwise a notice says the rates are too low.",
      "Groups below the size threshold are dimmed: a few matches more or less changes their rate a lot.",
      "In Brown, LOB, FLOB and Frown, file ids are grouped into the standard A–R genre categories.",
    ],
  },

  "search/compare": {
    title: "Compare corpora",
    purpose: "Run the same search in two to six corpora — or in filtered parts of them — and compare how often it occurs.",
    steps: [
      "Select the corpora. The first one you select is the reference.",
      "To compare parts, select Filter next to a corpus and add its filters, for example only spoken texts from 1990–1994. Each corpus has its own, because metadata differs between corpora.",
      "Build the search, or select Use current search (its filters go to its own corpus).",
      "Select Compare.",
    ],
    notes: [
      "For a filtered corpus, Tokens searched is the size of the filtered part and the rate divides by it. If that size cannot be measured (filters on differently divided attributes), a notice says so.",
      "LL is log-likelihood (G²) against the reference. 3.84, 6.63 and 10.83 correspond to p < .05, .01 and .001.",
      "LL assumes every token is independent, which overstates certainty for features concentrated in a few texts.",
    ],
  },

  "search/structure": {
    title: "Sentence structure",
    purpose: "View the dependency relations of one EFCAM sentence as arcs and as a table.",
    steps: [
      "In Search, run a query on EFCAM, select a match, then select Inspect syntax. Or type a token position here and select Inspect.",
      "Point at a word to highlight its head and dependents.",
    ],
    notes: [
      "Only EFCAM has dependency annotation.",
      "The checks above the tree report the number of roots, cycles and undefined heads. Problems there are in the corpus annotation, not in the display.",
    ],
  },

  combine: {
    title: "Combine searches",
    purpose: "Answer questions that need more than one search: narrow results down, or join two sets of results.",
    steps: [
      "Add a Search step.",
      "Add Refine steps to keep or remove matches by a property of their first or last word, and Combine steps to join two results (union, intersection or difference).",
      "Choose what to show — matches, counts, or a random sample — and select Run.",
    ],
    notes: [
      "Each step's size is checked on the server before the next one runs. Empty steps are handled safely and shown as zero.",
      "Combine compares exact matched token spans, not sentences or documents.",
      "Save the plan to a file to rerun or share it.",
    ],
  },

  "corpora/about": {
    title: "Contents & metadata",
    purpose: "Check what a corpus contains before you search it: its size, its annotation and the values of its metadata.",
    steps: [
      "Select a corpus in the table. Select a column heading to sort, for example by Tokens or Status.",
      "Choose a metadata attribute and select Load values to see each value and how much of the corpus it covers.",
      "Select the filter icon next to a value to use it as a document filter in Search.",
    ],
    notes: [
      "The corpus list is read from the server when you connect. A corpus marked unavailable is not currently installed there.",
      "The flag shows each corpus's language variety; point at it for the period and source. A corpus found on the server gets a variety only when its registry name or language states one — otherwise it shows ?.",
      "Token counts include punctuation.",
    ],
  },

  "corpora/tags": {
    title: "Tag reference",
    purpose: "Look up what an annotation code means in a corpus, and see which codes it uses and how often.",
    steps: [
      "Choose the corpus and the attribute, then select Load to list every code with its frequency.",
      "Type in the filter box to find a code or a description, for example VVG or adjective.",
    ],
    notes: [
      "Tagsets differ: BNC uses C5, BNC2014 CLAWS7, the Brown family Brown tags, CLMET and EFCAM Penn-style tags.",
      "Glosses marked unverified are derived from the code's structure. Check the linked documentation before citing them.",
    ],
  },

  evidence: {
    title: "Evidence notebook",
    purpose: "Collect concordance lines, judge each one, and keep a record of the examples behind a claim.",
    steps: [
      "In Search, select Add page to evidence.",
      "Select a line and mark it Relevant (1), Irrelevant (2) or Unsure (3). Add a note saying why.",
      "Select Save… to keep the notebook as a file, or Export… for a CSV of the judged lines.",
    ],
    notes: [
      "Until you save it, the notebook is kept as a draft on this computer and restored when you reopen Hapax. Save… writes a JSON file you can share or archive.",
      "Every line keeps its corpus, token position and the query that found it.",
    ],
  },

  help: {
    title: "Methods & help",
    purpose: "How the figures are calculated, what the terms mean, and the keyboard shortcuts.",
    steps: [
      "Read What the numbers mean before citing a count or rate.",
      "Press F1 from anywhere to return here.",
    ],
    notes: [],
  },
};
GUIDES["corpora/metadata"] = GUIDES["corpora/about"];
