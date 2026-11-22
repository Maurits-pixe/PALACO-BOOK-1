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

## Dependency source gate

The pre-install `check-dependency-sources.mjs` gate accepts only explicit
three-component semver versions and supported comparator/range expressions in
direct `package.json` declarations. It rejects URL/Git/local/alias sources,
mutable dist-tags (such as `latest`), and wildcard ranges. It checks production,
development, optional and peer dependency sections. A future dependency that
requires a different syntax needs explicit policy review before use. This is a narrow
manifest policy: it does not scan transitive dependencies or guarantee a
malware-free supply chain.

The repository now contains a pinned npm v3 `package-lock.json`, derived
from the verified CI #460 candidate. A successful CI #470 confirmed the
**committed** lockfile path: offline metadata validation, `npm ci`,
TypeScript checks, regression tests, build and npm audit.

## Required dependency lockfile gate

`scripts/verify-lockfile.mjs` checks that root dependency declarations match,
the expected direct dependencies exist, each nested package is pinned with
approved integrity metadata and HTTPS `registry.npmjs.org` origins, and
every version override is satisfied (including nested instances).

CI **requires `package-lock.json` to be tracked by Git**. It validates
the lockfile before installing, records SHA-256, installs via `npm ci`, then
validates the metadata and checksum again. There is **no automatic fallback
to `npm install`** and no generation of unreviewed lockfiles in CI.

Any dependency update must change both the manifest and the lockfile in
a reviewed feature-branch commit. Regenerate, inspect all new package
origins, checksums and advisories, and obtain fresh CI evidence before
considering the PR for human review. These checks establish technical
consistency, not independent supplier trust or production authorization.

## npm advisory scan — evidence only

CI executes `npm audit --json --audit-level=low` against the installed
dependency graph. `scripts/summarize-npm-audit.mjs` creates
`npm-audit-summary.json` containing severity counts, a constrained list of affected npm package names (when the scanner supplies valid details), a status
(`NO_FINDINGS`, `FINDINGS`, or `ERROR`) and `release_authorization: DENY`.
The summary is retained as a GitHub Actions artifact for seven days.

- `FINDINGS` with **high or critical** advisories now causes CI failure.
  Lower-severity findings are reported for review but never authorize release.
- `ERROR` causes CI failure: an incomplete or failed scan must never be
  presented as a clean result.
- `NO_FINDINGS` means no findings reported by npm at scan time; it is not
  a guarantee of dependency safety or an authorization to deploy.
- Raw advisory output is deliberately not published as an artifact.
  CI only uploads the sanitized summary; access to GitHub job logs/artifacts
  remains subject to repository policy.

## Vulnerability triage evidence

Audit summaries include `affected_packages` with package identifier, severity,
direct dependency marker and whether npm reports a fix is available. Detailed
advisory text, arbitrary URLs, fix command output and proof-of-concept content
are not copied into the artifact. Missing package details are explicitly
marked `UNAVAILABLE` and cannot be treated as proof that no packages are
affected.

TypeScript checks, unit tests and build run **before** the blocking audit,
so the engineering status remains visible even when known high/critical
vulnerabilities correctly fail CI. Any high/critical vulnerability is still
an unconditional merge/release blocker; manual remediation and repeat
evidence are necessary.

