PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS knowledge_versions(
  knowledge_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  case_id TEXT NOT NULL REFERENCES cases(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  supersedes_version INTEGER,
  PRIMARY KEY(knowledge_id,version)
);

CREATE TABLE IF NOT EXISTS knowledge_version_sources(
  knowledge_id TEXT NOT NULL,
  object_version INTEGER NOT NULL CHECK(object_version>0),
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK(source_version>0),
  provenance_state TEXT NOT NULL,
  PRIMARY KEY(knowledge_id,object_version,source_id,source_version),
  FOREIGN KEY(knowledge_id,object_version) REFERENCES knowledge_versions(knowledge_id,version)
);

INSERT OR IGNORE INTO knowledge_versions(
  knowledge_id,version,case_id,title,content,status,created_at,recorded_at,actor,supersedes_version
)
SELECT id,version,case_id,title,content,status,created_at,created_at,'MIGRATION',NULL
FROM knowledge_objects;

INSERT OR IGNORE INTO knowledge_version_sources(
  knowledge_id,object_version,source_id,source_version,provenance_state
)
SELECT r.knowledge_id,k.version,r.source_id,r.source_version,r.provenance_state
FROM source_refs r
JOIN knowledge_objects k ON k.id=r.knowledge_id;

CREATE TRIGGER IF NOT EXISTS knowledge_versions_capture_insert
AFTER INSERT ON knowledge_objects
BEGIN
  INSERT OR IGNORE INTO knowledge_versions(
    knowledge_id,version,case_id,title,content,status,created_at,recorded_at,actor,supersedes_version
  ) VALUES(
    NEW.id,NEW.version,NEW.case_id,NEW.title,NEW.content,NEW.status,NEW.created_at,NEW.created_at,'RUNTIME',NULL
  );
END;

CREATE TRIGGER IF NOT EXISTS knowledge_versions_capture_update
AFTER UPDATE OF case_id,title,content,status,version,created_at ON knowledge_objects
BEGIN
  INSERT INTO knowledge_versions(
    knowledge_id,version,case_id,title,content,status,created_at,recorded_at,actor,supersedes_version
  ) VALUES(
    NEW.id,NEW.version,NEW.case_id,NEW.title,NEW.content,NEW.status,NEW.created_at,NEW.created_at,'RUNTIME',OLD.version
  );
END;

CREATE TRIGGER IF NOT EXISTS knowledge_version_sources_capture
AFTER INSERT ON source_refs
BEGIN
  INSERT OR IGNORE INTO knowledge_version_sources(
    knowledge_id,object_version,source_id,source_version,provenance_state
  )
  SELECT NEW.knowledge_id,k.version,NEW.source_id,NEW.source_version,NEW.provenance_state
  FROM knowledge_objects k
  WHERE k.id=NEW.knowledge_id;
END;

CREATE TRIGGER IF NOT EXISTS knowledge_versions_no_update
BEFORE UPDATE ON knowledge_versions
BEGIN SELECT RAISE(ABORT,'KNOWLEDGE_HISTORY_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS knowledge_versions_no_delete
BEFORE DELETE ON knowledge_versions
BEGIN SELECT RAISE(ABORT,'KNOWLEDGE_HISTORY_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS knowledge_version_sources_no_update
BEFORE UPDATE ON knowledge_version_sources
BEGIN SELECT RAISE(ABORT,'KNOWLEDGE_HISTORY_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS knowledge_version_sources_no_delete
BEFORE DELETE ON knowledge_version_sources
BEGIN SELECT RAISE(ABORT,'KNOWLEDGE_HISTORY_APPEND_ONLY'); END;

CREATE INDEX IF NOT EXISTS idx_knowledge_versions_case
ON knowledge_versions(case_id,knowledge_id,version);

CREATE INDEX IF NOT EXISTS idx_knowledge_version_sources_object
ON knowledge_version_sources(knowledge_id,object_version);
