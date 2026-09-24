# Block 44 — Audit & Observability

Every consequential operation produces an auditable event.

## Event
`event_id`, actor, action, object, object_version, timestamp, request_id, authorization_context, outcome, provenance_refs.

Operational metrics include availability, latency, failures, safety escalations, provenance gaps and resource consumption.

Audit history is append-oriented. Historical events are not silently rewritten.