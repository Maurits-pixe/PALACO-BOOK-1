# PALACO-BOOK-1 security and release policy

## Scope

This repository contains the PALACO Bluebook application (Next.js, TypeScript,
React and SQLite) and architecture documentation. Documents, tests and CI
results are **evidence**, not authorization to issue identities, release
credentials, merge protected branches, or deploy to production.

## Local data and credentials

- Keep credentials in environment variables; never commit `.env` files,
  private keys, tokens, or account/session secrets.
- Keep SQLite databases, journals and WAL files outside source control.
  The `.gitignore` prevents accidental addition of common filenames, but
  **does not remove files that Git already tracks**.
- If a secret or sensitive record was committed, revoke/rotate it promptly,
  assess exposure and use an approved history-cleanup procedure. Simply
  deleting it in a later commit is not sufficient.

## Pull request gates

1. Make changes on a feature branch; retain human review.
2. Run `npm run typecheck`, `npm test` and `npm run build`.
3. Check the complete diff for secrets, personal data, unsafe logging,
   unauthorized network calls and SQLite persistence changes.
4. Do not treat a synthetic/mock provider as a validated live provider.
5. Release, identity issuance, and production deployment remain **HOLD**
   until explicitly authorized and supported by independently verified evidence.

## Reporting

Report suspected security flaws privately to the repository maintainers.
Do not put exploit details, live tokens or personal data in public issues.
