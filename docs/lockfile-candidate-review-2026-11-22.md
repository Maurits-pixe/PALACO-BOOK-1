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
