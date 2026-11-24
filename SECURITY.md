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

## Exact GitHub Actions allowlist

The CI policy additionally requires the **specific approved SHA** for each
GitHub Action, not merely any syntactically valid 40-character hash. The
allowed invocations are one `actions/checkout`, one `actions/setup-node`
and two `actions/upload-artifact` steps, each at their documented pinned
commit. Missing, additional, substituted or stale action versions fail the
pre-install policy check.

Changes to the Action set therefore require an explicit policy and test
update, review of the proposed source and SHA, and fresh CI evidence.
This count-based guard covers the currently used CI workflow; it does not
analyze arbitrary shell scripts, invoked workflows or actions in other
workflow files. GO-13 remains HOLD regardless of green checks.

## Restricted CI events and token permissions

The CI policy also requires exactly two unprivileged workflow events:
`push` and `pull_request`. Changes introducing
`pull_request_target`, `workflow_run`, `workflow_dispatch`, or other
events fail the in-workflow policy check pending explicit review.

Global GitHub token permissions must remain `contents: read`, with
**no job-level permissions overrides** and no additional global
scopes such as `id-token: write`. Negative tests exercise event changes,
permission elevation and duplicated permission sections.

**Important boundary:** because this policy checker executes as a step
inside the workflow, it cannot prevent a malicious action or privileged
event from running before the checker. Repository branch protection,
workflow review and GitHub settings must independently enforce the policy.
A passing CI result alone is not authorization to merge or deploy.

## Runner environment and execution bound

The CI job now uses the explicit GitHub-hosted runner label
`ubuntu-24.04`, rather than the moving `ubuntu-latest` alias.
The workflow policy also requires exactly one `runs-on` declaration
with that value and exactly one `timeout-minutes: 20` declaration.
A mutable, self-hosted or unreviewed runner substitution, duplicate
runner declaration, or enlarged/missing timeout fails the policy gate.

This pins the **Ubuntu release label**, not the complete hosted
runner image or its package inventory. GitHub may still update
software on that runner. Any environment change requires fresh
CI evidence. The checker executes inside CI and is not a substitute
for branch protection or independent workflow review.

## No masked CI failures

The CI workflow policy now refuses `continue-on-error` declarations
anywhere in the checked workflow, including a literal `false` that could
later be changed unnoticed. A failed security, test, build or provenance
check must fail its job.

The sole approved unconditional `if: always()` declaration is the
upload step named `Upload sanitized npm audit summary`. Keeping this
evidence upload unconditional supports triage when a previous step
fails; it does not turn the failed job green or authorize release.

The checker is deliberately scoped to this workflow's text and should
not be treated as a general-purpose YAML security parser. Branch
protection and mandatory human review must provide independent
enforcement before merging workflow changes.

## Mandatory CI steps must not be conditionally bypassed

The workflow policy now rejects **all** `if:` condition declarations
except the existing `if: always()` on the `Upload sanitized npm audit
summary` step. This blocks bypass attempts such as `if: false`,
`if: success()`, GitHub expressions, or a job-level condition that
silently skips required validation.

The audit artifact upload remains unconditional solely to preserve
forensic evidence after a failed step. This exception does not change
the job result or confer release authority. These are narrow
workflow-text checks, **not** a complete GitHub Actions YAML security
analysis. Independent reviews and GO-13 HOLD remain mandatory.

## Required CI gate order and command consistency

The new pre-install `scripts/check-ci-step-order.mjs` verifies that
the required named steps appear in the approved order: source and
dependency checks, immutable-lockfile installation, package inventory,
typecheck, tests, build, vulnerability audit, independent evidence
verification and review artifact uploads. It also verifies the approved
one-line commands, requires the mandatory npm audit and sanitizer,
and refuses extra jobs or unnamed `run:` steps.

Regression tests check reordered, deleted and renamed validation gates,
unexpected job additions and changed installation or audit commands.
This is a **local text-based consistency check**, not a general GitHub
Actions YAML parser; it does not prove the contents of arbitrary
multiline scripts are benign. Because it executes within the CI
workflow, protection of workflow changes requires external repository
rules and independent human review. GO-13 remains HOLD.

## Exact audit shell sequence

