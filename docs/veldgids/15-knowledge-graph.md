# Block 15 — Knowledge Graph

The Knowledge Graph connects the Levensader without collapsing distinct evidence into one undifferentiated store.

## Node classes
KNOWLEDGE_OBJECT
SOURCE
PERSON
ORGANIZATION
CASE
MENTOR
PROMPT
REPORT
ATTACHMENT

## Canonical relation types
supports
contradicts
derived_from
related_to
explains
references
used_in
reviewed_by
created_by

## Relation requirements
Each relation has:
relation_id, source_node, target_node, relation_type, provenance_ref, created_by, created_at, status, version.

## Graph invariants
1. No silent relation changes.
2. Published relations are versioned.
3. A relation does not imply endorsement.
4. Provenance is retained for consequential edges.
5. Revoked source material propagates a review signal to dependent knowledge objects.

## First graph query targets
- What sources support this object?
- What objects contradict or qualify it?
- Which cases use this knowledge?
- Which mentor analyses depend on it?
- What changed since the previous version?
