# Block 27 — Prompt Library & Versioning

The Prompt Library is the canonical registry of reusable prompts.

## Invariants
1. A published prompt version cannot be silently overwritten.
2. Every execution references an exact prompt version.
3. Deprecated prompts remain traceable for historical executions.
4. Prompt provenance is separate from model provenance.
5. Prompt text and policy metadata are versioned together.

## Required metadata
`prompt_id`, `version`, `status`, `author`, `purpose`, `change_summary`, `created_at`, `published_at`, `supersedes`, `provenance`.

## Evaluation
Prompt versions can be compared through fixed benchmark datasets and safety checks. Evaluation results are evidence about a prompt under a defined test configuration, not a permanent quality guarantee.