The CI step-order gate now checks the **complete approved multiline bash
body** that invokes `npm audit`: cleanup trap, exit-code capture,
re-enabling fail-on-error and the sanitized summary generator. It rejects
injected shell commands, changed interpreters, missing cleanup, and
reordered handling even when the required audit command still appears.
Negative regression tests cover each case.

This is a narrow defense against accidental or adversarial changes to
the checked workflow body, not a general shell parser. External branch
protection and review are still required; GO-13 stays HOLD.

## Pinned forensic artifact publication

The CI gate now compares the **entire final artifact upload configuration**
against the reviewed publication policy. It permits only the generated
`npm-dependency-inventory.json` and `npm-audit-summary.json` files, uploaded
through the approved pinned action. Both artifacts retain a seven-day
lifetime. The inventory upload requires its file (`if-no-files-found:
error`); the audit upload uses `if: always()` and warns when no sanitized
report exists after an earlier failed job.

Changes to artifact paths, names, retention periods, extra upload options,
or trailing workflow steps must fail the policy gate. Regression tests cover
file substitutions, alternate missing-file handling, retention changes and
unreviewed upload options. These checks protect the workflow's declared
settings, not external artifact-storage integrity or independent release
authority. GO-13 remains HOLD.

## Reviewed checkout and Node action inputs

In addition to exact approved Action commit SHAs, the CI policy now
verifies the **complete reviewed initial action-setup sequence**:
checkout without persisted credentials, followed by `setup-node`
using Node.js 22, with no additional action inputs. Changes that
select another checkout repository or ref, change fetch depth, alter
the Node runtime, add caching or custom package registry settings,
or supply a different token fail the policy gate.

These checks constrain the workflow configuration but do not pin
the underlying Node.js patch release or runner image revision, and
cannot independently verify the upstream Action code. The workflow
must still undergo human review and branch-protection checks before
merging. GO-13 and release authorization remain HOLD / DENY.

## Fail-closed npm audit status handling

The npm audit evidence generator treats only npm scanner exit status
`0` as a clean scan and `1` as a completed scan reporting findings.
Any other status is classified as a scanner/infrastructure `ERROR`,
even if partial vulnerability counts are present. An unexpected,
missing or malformed audit gate result cannot return a successful
exit code. Regression tests cover nonstandard exit codes and
unrecognized result states.

These controls prevent partial scanner failures from being mistaken
for valid security evidence. They do not establish that all packages
are vulnerability-free, and release authorization remains `DENY`.

## CI concurrency and branch isolation

The CI policy requires one top-level concurrency declaration:
`ci-${{ github.workflow }}-${{ github.ref }}` with
`cancel-in-progress: true`. The workflow checker rejects changed or
missing cancellation, unreviewed global grouping, duplicate blocks,
and job-level overrides. Grouping by workflow and full Git ref helps
prevent unrelated branches from canceling each other's verification
while replacing outdated runs on the same ref.

GitHub scheduling and artifact availability remain external to this
policy: a canceled run is **not** a passing result. Reviewers must
verify a successful run against the exact PR HEAD, and GO-13 remains
HOLD until independently authorized.

## Restricted CI execution contexts

The single-job verification workflow does not use workflow/job/step
`env` maps, deployment `environment`, `secrets` mapping, custom
`container`, `services`, `strategy` matrix or `defaults` overrides.
The CI policy checker rejects new declarations of any of these
keys. Negative regression tests cover injected environment variables,
production environment bindings, secret maps, container/service
launchers, matrices and alternative run defaults.

This prevents those configuration fields from being introduced without
an explicit policy revision and external review. It is a narrow,
text-based workflow guard rather than full YAML validation or a
runtime sandbox. The use of `GITHUB_SHA` and other GitHub-managed
environment variables by Node scripts does not constitute approval
for injecting arbitrary environment values. GO-13 stays HOLD.

## Git-tracked workflow inventory baseline

The pre-install CI policy gate enumerates the Git index using
`git ls-files --cached -z -- .github/workflows` and requires the **five
already established tracked workflows** to match the reviewed inventory:

- `.github/workflows/ci.yml`
- `.github/workflows/live-provider-conformance-launcher.yml`
- `.github/workflows/live-provider-conformance.yml`
- `.github/workflows/registry-contract.yml`
- `.github/workflows/veldgids-runtime-ci.yml`

