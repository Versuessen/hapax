## Search
- **Write CQP yourself.** Search has a new switch above the form: **Build** is the form you know, **Write CQP** lets you type a CQP query directly, for example `[pos="VV.*"] [pos="AT0"]`. Switching over fills in the search you had built, so you can refine it by hand. Your filters still apply, and only queries are accepted: anything that would run a server command is refused with an explanation.
- **Suggestions while you type.** In a Value box set to Part of speech (or another tag field), type a tag or what it means, such as “verb” or “plural noun”, and pick from the list. It also offers whole groups like `VV*`. After `|` or `/` the list opens again for the next option. When writing CQP, it suggests attribute names, tags and keywords.
- **`*` for any ending.** `walk*` finds walk, walks, walked…; `VV*` (or `VV.*`) finds every tag starting with VV. This also works in filter values, e.g. `W:ac*` for every academic genre.
- **`/` works like `|`.** `I/me` now finds either word, just like `I|me`.
- **Search with filters only.** Leave the value empty, add a filter (for example author sex is female) and press Search to list every word of those documents. In Write CQP, `[]` does the same.

## Rates and sizes
- **Per million tokens or words.** Click any “per million tokens” label or a corpus size such as “112M tokens” to switch the whole app to words (punctuation left out) and back. Each corpus's word count is measured once on the server and remembered. For parts of a corpus the word count is estimated and marked ≈.

## Sidebar
- **Only the open section stays unfolded.** Opening a page in another section now folds the section you came from.

## Updates
- **Clearer “What changed”.** Update notes like these now describe each change in plain words instead of listing technical commit messages.
