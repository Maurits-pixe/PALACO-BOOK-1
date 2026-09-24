PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS mentor_runs(
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  actor_id TEXT NOT NULL,
  question TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  input_context_hash TEXT NOT NULL,
  safety_status TEXT NOT NULL CHECK(safety_status IN ('PASS','ESCALATE')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mentor_analyses(
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES mentor_runs(id),
  mentor_id TEXT NOT NULL,
  adapter_kind TEXT NOT NULL,
  model_binding TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  uncertainties_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  recommendations_json TEXT NOT NULL,
  safety_flags_json TEXT NOT NULL,
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
  synthesis_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mentor_runs_case ON mentor_runs(case_id,created_at);
CREATE INDEX IF NOT EXISTS idx_mentor_analyses_run ON mentor_analyses(run_id,mentor_id);
