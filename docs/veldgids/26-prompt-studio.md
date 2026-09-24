# Block 26 — Prompt Studio

## Purpose
Prompt Studio is the controlled authoring surface for reusable AI instructions used by De Mentale Veldgids.

## Prompt artifact
Each prompt is a versioned object with:
- prompt_id
- title
- purpose
- system_instructions
- input_contract
- output_contract
- safety_profile
- evidence_policy
- allowed_tools
- version
- status
- created_by
- created_at
- provenance

## Lifecycle
`DRAFT -> TESTING -> REVIEW -> PUBLISHED -> DEPRECATED -> ARCHIVED`

Published prompts are immutable. Changes create a new version.

## Safety boundary
Prompt Studio must not encode autonomous diagnosis, treatment decisions, external actions, or hidden authority. Prompts may instruct an AI to surface uncertainty, evidence, disagreement, and escalation requirements.

## Execution
A prompt execution records prompt version, model binding, input hash, output hash, evidence references, and timestamp. Private chain-of-thought is not persisted as a product artifact.
