# De Mentale Veldgids — executable slice v0.1

First executable web/application-domain slice for Blocks 36–50, aligned with
**PALACO — LEVENSADER Visual System v0.1**.

## Visual implementation
- Light Levensader workspace for knowledge, case context, provenance and audit.
- Dark Command Center surface for Mentor Council operations.
- Semantic design tokens from the canonical visual-system specification.
- Statuses combine color with text and shape.
- Responsive two-column/one-column application shell.
- 44px interaction targets and reduced-motion support.
- Complete 2D information; governance never depends on 3D.

## Boundaries
- Default-deny authorization for mutations.
- External side effects require explicit authorization.
- Mentor freelance slots are model-agnostic.
- Published knowledge must be versioned; no silent replacement.
- Audit records are append-oriented.
- AI remains advisory; `humanDecisionRequired` is explicit in routing.
- Demonstration content is explicitly synthetic.

## Run
```bash
npm install
npm run typecheck
npm run build
npm run dev
```

This slice does **not** claim production readiness, live-provider conformance, deployment, or security certification.
