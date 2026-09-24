# Block 45 — Data Retention & Revocation

Data lifecycle is explicit.

## States
ACTIVE -> RETENTION_REVIEW -> ARCHIVED
and where required:
ACTIVE -> REVOKED

Revocation does not silently delete historical evidence. Downstream objects receive a review signal and retain provenance to the revoked artifact.

Deletion follows applicable policy and legal requirements while preserving the minimum audit evidence required for system integrity.