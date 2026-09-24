# Block 49 — Release Governance

A release candidate is promoted through explicit gates.

## Gate chain
BUILD -> TEST -> SECURITY -> PROVENANCE -> HUMAN REVIEW -> RELEASE

Release records include:
- source commit
- artifact digest
- dependency snapshot
- configuration reference
- test results
- reviewer
- release timestamp
- rollback target

No silent production mutation is permitted.