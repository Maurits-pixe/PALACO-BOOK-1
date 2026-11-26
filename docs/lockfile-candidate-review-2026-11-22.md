# PALACO-BOOK-1 — npm lockfile candidate review (2026-11-22)

Status: **EVIDENCE ONLY / HOLD**. This report is not release authorization.

## Source evidence

- GitHub Actions workflow: CI run **#404**, workflow run ID `44987258640`
- GitHub source commit: `dd3441ac456bb5e15321295b10de6723446b4ad1`
- Artifact: `npm-lockfile-candidate`, artifact ID `14740775079`
- GitHub artifact archive digest: `sha256:d313b0f477569482c3323c690baed947f588555f0de765f6f9f5c62a3642f74c`
- Extracted `package-lock.json` SHA-256: `93adf9a9e8f38bc1dc46ade05275836706b59c0f7ee8a90f2da144871bd9206d`
- Extracted lockfile size: **64,654 bytes**
- Artifact retention expiration (provider): **2026-11-29 04:57:32 UTC**

## Static inspection of the downloaded candidate

- npm `lockfileVersion`: **3**
- `packages` entries: **127** (root package plus **126** dependency locations)
- Root package name/version match `package.json`: `palaco-bluebook` / `0.1.0-alpha.0`
- Root dependency and devDependency declarations match `package.json`
- Registry hosts appearing in non-root `resolved` URLs: **registry.npmjs.org only**
- Non-root entries lacking an `integrity` value: **0**
- The inspected source metadata passed the then-current CI structural verifier.
- Workflow #404 steps for install, lockfile metadata validation, tests, and build reported **success**.

## Remaining gates

1. Have a human review all resolved versions, supply-chain risks, vulnerability advisories and the full dependency graph.
2. Review the full JSON lockfile, not only its metadata summary. This report does not independently verify archive bytes against the registry or prove package safety.
3. Add the exact reviewed lockfile to Git in a separate change and run the committed-lockfile `npm ci` route.
4. Require fresh CI results for the final commit. Do not confuse workflow success for this candidate with approval for production.

**No lockfile is committed by this report. Main branch and production remain unchanged.**

## Recorded top-level resolutions

The downloaded candidate resolves these direct packages (examples; full file
review is still required):

| Package | Resolved version |
| --- | --- |
| next | 15.5.29 |
| react | 19.3.1 |
| react-dom | 19.3.1 |
| zod | 4.6.7 |
| better-sqlite3 | 12.11.1 |
| typescript | 5.9.3 |
| tsx | 4.23.15 |

Downloaded ZIP inspection independently confirmed the exact `package-lock.json`
SHA-256 recorded above. Version inventory is not a vulnerability assessment.

## Future artifact digest procedure

From the updated CI workflow, each newly generated candidate artifact contains
`package-lock.json` and `package-lock.sha256`. After downloading, verify with:

```sh
sha256sum -c package-lock.sha256
```

A matching digest proves that the bytes match the workflow-recorded hash,
not that the dependencies are safe, signed, or vulnerability-free. For the
older workflow #404 artifact, use the SHA-256 value in this report instead:
its archive does not contain the new `package-lock.sha256` sidecar.

## CI run #460 — successful npm ci rehearsal

GitHub Actions [run #460](https://github.com/Maurits-pixe/PALACO-BOOK-1/actions/runs/44990455213)
on commit `5990ce899baad55f92b6e7ac119386f1b6a86465`
completed **SUCCESS**. The verified job steps included:

- Generate npm lockfile candidate using `npm install`.
- Record `package-lock.json` SHA-256 before the second installation.
- Run `npm ci` with the generated candidate: **SUCCESS**.
- Validate lockfile metadata and verify `sha256sum -c package-lock.sha256`
  after `npm ci`: **SUCCESS**.
- Typecheck, test, build and npm advisory audit: **SUCCESS**.

The downloaded `npm-lockfile-candidate` artifact ID `14741137661`
has archive digest
`sha256:8da8500a8a41a599b9f1282365f340a72944f6a870aa1ac4bbfc99d4f1f3c61d`.
The extracted **64,655-byte** `package-lock.json` SHA-256 is
`4b2c8c5bde333a2c7263d9014751f04f1fe4ea425d09c47fcb1163869a4646a1`,
matching its bundled `package-lock.sha256` sidecar.

Static inspection counted **126** non-root package entries and no
non-registry or non-HTTPS archive origins in the candidate. The
`npm-audit-summary` artifact ID `14741114259` recorded `NO_FINDINGS`
with total vulnerabilities **0**, and `release_authorization: DENY`.

The **new lockfile override guard** added after run #460 verifies that
every package matching a pinned `package.json.overrides` entry resolves
to the exact required version, including nested instances. Its fresh CI
result must be established separately; #460 cannot verify later changes.

**Open:** human review and commit the exact candidate, then independently
repeat the committed-lockfile `npm ci` route before considering PR readiness.

## Committed lockfile — branch verification gate

The exact reviewed candidate from CI #460 was committed to the feature branch
as `package-lock.json` in commit
`20c9f278318d7da71070c6c72b579df2a2937098`.
The Git blob SHA is
`b8abd2125abc6bd312a0338d39c7b2bfb20a8498`,
identical to the local `git hash-object` of the downloaded artifact.

The `package-lock.json` SHA-256 remains:
`4b2c8c5bde333a2c7263d9014751f04f1fe4ea425d09c47fcb1163869a4646a1`.

This records an exact artifact-to-repository handoff. It does **not** signify
an independently completed security audit or production approval.

**Acceptance pending:** GitHub Actions must execute the **committed** lockfile
branch (`Verify committed lockfile before installation` then
`Install reproducibly from committed lockfile`), pass typecheck/tests/build,
and report the current npm-audit results. GO-13 HOLD and authorization DENY
remain in force regardless of CI outcome.