Missing, renamed, duplicated or newly added workflow paths fail this
inventory check until separately reviewed. Existing other workflows are
**not** thereby validated against the specific restrictions of `ci.yml`;
their code, triggers, tokens and execution privileges require a
separate security review. This gate checks file names, not file contents.

**Important:** Because this checker runs *inside* one workflow, it cannot
prevent a newly added privileged workflow from starting before the check.
Repository rulesets, branch protection and independent human approval
remain mandatory. GO-13 stays HOLD / authorization DENY.

## Legacy workflow content drift boundary

In addition to checking the five tracked workflow paths, the CI policy
now hashes the working-tree contents of the four **existing non-CI
workflows** using `git hash-object` and compares each to its explicitly
recorded Git blob identifier. Any missing file or content drift fails
the CI policy gate until a reviewer intentionally updates the baseline.
The actively maintained `ci.yml` is not frozen by this legacy-content
gate; its behavior is constrained by separate checks.

**Residual risks, not security approvals:** the legacy workflows still
contain mutable action tags (`@v4`, `@v5`), moving
`ubuntu-latest` runners, and some `npm install` commands. The
live-provider conformance workflows also use manually initiated runs
with secrets and intentionally continue past the provider-execution step
to produce a separate verdict. These existing behaviors need their own
dedicated review before any security or release assurance can be made.
Pinning their existing blobs only detects changes; it does not make
those behaviors safe or apply the primary CI policy to them.

This internal check cannot prevent a privileged workflow from starting
before the CI check. Repository rulesets, branch protection and a
human security review remain independent requirements. GO-13 HOLD.

## Noncanonical GitHub Actions `uses` keys

The CI Action SHA checker now counts every YAML-style `uses` key,
including valid-but-noncanonical whitespace variants such as `uses :`.
Any variant that the strict approved-action scanner does not recognize
fails closed instead of silently skipping an extra unpinned Action.
Regression tests exercise hidden local/external Actions and mutated
mandatory action lines.

This is a targeted guard against alternate key spelling, not a full YAML
parser. Other ways to alter workflow semantics still require independent
GitHub branch protection and code review. GO-13 HOLD.

## YAML condition and command key variants

The CI policy gate now also rejects noncanonical YAML mapping keys
`if :`, `if  :`, `run :` and `run  :`. Such spellings are valid
YAML but were invisible to the earlier strict `if:` and `run:`
scanners. The guards compare the number of all YAML-style keys
against canonical keys before checking required conditions and
verification commands. Regression tests cover extra hidden step and
job conditions, hidden shell commands and edited mandatory run steps.

The guard is intentionally scoped to this canonical workflow rather
than a full YAML parser; it does not replace independent review or
repository protection. GO-13 remains HOLD.

## Fixed shell and working-directory execution context

The CI step-order validator now permits exactly one explicit
`shell: bash` declaration, within the approved npm-audit step, and
rejects any additional shell declaration (including `shell :` or
alternative shells). The validator also prohibits all step-level
`working-directory` overrides, including YAML whitespace variants.
These settings otherwise allow unchanged-looking `run:` commands to
execute in an unreviewed environment or directory. The existing
job/workflow `defaults` prohibition remains in force.

Regression tests cover unreviewed shells, altered audit shell keys,
missing audit shell declarations and redirected test execution. This
is an in-workflow textual guard, not independent workflow attestation.
GO-13 remains HOLD / DENY.

## Approved CI root structure

The main CI workflow must have exactly these five top-level YAML keys,
in reviewed order: `name`, `on`, `permissions`,
`concurrency`, and `jobs`. The policy gate rejects unexpected,
duplicated, removed, reordered or whitespace-variant root keys. This
prevents silently introducing root-level workflow features or
overriding the existing reviewed structure. Regression tests exercise
extra `run-name`, duplicate root blocks and altered spelling.

This control constrains only the textual root structure of the
reviewed `ci.yml`; it is not an independent YAML parser or a
replacement for GitHub branch protections and workflow review.
GO-13 remains HOLD / DENY.

## Quoted YAML security keys

YAML allows quoted mapping keys such as `'uses':`, `"if":`,
`'continue-on-error':` and `"permissions":`. The canonical CI
policy checks previously examined plain key spellings and could miss
such equivalent keys. The pinned-action preflight now rejects quoted
forms of action, condition, execution, credential, privilege and
error-suppression keys before dependency installation. Negative
regression tests cover quoted local/external actions, hidden step
conditions, shell commands, secrets and execution overrides.

