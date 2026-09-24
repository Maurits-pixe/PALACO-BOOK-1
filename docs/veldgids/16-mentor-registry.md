# Block 16 — Mentor Registry

Status: DESIGN-READY
Purpose: canonical registry for all De Mentale Veldgids mentors.

## Mentor classes
- PERMANENT: 16 fixed domain mentors.
- FREELANCE: 8 dynamically selected frontier specialists.

Every mentor has:
mentor_id, class, name_or_designation, domain, capabilities, limitations, model_binding, version, status, provenance, safety_profile.

A mentor registration does not grant authority to decide for the user.

## Registry states
PROPOSED -> ACTIVE -> SUSPENDED -> RETIRED

Model bindings are replaceable. Mentor identity and domain contract are not silently changed when the underlying model changes.
