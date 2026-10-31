PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS remediation_closure_receipts(
  receipt_id TEXT PRIMARY KEY,
  verification_id TEXT NOT NULL,
  verification_version INTEGER NOT NULL CHECK(verification_version>0),
  signal_id TEXT NOT NULL,
  signal_version INTEGER NOT NULL CHECK(signal_version>0),
  work_id TEXT NOT NULL,
  work_version INTEGER NOT NULL CHECK(work_version>0),
  proposal_id TEXT NOT NULL,
  proposal_version INTEGER NOT NULL CHECK(proposal_version>0),
  envelope_id TEXT NOT NULL,
  envelope_version INTEGER NOT NULL CHECK(envelope_version>0),
  target_type TEXT NOT NULL CHECK(target_type IN ('KNOWLEDGE_VERSION','RELATION')),
  target_id TEXT NOT NULL,
  target_version INTEGER NOT NULL CHECK(target_version>0),
  chain_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  UNIQUE(verification_id),
  FOREIGN KEY(verification_id,verification_version) REFERENCES remediation_verifications(verification_id,version),
  FOREIGN KEY(signal_id,signal_version) REFERENCES review_signals(signal_id,version),
  FOREIGN KEY(work_id,work_version) REFERENCES remediation_work_items(work_id,version),
  FOREIGN KEY(proposal_id,proposal_version) REFERENCES remediation_proposals(proposal_id,version),
  FOREIGN KEY(envelope_id,envelope_version) REFERENCES remediation_execution_envelopes(envelope_id,version)
);

CREATE TRIGGER IF NOT EXISTS remediation_closure_receipts_no_update
BEFORE UPDATE ON remediation_closure_receipts
BEGIN SELECT RAISE(ABORT,'CLOSURE_RECEIPT_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS remediation_closure_receipts_no_delete
BEFORE DELETE ON remediation_closure_receipts
BEGIN SELECT RAISE(ABORT,'CLOSURE_RECEIPT_APPEND_ONLY'); END;

CREATE INDEX IF NOT EXISTS idx_closure_receipt_chain_hash
ON remediation_closure_receipts(chain_hash);

CREATE INDEX IF NOT EXISTS idx_closure_receipt_signal
ON remediation_closure_receipts(signal_id,signal_version);

CREATE INDEX IF NOT EXISTS idx_closure_receipt_target
ON remediation_closure_receipts(target_type,target_id,target_version);
