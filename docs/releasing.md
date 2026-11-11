# Releasing

Releases are fully automated by [`.github/workflows/release.yml`](../.github/workflows/release.yml).

## What happens on a push to `main`

1. **test** — `npm run build` and `cargo test`. A failure stops the release.
2. **version** — `<major>.<minor>` from `src-tauri/tauri.conf.json` plus the workflow run
   number, e.g. `1.0.57`. Every release is therefore newer than the one before.
3. **build** — Linux (`.deb`, `.rpm`, `.AppImage`) on Ubuntu 22.04 and Windows (`-setup.exe`).
   The Tauri bundler signs each package with the updater key and writes a `.sig` next to it.
4. **release** — release notes come from [`release-notes.md`](../release-notes.md) when the
   release changed that file, otherwise from the commit subjects since the previous release;
   `scripts/make-latest-json.mjs` writes `latest.json`; everything is published as release
   `v<version>` and marked latest.

Pushes that change only Markdown or `docs/` do not trigger a release.

## Writing release notes

The update notice in the app shows the release notes under **What changed**. They are read by
people who use Hapax for corpus work, not by developers, so commit subjects are a poor fit.
Before pushing a change people will notice, rewrite `release-notes.md` for that release.

**Format: plain text, one line per change.**

```
- Search · Write CQP yourself: Search has a new switch above the form …
- Sidebar · Only the open section stays unfolded: Opening a page in another section …
```

- `Area · Name: explanation`. The area is the part of the app (Search, Analyse results,
  Corpora, Sidebar…), the name says what changed in a few words, the explanation gives one or
  two sentences: what you can now do or what behaves differently, and where, using the labels
  on screen. A fix says what used to go wrong.
- No Markdown: no `##` headings, `**bold**` or backticks. The notes are shown by the version
  being *replaced*, and versions up to 1.0.16 print every line exactly as written. Hapax 1.0.17
  and later turn the area into a heading and the name into bold text, so the same lines look
  right in both. Write quotation marks instead of backticks: “VV*”.
- Say what it means for the user's work, not how it was built. Leave out file names, internal
  terms and refactoring.
- Keep it short: the notice is a small panel. Five to eight lines is plenty.

## How installed copies update

At start-up the app requests
`https://github.com/Versuessen/hapax/releases/latest/download/latest.json`. The updater looks up
the entry for the way Hapax was installed (`linux-x86_64-rpm`, `linux-x86_64-deb`,
`linux-x86_64-appimage`, `windows-x86_64-nsis`), falls back to `linux-x86_64` /
`windows-x86_64`, downloads the package, verifies its signature against the public key in
`tauri.conf.json`, and installs it.

The repository must be **public** for this URL to work without credentials.

## One-time setup

**1. Signing key.** Add two repository secrets under *Settings → Secrets and variables →
Actions*:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the full contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

**2. Release token.** The workflow's built-in token is not allowed to create a release tag on a
commit whose history adds or changes files in `.github/workflows/`, so publishing needs a
personal token:

1. On GitHub, open your avatar → *Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token*.
2. *Repository access:* *Only select repositories* → `hapax`.
3. *Permissions → Repository permissions:* **Contents: Read and write** and
   **Workflows: Read and write**. (*Metadata: Read* is added automatically.)
4. Choose an expiration, generate, and copy the token.
5. Add it to the repository as the secret `RELEASE_TOKEN`.

When the token expires, publishing fails with *RELEASE_TOKEN is not set* or a 401/403 in the
*Publish* step. Generate a new one and replace the secret; nothing else changes.

After adding a secret, open the failed run under *Actions* and choose *Re-run failed jobs*.

Keep a copy of the private key and password in a password manager. **If they are lost, installed
copies can no longer be updated automatically**: a new key means a new public key in the app,
and users must install that version by hand once.

## Changing the version line

To start `1.1.x` or `2.0.x`, change `version` in `src-tauri/tauri.conf.json` (the patch number
there is ignored by CI). Local builds use the version as written.

## Building a release locally

```sh
export TAURI_SIGNING_PRIVATE_KEY="$(cat path/to/hapax-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="…"
npx tauri build --bundles rpm        # or deb, appimage, nsis
```
