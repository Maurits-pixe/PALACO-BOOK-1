PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS remediation_verifications(
  verification_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  envelope_id TEXT NOT NULL,
  envelope_version INTEGER NOT NULL CHECK(envelope_version>0),
  signal_id TEXT NOT NULL,
  signal_version INTEGER NOT NULL CHECK(signal_version>0),
  target_type TEXT NOT NULL CHECK(target_type IN ('KNOWLEDGE_VERSION','RELATION')),
  target_id TEXT NOT NULL,
  expected_version INTEGER NOT NULL CHECK(expected_version>0),
  observed_version INTEGER,
  expected_hash TEXT NOT NULL,
  observed_hash TEXT,
  verdict TEXT NOT NULL CHECK(verdict IN ('MATCH','MISMATCH')),
  status TEXT NOT NULL CHECK(status IN ('RECORDED','CLOSED')),
  evidence_json TEXT NOT NULL,
  closure_note TEXT,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  supersedes_version INTEGER,
  PRIMARY KEY(verification_id,version),
  FOREIGN KEY(envelope_id,envelope_version) REFERENCES remediation_execution_envelopes(envelope_id,version),
  FOREIGN KEY(signal_id,signal_version) REFERENCES review_signals(signal_id,version)
);

CREATE TRIGGER IF NOT EXISTS remediation_verifications_no_update
BEFORE UPDATE ON remediation_verifications
BEGIN SELECT RAISE(ABORT,'REMEDIATION_VERIFICATION_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS remediation_verifications_no_delete
BEFORE DELETE ON remediation_verifications
BEGIN SELECT RAISE(ABORT,'REMEDIATION_VERIFICATION_APPEND_ONLY'); END;

CREATE INDEX IF NOT EXISTS idx_remediation_verification_envelope
ON remediation_verifications(envelope_id,version);

CREATE INDEX IF NOT EXISTS idx_remediation_verification_signal
ON remediation_verifications(signal_id,version);

CREATE INDEX IF NOT EXISTS idx_remediation_verification_status
ON remediation_verifications(status,verdict,created_at);
