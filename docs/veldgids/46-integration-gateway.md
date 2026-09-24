# Block 46 — Integration Gateway

External integrations are isolated behind adapters.

## Adapter contract
Each adapter declares:
- provider
- capability
- credential reference
- input/output schema
- timeout/retry policy
- authorization requirement
- provenance behavior
- failure semantics

No external provider receives authority merely because it is connected.

Adapters are replaceable; domain contracts remain provider-neutral.