# PALACO-BOOK-1 — npm vulnerability evidence, 2026-11-22

**Status: HOLD / Authorization DENY.** This is a security finding record, not a release approval.

## Verified source

- Repository: `Maurits-pixe/PALACO-BOOK-1`
- Draft PR: [#23](https://github.com/Maurits-pixe/PALACO-BOOK-1/pull/23)
- GitHub Actions run: [#422](https://github.com/Maurits-pixe/PALACO-BOOK-1/actions/runs/44988341370)
- Scanned revision: `1619514c3361ecf2ccc4f0756cfd4917dc22e475`
- Artifact: `npm-audit-summary`, ID `14740384632`
- Artifact archive SHA-256: `ee9283220b93252e649758cabfe0abd59b5ddb14919fe927694ba3a5a10a26b3`

## Audit findings

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | **1** |
| Moderate | **1** |
| Low | 0 |
| Info | 0 |
| **Total** | **2** |

The summary reports `status: FINDINGS` and `release_authorization: DENY`.
The prior CI workflow concluded SUCCESS because findings were evidence-only.
That green status must **not** be interpreted as a clean security review.

The sanitized report does **not** identify the affected package(s), advisory
numbers, introduced dependency paths, or fixes. These details must be
retrieved from an appropriately controlled npm audit investigation before
making dependency upgrades.

## Remediation and acceptance

1. The CI audit gate now fails on any **high or critical** finding; scanner
   error output also fails closed. Moderate findings remain review-required.
2. Investigate the exact packages, affected version ranges, and dependency
   paths privately; avoid logging account tokens or personal information.
3. Prepare a reviewed dependency update and authentic committed lockfile.
4. Require a successful `npm ci` build and refreshed npm audit evidence
   without unresolved high/critical vulnerabilities.
5. Retain human GO-13 review and explicit production authorization separately
   from CI results.

**No dependency patch, merge, release, or production deployment is claimed
by this evidence record.**
