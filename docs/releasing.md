# Releasing

Releases are fully automated by [`.github/workflows/release.yml`](../.github/workflows/release.yml).

## What happens on a push to `main`

1. **test** — `npm run build` and `cargo test`. A failure stops the release.
2. **version** — `<major>.<minor>` from `src-tauri/tauri.conf.json` plus the workflow run
   number, e.g. `1.0.57`. Every release is therefore newer than the one before.
3. **build** — Linux (`.deb`, `.rpm`, `.AppImage`) on Ubuntu 22.04 and Windows (`-setup.exe`).
   The Tauri bundler signs each package with the updater key and writes a `.sig` next to it.
4. **release** — release notes are the commit subjects since the previous release;
   `scripts/make-latest-json.mjs` writes `latest.json`; everything is published as release
   `v<version>` and marked latest.

Pushes that change only Markdown or `docs/` do not trigger a release.

## How installed copies update

At start-up the app requests
`https://github.com/Versuessen/hapax/releases/latest/download/latest.json`. The updater looks up
the entry for the way Hapax was installed (`linux-x86_64-rpm`, `linux-x86_64-deb`,
`linux-x86_64-appimage`, `windows-x86_64-nsis`), falls back to `linux-x86_64` /
`windows-x86_64`, downloads the package, verifies its signature against the public key in
`tauri.conf.json`, and installs it.

The repository must be **public** for this URL to work without credentials.

## One-time setup

Add two repository secrets under *Settings → Secrets and variables → Actions*:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the full contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

Under *Settings → Actions → General → Workflow permissions*, choose *Read and write
permissions* so the workflow can create releases.

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
