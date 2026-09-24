# Block 33 — Mentor Performance & Telemetry

Telemetry is attached to a mentor invocation without turning the mentor into a ranked personality.

## Invocation record
`invocation_id`, `mentor_id`, `model_binding`, `prompt_version`, `latency_ms`, `token_usage`, `tool_calls`, `evidence_refs`, `safety_events`, `outcome_state`, `created_at`.

## Outcome states
`COMPLETED | PARTIAL | FAILED | ESCALATED | CANCELLED`

Performance analysis is contextual. The system must preserve dissent and must not silently convert telemetry into a permanent mentor quality label.
