PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS knowledge_relations(
  relation_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  source_knowledge_id TEXT NOT NULL,
  source_object_version INTEGER NOT NULL CHECK(source_object_version>0),
  target_knowledge_id TEXT NOT NULL,
  target_object_version INTEGER NOT NULL CHECK(target_object_version>0),
  relation_type TEXT NOT NULL CHECK(relation_type IN (
    'supports','contradicts','derived_from','related_to','explains','references','used_in','reviewed_by','created_by'
  )),
  provenance_state TEXT NOT NULL CHECK(provenance_state IN ('UNKNOWN','PARTIAL','TRACEABLE','VERIFIED','REVOKED')),
  evidence_refs_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  supersedes_version INTEGER,
  PRIMARY KEY(relation_id,version),
  FOREIGN KEY(source_knowledge_id,source_object_version) REFERENCES knowledge_versions(knowledge_id,version),
  FOREIGN KEY(target_knowledge_id,target_object_version) REFERENCES knowledge_versions(knowledge_id,version)
);

CREATE TRIGGER IF NOT EXISTS knowledge_relations_no_update
BEFORE UPDATE ON knowledge_relations
BEGIN SELECT RAISE(ABORT,'KNOWLEDGE_RELATION_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS knowledge_relations_no_delete
BEFORE DELETE ON knowledge_relations
BEGIN SELECT RAISE(ABORT,'KNOWLEDGE_RELATION_APPEND_ONLY'); END;

CREATE INDEX IF NOT EXISTS idx_knowledge_relations_source
ON knowledge_relations(source_knowledge_id,source_object_version,relation_id,version);

CREATE INDEX IF NOT EXISTS idx_knowledge_relations_target
ON knowledge_relations(target_knowledge_id,target_object_version,relation_id,version);
