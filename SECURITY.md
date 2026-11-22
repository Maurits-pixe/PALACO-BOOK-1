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

The repository does not yet contain a reviewed npm lockfile. A successful
`npm install` is **not** evidence of a reproducible dependency graph.
Before changing CI to `npm ci`, generate and review a complete lockfile,
verify its registry/integrity metadata and run a fresh CI verification.

## Lockfile structural verification (prepared, not yet mandatory)

`scripts/verify-lockfile.mjs` validates an npm v3 lockfile against the
`package.json` root declarations. For nested packages it rejects missing
package integrity fields, links, and sources other than HTTPS
`registry.npmjs.org`. The command runs offline and does **not** establish
that the registry or packages are trustworthy.

CI first identifies whether `package-lock.json` is **tracked by Git**.
When a committed lockfile exists, CI verifies it before dependency installation
and uses `npm ci`. Otherwise CI performs `npm install`, verifies the generated
lockfile's structure, and uploads the generated candidate as a seven-day
GitHub Actions artifact named `npm-lockfile-candidate`. CI does **not** commit
this artifact or approve it. Human review is mandatory before adding it to Git.

To promote a candidate: download it from the appropriate GitHub Actions run;
review source URLs, integrity hashes and version changes; commit the complete
candidate in a separate reviewed change; and verify the `npm ci` path. The
candidate is generated in CI, so it can depend on the registry's state at
generation time; a green candidate run is not a reproducibility guarantee.

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

## Candidate npm ci exercise

While there is no committed, reviewed lockfile, CI now generates a temporary
candidate, records its SHA-256 **before** invoking `npm ci`, verifies the
candidate with a second offline lockfile validation, and checks that the
candidate's hash is unchanged by the installation. Tests, build, and npm audit
run against this `npm ci`-installed dependency tree.

This tests that the generated candidate supports `npm ci` in the CI
environment; it is **not** equivalent to a committed, human-reviewed
lockfile. The committed-lockfile gate, independent review, GO-13 HOLD and
release DENY remain unchanged.
