# Block 40 — Authentication & Authorization

Authentication establishes identity. Authorization determines permitted actions.

## Roles
OWNER, DEVELOPER, EDITOR, REVIEWER, MENTOR, USER

## Authorization model
Permissions are evaluated against:
- actor
- role
- resource
- action
- case/context
- sensitivity
- policy version

Default deny applies to protected operations. External actions require explicit authorization and are separately audited.

## Implemented read boundary

`GET /api/cases` and `GET /api/knowledge` require a valid actor plus `CASE_READ` or `KNOWLEDGE_READ`, respectively. OWNER, DEVELOPER, EDITOR, REVIEWER, and USER receive these read permissions; MENTOR receives neither. Missing, invalid, expired, revoked, or disabled-user sessions are rejected. Responses are private and must not be cached.

The current implementation is a shared authenticated workspace with role/action checks. It does not yet implement per-case ownership, tenant isolation, sensitivity policies, or a shared identity provider across repositories. The broader authorization model above remains a design target.
