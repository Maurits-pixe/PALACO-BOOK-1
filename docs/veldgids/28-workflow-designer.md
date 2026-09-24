# Block 28 — Workflow Designer

Workflow Designer represents multi-step AI processes as auditable graphs.

## Node classes
- INPUT
- RETRIEVE
- CLASSIFY
- ROUTE
- MENTOR_ANALYZE
- SYNTHESIZE
- HUMAN_REVIEW
- REPORT
- EXPORT
- TERMINATE

## Edge rules
Every consequential edge is explicit. Conditional transitions record their predicate and policy version. External side effects require an explicit human-authorized action boundary.

## Workflow artifact
A workflow has:
`workflow_id`, `version`, `nodes`, `edges`, `input_contract`, `output_contract`, `required_authorization`, `safety_profile`, `provenance`.

## Invariant
A workflow definition is not an authorization to execute an external side effect.
