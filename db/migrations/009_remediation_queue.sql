PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS remediation_work_items(
  work_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  signal_id TEXT NOT NULL,
  signal_version INTEGER NOT NULL CHECK(signal_version>0),
  target_type TEXT NOT NULL CHECK(target_type IN ('KNOWLEDGE_VERSION','RELATION')),
  target_id TEXT NOT NULL,
  target_version INTEGER NOT NULL CHECK(target_version>0),
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLAIMED','PROPOSED','DECIDED')),
  assignee TEXT,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  supersedes_version INTEGER,
  PRIMARY KEY(work_id,version),
  FOREIGN KEY(signal_id,signal_version) REFERENCES review_signals(signal_id,version)
);

CREATE TABLE IF NOT EXISTS remediation_proposals(
  proposal_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  work_id TEXT NOT NULL,
  work_version INTEGER NOT NULL CHECK(work_version>0),
  proposal_type TEXT NOT NULL CHECK(proposal_type IN ('KNOWLEDGE_EVOLUTION','RELATION_EVOLUTION','RELATION_REVOKE','NO_CHANGE','ESCALATE')),
  target_type TEXT NOT NULL CHECK(target_type IN ('KNOWLEDGE_VERSION','RELATION')),
  target_id TEXT NOT NULL,
  base_version INTEGER NOT NULL CHECK(base_version>0),
  payload_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PROPOSED','ACCEPTED','REJECTED')),
  decision_note TEXT,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  supersedes_version INTEGER,
  PRIMARY KEY(proposal_id,version),
  FOREIGN KEY(work_id,work_version) REFERENCES remediation_work_items(work_id,version)
);

CREATE TRIGGER IF NOT EXISTS remediation_work_items_no_update
BEFORE UPDATE ON remediation_work_items
BEGIN SELECT RAISE(ABORT,'REMEDIATION_WORK_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS remediation_work_items_no_delete
BEFORE DELETE ON remediation_work_items
BEGIN SELECT RAISE(ABORT,'REMEDIATION_WORK_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS remediation_proposals_no_update
BEFORE UPDATE ON remediation_proposals
BEGIN SELECT RAISE(ABORT,'REMEDIATION_PROPOSAL_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS remediation_proposals_no_delete
BEFORE DELETE ON remediation_proposals
BEGIN SELECT RAISE(ABORT,'REMEDIATION_PROPOSAL_APPEND_ONLY'); END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_remediation_work_signal
ON remediation_work_items(signal_id)
WHERE version=1;

CREATE INDEX IF NOT EXISTS idx_remediation_work_latest
ON remediation_work_items(work_id,version);

CREATE INDEX IF NOT EXISTS idx_remediation_work_status
ON remediation_work_items(status,created_at);

CREATE INDEX IF NOT EXISTS idx_remediation_proposal_work
ON remediation_proposals(work_id,work_version,proposal_id,version);
