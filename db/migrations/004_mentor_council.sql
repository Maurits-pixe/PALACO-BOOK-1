PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS mentor_runs(
  id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL UNIQUE,
  case_id TEXT NOT NULL REFERENCES cases(id),
  actor_id TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  input_context_hash TEXT NOT NULL,
  input_refs_json TEXT NOT NULL,
  provenance_refs_json TEXT NOT NULL,
  safety_status TEXT NOT NULL CHECK(safety_status IN ('PASS','ESCALATE','BLOCKED')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mentor_observations(
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES mentor_runs(id),
  audit_id TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  mentor_id TEXT NOT NULL,
  adapter_kind TEXT NOT NULL CHECK(adapter_kind IN ('REMOTE','MOCK')),
  model_binding TEXT NOT NULL,
  capability_binding_json TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  input_refs_json TEXT NOT NULL,
  provenance_refs_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  uncertainties_json TEXT NOT NULL,
  safety_flags_json TEXT NOT NULL,
  dissent_signals_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mentor_consensus(
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES mentor_runs(id),
  participating_mentors_json TEXT NOT NULL,
  agreed_claims_json TEXT NOT NULL,
  disputed_claims_json TEXT NOT NULL,
  minority_claims_json TEXT NOT NULL,
  evidence_conflicts_json TEXT NOT NULL,
  unresolved_questions_json TEXT NOT NULL,
  proposed_response_json TEXT NOT NULL,
  synthesis_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mentor_runs_case ON mentor_runs(case_id,created_at);
CREATE INDEX IF NOT EXISTS idx_mentor_observations_run ON mentor_observations(run_id,mentor_id);
CREATE INDEX IF NOT EXISTS idx_mentor_observations_correlation ON mentor_observations(correlation_id);
