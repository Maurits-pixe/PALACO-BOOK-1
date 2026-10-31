PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS remediation_execution_envelopes(
  envelope_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  proposal_id TEXT NOT NULL,
  proposal_version INTEGER NOT NULL CHECK(proposal_version>0),
  operation_type TEXT NOT NULL CHECK(operation_type IN ('KNOWLEDGE_EVOLUTION','RELATION_EVOLUTION','RELATION_REVOKE')),
  target_type TEXT NOT NULL CHECK(target_type IN ('KNOWLEDGE_VERSION','RELATION')),
  target_id TEXT NOT NULL,
  base_version INTEGER NOT NULL CHECK(base_version>0),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PREPARED','AUTHORIZED','CANCELLED','CONSUMED')),
  authorized_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  supersedes_version INTEGER,
  PRIMARY KEY(envelope_id,version),
  FOREIGN KEY(proposal_id,proposal_version) REFERENCES remediation_proposals(proposal_id,version)
);

CREATE TRIGGER IF NOT EXISTS remediation_execution_no_update
BEFORE UPDATE ON remediation_execution_envelopes
BEGIN SELECT RAISE(ABORT,'REMEDIATION_EXECUTION_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS remediation_execution_no_delete
BEFORE DELETE ON remediation_execution_envelopes
BEGIN SELECT RAISE(ABORT,'REMEDIATION_EXECUTION_APPEND_ONLY'); END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_proposal
ON remediation_execution_envelopes(proposal_id)
WHERE version=1;

CREATE INDEX IF NOT EXISTS idx_execution_latest
ON remediation_execution_envelopes(envelope_id,version);

CREATE INDEX IF NOT EXISTS idx_execution_status
ON remediation_execution_envelopes(status,created_at);
