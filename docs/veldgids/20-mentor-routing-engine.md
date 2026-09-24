# Block 20 — Mentor Routing Engine

Input:
question + case context + available evidence + user intent.

Output:
a deterministic, auditable routing plan.

## Routing factors
- topic/domain
- requested task
- evidence availability
- case sensitivity
- uncertainty
- required independence
- safety profile

## Routing plan
ROUTE_ID
QUESTION_HASH
SELECTED_PERMANENT_MENTORS[]
SELECTED_FREELANCE_SLOTS[]
REASON_CODES[]
EVIDENCE_SCOPE
SAFETY_PROFILE
CREATED_AT
POLICY_VERSION

Routing is a plan, not authorization to take external action.
