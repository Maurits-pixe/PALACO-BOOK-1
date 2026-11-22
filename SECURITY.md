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

- Any `FINDINGS` (**info, low, moderate, high or critical**) causes CI
  failure. This is a zero-reported-findings CI policy, not a guarantee that
  the entire dependency ecosystem has zero undiscovered vulnerabilities.
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
so engineering status remains visible even when any reported vulnerability
correctly fails CI. Every finding is a merge/release blocker requiring
review, remediation and a repeat scan. A successful CI run still does not
supersede independent human review or GO-13 HOLD.


## Evidence-to-source binding

The sanitized `npm-audit-summary.json` now also records the CI checkout
commit identifier (`GITHUB_SHA`) and SHA-256 of the **exact tracked**
`package-lock.json` bytes. Missing or malformed provenance causes the
audit step to fail closed, even if npm reports no findings. These fields
allow later investigators to compare the artifact to its specific source
revision and lockfile, but do not themselves authenticate GitHub, npm,
or the runtime environment.

For `pull_request` events, `GITHUB_SHA` can represent the temporary
GitHub-generated merge commit rather than the PR branch tip. Reviewers must
use the workflow run metadata to distinguish these; never silently
substitute a branch SHA when verifying audit provenance.

## Independent audit evidence verification gate

After npm's scanner succeeds, CI runs
`node scripts/verify-audit-evidence.mjs` **before** uploading the
sanitized artifact. This is a separate verifier that reads the finished
report and `package-lock.json` directly from disk and obtains the actual
checkout SHA via `git rev-parse HEAD`. It requires:

- Known report schema, `release_authorization: DENY`, and `NO_FINDINGS`.
- All severity counters and their total equal to zero.
- No affected packages and complete package-detail metadata.
- Exact match between the report's Git checkout SHA and Git HEAD.
- Exact match between the report's lockfile SHA-256 and current lockfile bytes.

Any missing, inconsistent or altered field fails the independent CI gate.
The artifact-upload step remains `if: always()` so failed scans can still
leave forensic evidence; such artifacts are **not** an approval. Both the
scanner and this verifier are executed within the same CI environment, so
this is consistency verification, not a third-party attestation.

## Deterministic dependency inventory (review-only)

After `npm ci` and locked-source verification, CI generates a
`npm-dependency-inventory.json` artifact, retained for seven days.
The inventory is computed entirely from the committed npm lockfile,
not from mutable registry queries. Its source SHA-256 and checkout Git
commit permit comparison between builds. It lists package location,
name, pinned version, direct/optional flags, and package names with
multiple resolved versions.

The inventory never grants release authority (`release_authorization:
DENY`). A stable inventory is not a full software bill of materials,
license audit, supplier attestation, or proof that packages are safe.
Potential duplicate versions are visibility signals, not automatic
vulnerability findings.

## Cross-artifact inventory and audit consistency

CI now runs `scripts/verify-dependency-inventory.mjs` after the independent
npm audit verification and **before** publishing the inventory artifact.
It reconstructs the inventory from the committed lockfile and actual Git
checkout and requires an exact match with the generated inventory. It also
checks audit evidence against the same checkout SHA and lockfile SHA-256.
Any altered package, reordered or missing entry, discrepant summary count,
or mismatched audit source fails closed.

This verifies two reports refer to the same local build inputs. It does not
prove that upstream packages are benign, that all vulnerabilities have been
discovered, or that the software may be released.

## Registry tarball identity binding

The offline lockfile validator now requires each npm tarball URL to name
**exactly the same package and pinned version** as its lockfile installation
entry. For example, `node_modules/@scope/example` version `1.2.3` must
resolve to
`https://registry.npmjs.org/@scope/example/-/example-1.2.3.tgz`.
This includes matching the raw URL byte-for-byte against its canonical form,
rejecting query strings, fragments, percent-encoded aliases and path
normalization tricks. The check applies to nested dependencies too.

Only approved registry origins are allowed; checksums still protect package
content against accidental changes. This is URL identity consistency,
**not** independent registry trust or a guarantee of artifact safety.

## GitHub Actions supply-chain hardening

The CI workflow pins external actions to **full 40-character Git commit
identifiers**, rather than mutable major-version tags, and checks out source
with `persist-credentials: false`. The global token permissions remain
limited to `contents: read`.

The pre-install `scripts/check-ci-action-pins.mjs` gate rejects mutable or
dynamic external Action references and fails if checkout token persistence
or read-only permissions are no longer explicitly configured. Regression
tests exercise the policy with valid and malicious workflow snippets.

The pinned actions currently originate from reviewed release identifiers:
`actions/checkout` v4.2.2, `actions/setup-node` v4.4.0 and
`actions/upload-artifact` v4.6.2. Pinning prevents reference movement;
it does **not** guarantee those action implementations or their upstream
dependencies are free of vulnerabilities. Future updates require review
of the exact action commit, a deliberate pinned SHA change and new CI evidence.
