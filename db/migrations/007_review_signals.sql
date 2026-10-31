PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS review_signals(
  signal_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  cause_kind TEXT NOT NULL CHECK(cause_kind IN ('SOURCE_REVOKED','SOURCE_CHANGED')),
  cause_source_id TEXT NOT NULL,
  cause_source_version INTEGER NOT NULL CHECK(cause_source_version>0),
  target_type TEXT NOT NULL CHECK(target_type IN ('KNOWLEDGE_VERSION','RELATION')),
  target_id TEXT NOT NULL,
  target_version INTEGER NOT NULL CHECK(target_version>0),
  impact_kind TEXT NOT NULL CHECK(impact_kind IN ('DIRECT_SOURCE','GRAPH_PROPAGATION','CONTEXT_REVIEW')),
  severity TEXT NOT NULL CHECK(severity IN ('REVIEW_REQUIRED','CONTEXT_REVIEW')),
  path_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  supersedes_version INTEGER,
  PRIMARY KEY(signal_id,version)
);

CREATE TRIGGER IF NOT EXISTS review_signals_no_update
BEFORE UPDATE ON review_signals
BEGIN SELECT RAISE(ABORT,'REVIEW_SIGNAL_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS review_signals_no_delete
BEFORE DELETE ON review_signals
BEGIN SELECT RAISE(ABORT,'REVIEW_SIGNAL_APPEND_ONLY'); END;

CREATE INDEX IF NOT EXISTS idx_review_signals_cause
ON review_signals(cause_source_id,cause_source_version,created_at);

CREATE INDEX IF NOT EXISTS idx_review_signals_target
ON review_signals(target_type,target_id,target_version,created_at);

CREATE INDEX IF NOT EXISTS idx_review_signals_identity
ON review_signals(signal_id,version);
