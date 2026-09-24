# Block 30 — Research Lab

Research Lab provides a controlled environment for exploratory research.

## Pipeline
`QUESTION -> SEARCH/RETRIEVE -> SOURCE REVIEW -> EXTRACT -> COMPARE -> ANALYZE -> SYNTHESIZE -> HUMAN REVIEW -> PUBLISH`

## Evidence boundary
Raw sources remain distinct from extracted text, AI analysis, and published conclusions.

## Research record
Each study records:
- research_id
- question
- scope
- source_set
- retrieval timestamps
- extraction versions
- analyses
- disagreements
- limitations
- human review
- publication status

## Reproducibility
A research result should be reconstructible from its source set, retrieval configuration, prompt/model versions, and analysis artifacts available under policy.
