# Architecture

Hapax is a [Tauri 2](https://tauri.app/) application: a React interface in the system web view,
and a Rust core that owns everything with side effects — SSH, the query compiler, parsing,
local files, the keychain and updates.

## Request lifecycle

1. The interface builds a **structured request** (for example a `QuerySpec`: corpus, field,
   value, following words, filters) and calls a Tauri command such as `run_search`.
2. `query.rs` validates it against the live corpus inventory (`corpora.rs`) and allow-lists, then
   compiles the CQP expression. Literal values are regex-escaped except `*` (any characters);
   `|` or `/` separates alternatives. Values may not contain `" \ ;` or control characters.
   With `manual: true` the typed `cqp` text is checked by `cqp.rs` instead (lexed like CQP,
   allow-listed names and operators, no `;`/`#`/`$`/redirection) and the filters are added as a
   `::` constraint. An empty value with filters becomes `[_.attr="v" & …]`, which tests each
   word against the filters so CQP never holds a match for every word of the corpus.
3. `engine.rs` runs one request at a time. It opens an SSH channel and executes
   `python3 -c <worker.py>` with the request JSON on standard input.
4. `remote/worker.py` sets `LD_LIBRARY_PATH` for CWB, runs `cqp -c -p -r <registry>` (or a CWB
   decoder) and prints one JSON object.
5. `parse.rs` decodes the reply into typed results. Search and workflow pages are cached (16
   entries, cleared on connect, disconnect and corpus discovery).
6. Every request and reply is logged in the in-memory console (`console.rs`, 300 entries).

## Modules

| Module | Responsibility |
|---|---|
| `query.rs` | Request types, validation, CQP compilation, worker payloads |
| `cqp.rs` | Checks typed CQP (*Write CQP*) so it stays one query expression |
| `workflow.rs` | Multi-step plans (search, refine, combine), plan files |
| `corpora.rs` | Bundled verified inventory, live inventory, registry discovery |
| `ssh.rs` | russh client, password / keyboard-interactive / key login, host-key checks |
| `engine.rs` | Busy flag, cancellation, result cache, console logging |
| `parse.rs` | Worker reply decoding, dependency-tree validation |
| `terminal.rs` | Copy-for-terminal command rendering (`cqp>` and shell) |
| `export.rs` | CSV/TSV/JSON exports, provenance files, evidence notebooks |
| `storage.rs` | Preferences file, OS keychain, migration from the pre-rename folder |
| `guide.rs` | Tagset codebook, plain-language explanations, guided-search recipes |
| `commands.rs` | The IPC surface (all `#[tauri::command]` functions) |

## Interface structure

| Path | Responsibility |
|---|---|
| `src/nav.js` | The six destinations, Search and Corpora views, old-id aliases |
| `src/commands.js` | Command registry: palette entries, shortcuts, shortcut overview |
| `src/state/store.jsx` | App state: connection, query, results, evidence, Combine plan, units |
| `src/lib/uiState.js` | Remembered view state per viewer (`hapax.ui` in localStorage) |
| `src/screens/` | Home, Search (workspace), Combine, Corpora, Evidence, Help |
| `src/views/` | Search views (Counts, Nearby, Spread in `Analyses.jsx`; `Compare`, `Structure`) and Corpora › Tags |
| `src/components/` | Shared UI: query panel, filters, suggestions, top bar, sidebar, dialogs, units |

See `docs/ux-overhaul/` for the reasoning behind this structure.

## Corpus discovery

On every connect the interface calls `discover_corpora`. The worker lists the registry folder
and reads each registry file (`ID`, `NAME`, charset, `ATTRIBUTE`, `STRUCTURE`); corpora the app
does not know are additionally described with `cwb-describe-corpus -s`. `merge_registry` then:

- keeps the hand-verified description for known corpora, but takes their charset from the server
  (so a fixed registry makes a corpus searchable without an app update);
- adds unknown corpora with registry-derived attributes, marked `source: "discovered"`;
- keeps known corpora that are missing, marked `available: false`, so they are visible but
  refused with an explanation.

If the registry returns nothing, the previous inventory is kept.

## IPC contract

Top-level command arguments are camelCase in JavaScript; fields inside request objects are
snake_case. Remote results have the shape `{ data, elapsed_seconds, cached }`. Errors have the
shape `{ kind, message }`, where `kind` is one of `validation | remote | ssh | host_key | auth |
not_connected | busy | cancelled | io | credential`.

Events: `ssh://host-key-prompt`, `ssh://connection`, `console://entry`.

## Limits

| Limit | Value |
|---|---|
| Search value | 1–120 characters (regex: 80) |
| Words in a sequence | 9, gap 0–10 each, 12 alternatives per word |
| Workflow steps | 12 |
| Export rows | 5,000 |
| Distribution: matches assigned to values | 200,000 |
| Worker reply | 8 MB |
| Metadata attributes decoded | ≤ 10,000 regions |

## Local data

| What | Windows | Linux |
|---|---|---|
| Preferences, saved searches | `%LOCALAPPDATA%\Hapax\` | `~/.local/share/Hapax/` |
| Passwords | Credential Manager, service `Hapax SSH` | Secret Service (KWallet, GNOME Keyring) |
| Known hosts | `~/.ssh/known_hosts` | `~/.ssh/known_hosts` |

On first start Hapax copies preferences from the previous folder name (`CQPExplorer`) and moves a
stored password from the previous keychain service name. The old folder is left in place.

## Platform notes

- On Wayland with the NVIDIA driver, `main.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` (unless
  already set) to avoid a blank window in WebKitGTK.
- SSH agent login is not supported yet; without a password the app tries unencrypted
  `~/.ssh/id_ed25519`, `id_ecdsa` and `id_rsa`.
