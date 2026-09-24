# Block 25 — Mentor Memory Boundary

Mentor memory is separated into:
- SESSION CONTEXT
- CASE MEMORY
- USER-PROVIDED LONG-TERM MEMORY
- SYSTEM KNOWLEDGE
- MODEL EPHEMERAL STATE

## Rules
1. Memory has explicit provenance.
2. Case memory is not silently promoted to general knowledge.
3. User-controlled memory is distinguishable from source evidence.
4. Published knowledge requires versioning.
5. Deletion/revocation creates an auditable lifecycle event where policy permits.
6. A mentor must not invent remembered facts.

The Mentor Meester receives only the minimum context required by the routing policy.
