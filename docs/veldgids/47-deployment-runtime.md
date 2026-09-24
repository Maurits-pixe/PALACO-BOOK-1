# Block 47 — Deployment Runtime

Deployment separates web, API, workers, storage, retrieval, and PALACO governance/runtime concerns.

## Runtime planes
1. Presentation
2. Application/API
3. AI orchestration
4. Knowledge/retrieval
5. Governance/audit
6. Persistence

Configuration is environment-bound and secrets are never committed to source.

Production rollout requires health checks, migrations, observability, rollback strategy, and explicit release provenance.