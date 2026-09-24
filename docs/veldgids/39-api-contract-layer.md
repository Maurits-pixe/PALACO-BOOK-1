# Block 39 — API Contract Layer

All application capabilities are exposed through explicit versioned contracts.

## API domains
- identity
- knowledge
- library
- cases
- people
- mentors
- prompts
- workflows
- research
- evaluations
- reports
- observability

Every consequential mutation records actor, authorization context, object version, timestamp, and provenance.

API contracts are transport interfaces, not replacements for PALACO domain invariants.