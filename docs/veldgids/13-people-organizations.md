# Block 13 — People & Organizations

People and organizations are first-class domain objects.

## Person
person_id, display_name, aliases, biography, roles, affiliations, source_refs, knowledge_refs, case_refs, created_at, updated_at.

## Organization
organization_id, name, type, description, members, source_refs, knowledge_refs, created_at, updated_at.

## Boundary
A person/organization record is descriptive data. It does not itself establish authority, diagnosis, endorsement or truth.

## Privacy
Sensitive personal information requires explicit access controls, purpose limitation, audit logging and retention rules. The AI system must not infer sensitive attributes merely because data is available.
