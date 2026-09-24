PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,title TEXT NOT NULL,objective TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge_objects(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES cases(id),title TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_refs(knowledge_id TEXT NOT NULL REFERENCES knowledge_objects(id),source_id TEXT NOT NULL,source_version INTEGER NOT NULL CHECK(source_version>0),provenance_state TEXT NOT NULL,PRIMARY KEY(knowledge_id,source_id,source_version));
CREATE TABLE IF NOT EXISTS audit_events(event_id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,object_id TEXT NOT NULL,object_version INTEGER NOT NULL,timestamp TEXT NOT NULL,authorization_context TEXT NOT NULL,outcome TEXT NOT NULL,provenance_refs_json TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;
CREATE INDEX IF NOT EXISTS idx_knowledge_case ON knowledge_objects(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_events(object_id,timestamp);