This guard operates on the committed workflow text; it does not
provide complete YAML parsing or independent policy enforcement.
Legacy workflows are subject to content-drift checks only and
continue to require their own security review. GO-13 HOLD / DENY.

## YAML anchor, alias and merge indirection

The reviewed CI workflow does not use YAML anchors (`&name`),
aliases (`*name`) or merge keys (`<<:`). The pre-install
Action-policy check now rejects those constructs when used as YAML
mapping values or merge keys. This reduces the risk that a configuration
change is hidden behind indirection instead of appearing as a reviewed
plain mapping. Two negative regression scenarios cover anchors,
aliases, quoted mapping keys and merge-key spelling variants.

The check is intentionally narrow and text-based, not a general YAML
parser or proof of the workflow's actual interpreted semantics.
Repository rulesets, protected branches, restricted workflow permissions
and independent review remain necessary. GO-13 HOLD / DENY.

## Single-document YAML boundary

The reviewed `ci.yml` uses one plain YAML document with space-based
indentation. The CI Action-policy preflight rejects document separators
(`---`, `...`), YAML `%YAML`/`%TAG` directives and tab indentation.
These constructs are outside the canonical text-scanning policy, and
must not introduce alternative parsing behavior or a second document
that is not covered by the verified action and step inventory.

Negative regression tests cover appended documents, document markers,
directives, and indentation changes. This is a limited textual
consistency check rather than a complete YAML parser or an independent
GitHub policy boundary. GO-13 remains HOLD / DENY.

## Canonical CI step mapping and labels

The CI step-order validator now requires exactly one canonical
`steps:` mapping at the reviewed indentation, and exactly the reviewed
set of named steps written as `- name:`. Duplicate `steps:` blocks,
valid YAML alternatives like `steps :` and `name :`, and additional
unreviewed step-name mappings are rejected. These changes prevent
alternate YAML key spellings from silently changing the set of
executed verification steps while the strict step-label comparison
still appears to match.

Regression tests cover injected, renamed, missing and duplicate
step metadata. This remains an in-workflow text consistency check,
not a YAML parser or independent branch-protection control.
GO-13 remains HOLD / DENY.

## No unreviewed CI dataflow

The canonical verification job has no `needs` dependencies, `outputs`
mappings or step `id` fields. The pre-install policy rejects these
keys, including whitespace-variant and quoted YAML spellings. New
job dependencies, step output references or exported result mappings
would require a separately reviewed contract rather than silently
changing execution or evidence lineage.

Two negative regression scenarios exercise job-level `needs` and
`outputs` as well as injected step IDs and output mappings. This
is an internal textual policy guard, not a full YAML parser or an
independent branch protection rule. GO-13 remains HOLD / DENY.

## Exactly one Action input mapping

The central CI workflow now requires a single canonical `with:` input
mapping for each of the four approved external Action invocations:
checkout, Node setup and the two evidence uploads. An added duplicate,
missing mapping, quoted `"with":` or whitespace-variant `with :`
fails the pre-install gate. This closes a configuration-drift path in
which the approved Action SHA remains unchanged but its effective
inputs may be shadowed or replaced.

Negative regression tests cover duplicate and missing maps, plus
alternate key spellings. The gate does not parse YAML into a semantic
tree and cannot replace independent code review, required checks or
GitHub repository protections. GO-13 HOLD / DENY.

## Canonical runner and timeout keys

The main CI job must retain one `runs-on: ubuntu-24.04` and one
`timeout-minutes: 20` mapping. In addition to checking their values,
the pre-install policy now rejects duplicate and whitespace-variant
forms such as `runs-on : self-hosted` and
`timeout-minutes : 0`. Such YAML mappings could otherwise alter the
effective runner or runtime limit without matching canonical-key scans.

Negative regression tests cover added, replaced and reordered
variants. These safeguards are in-workflow textual checks and do
not supersede independent rulesets, review or branch protection.
GO-13 HOLD / DENY.

## Canonical CI workflow encoding

