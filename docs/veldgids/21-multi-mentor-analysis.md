# Block 21 — Multi-Mentor Analysis

Each selected mentor receives the same canonical context boundary unless the routing policy explicitly defines a narrower scope.

A MentorAnalysis contains:
analysis_id
mentor_id
question_hash
input_context_hash
claims[]
evidence_refs[]
uncertainties[]
limitations[]
recommendations_or_options[]
created_at
model_binding
prompt_version

Mentors must distinguish:
FACT
INFERENCE
HYPOTHESIS
UNKNOWN

Mentor analyses remain separate until the synthesis phase.
