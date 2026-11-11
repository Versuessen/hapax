# Security policy

## Reporting a vulnerability

Please report security problems privately through
[GitHub's private vulnerability reporting](https://github.com/Versuessen/hapax/security/advisories/new),
not as a public issue. Include the version, what an attacker could do, and the steps to
reproduce it. You will get an answer within a week.

## Scope

In scope: anything that could make Hapax write to or run unexpected commands on the corpus
server, leak credentials, accept a changed SSH host key, or install an update that was not signed
with the project's release key.

## Design summary

- User input never reaches CQP unchecked: form queries are structured, validated against an
  allow-list and the corpus inventory, and literal values are escaped (`src-tauri/src/query.rs`).
  Typed CQP (*Write CQP*) is lexed and allow-listed so that it stays a single query expression:
  no `;`, commands, comments, variables or redirection (`src-tauri/src/cqp.rs`).
- The remote worker only runs CWB's read-only tools (`src-tauri/remote/worker.py`).
- SSH host keys are checked against `~/.ssh/known_hosts`; changed keys are refused.
- Passwords are stored only in the operating system keychain.
- Updates are verified with a minisign public key compiled into the app before installation.
