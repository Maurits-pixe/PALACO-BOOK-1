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