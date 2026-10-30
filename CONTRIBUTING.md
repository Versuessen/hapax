# Contributing to Hapax

Thank you for helping. This file covers how to report problems and how to propose changes.

## Reporting a problem

Open an [issue](https://github.com/Versuessen/hapax/issues) and include:

- the Hapax version (*Methods & help → About*) and your operating system;
- the corpus and what you searched for;
- for a failed request, the console entry: press <kbd>Ctrl</kbd>+<kbd>`</kbd>, select the request,
  and copy *Request → stdin* and *Response ← stdout* or *Error*. These contain the command and
  the server's reply. They never contain your password, but they do contain your username and
  the server's host name — remove them if you prefer.

Security problems: see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Proposing a change

1. Open an issue first for anything larger than a fix, so we can agree on the approach.
2. Fork, create a branch from `main`, and keep the change focused.
3. Run the checks before opening a pull request:
   ```sh
   cargo test --manifest-path src-tauri/Cargo.toml
   npm run build
   ```
4. Describe what changed and how you verified it. Include a screenshot for interface changes,
   in both the dark and the light theme.

Every merge to `main` is released to all users automatically, so `main` must always be
releasable.

## Ground rules for the code

- **The server stays read-only.** The worker may only run CWB's read tools. No change may
  write to the server or run anything other than the tools listed in `remote/worker.py`.
- **No raw CQP from the interface.** New query features extend the structured request and its
  validation in `src-tauri/src/query.rs`; they never pass user text into CQP unchecked.
- **Never log secrets.** Passwords go to the OS keychain and nowhere else.
- **Interface text** follows the writing rules at the top of `src/guides.js`: say what a control
  does, using its exact label, without filler.
- **Imagery has a purpose.** Icons and graphics must carry information (state, category,
  data). Decoration is not added. See [docs/design-principles.md](docs/design-principles.md).