The reviewed `.github/workflows/ci.yml` is plain UTF-8-compatible
text with LF line endings. The Action-policy preflight now rejects
a leading byte-order mark (BOM), carriage returns (including CRLF)
and noncanonical ASCII control characters. Such invisible characters
can change text-scanner assumptions or create differences between
inspection tools. Negative regression tests cover BOM, CRLF, CR-only
and embedded controls, while preserving the approved LF-only workflow.

This does not establish an independent attestation of the workflow
bytes or replace semantic YAML review and repository protections.
GO-13 remains HOLD / DENY.

## Quoted Action input map shadowing

The central CI policy now explicitly rejects quoted YAML `with` keys,
including a second quoted `with` mapping next to a canonical Action input
map. YAML treats quoted and unquoted mapping keys as equivalent, so a
shadow map could change checkout credential persistence or other pinned
Action parameters despite unchanged Action references. Negative tests
cover both single- and double-quoted replacements and duplicate maps.

This remains an in-workflow text guard, not a semantic YAML parser or an
independent protection against workflow edits. GO-13 HOLD / DENY.

## YAML explicit mapping keys

The CI Action-policy preflight now rejects explicit YAML mapping-key
indicators (lines beginning with `?` followed by a space or end of line).
Explicit keys can encode effective fields such as `uses`, `with`,
`runs-on` or `jobs` without matching canonical mapping-key scans.
The reviewed CI workflow has no such indicators. Negative regression
fixtures cover explicit keys at workflow, job and Action-input levels.

This is a conservative textual guard and does not provide full semantic
YAML verification or independent repository protection. GO-13 HOLD / DENY.

## CI #723 regression and corrective action

CI #723 failed during the pinned-Action preflight because the initial
explicit-key regular expression inadvertently matched blank lines. The
checker has been corrected to recognize a literal YAML `?` indicator
rather than an optional backslash. A positive regression fixture now
requires ordinary blank lines and comments to pass, while the earlier
negative fixtures continue to require explicit mapping keys to fail.
A failure is not evidence of a passing build; rerun verification is
mandatory. GO-13 HOLD / DENY.

## Bounded per-file CI test execution (phase 58)

CI #727 passed its initial policy and dependency checks but was cancelled at
the 20-minute job timeout while running the combined `npm test` command.
The GitHub log showed only the first three test cases before the timeout;
it did not identify the stalled test worker. This is **not** a passing CI run.

The `npm test` entry now invokes `scripts/run-tests-bounded.mjs`, which
discovers all existing `tests/*.test.mjs` and `tests/*.test.ts` files,
requires both suites, sorts the filenames, and executes each file
independently with a 90-second limit. It logs each file before execution
and fails the entire job on nonzero exit, signal, timeout or spawn error.
No file is silently skipped, retried, or marked as passing after a
timeout. TypeScript tests run via Node with the installed `tsx` import hook.
The root CI job still retains its existing 20-minute overall timeout.

This change improves fault localization and bounds individual test files,
but it does **not** prove that all tests will finish within the overall
job limit or that a timed-out child process has no descendants. Reviewers
must inspect the new GitHub Actions run and resolve any failing test.
GO-13 remains DRAFT / HOLD / DENY.

## CI #734 checkout scanner boundedness

CI #734 **FAILED** after the bounded runner identified
`check-ci-action-pins.test.mjs` as timing out after 90 seconds, with no
completed test case. The earlier checkout validator used an ambiguous
repeated whitespace/line regex. Its checkout shape check has been replaced
with a strictly line-anchored, fixed three-line matcher; the separate
reviewed setup-input sequence check continues to protect both setup Actions.
A negative performance regression fixture checks a large malformed input.
This is a targeted mitigation, not a guarantee against all ReDoS elsewhere.
Full CI remains mandatory, and GO-13 remains HOLD / DENY.

## CI #739 negative fixture correction (phase 60)

CI #739 **FAILED** in `check-ci-action-pins.test.mjs`: 46 of 47 cases
passed, with the explicit YAML mapping-key regression failing. Investigation
found that three fixture strings encoded literal `\\n` sequences instead
of JavaScript newline escapes `\n`; thus the inputs did not contain the
intended `? key` YAML lines. The test fixtures have been corrected without
weakening the existing explicit-key indicator guard. The failed CI run
remains failed, and the new HEAD requires complete independent CI
verification. GO-13 remains DRAFT / HOLD / DENY.
