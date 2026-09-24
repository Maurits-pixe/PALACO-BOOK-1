import type Database from "better-sqlite3";
import type { AuditEvent,KnowledgeObject } from "./domain";
import type { CaseRecord } from "./store";
import type { CaseRepository,KnowledgeRepository,SourceRepository,SourceRecord,ProvenanceRepository,ProvenanceRecord,AuditRepository } from "./repositories";

export function sqliteRepositories(db:Database.Database){
  const cases:CaseRepository={
    insert(v){db.prepare("INSERT INTO cases(id,title,objective,status,created_at) VALUES(?,?,?,?,?)").run(v.id,v.title,v.objective,v.status,v.createdAt)},
    get(id){return db.prepare("SELECT id,title,objective,status,created_at AS createdAt FROM cases WHERE id=?").get(id) as CaseRecord|undefined}
  };
  const knowledge:KnowledgeRepository={
    insert(v){db.prepare("INSERT INTO knowledge_objects(id,case_id,title,content,status,version,created_at) VALUES(?,?,?,?,?,?,?)").run(v.id,v.caseId,v.title,v.content,v.status,v.version,v.createdAt)},
    listByCase(caseId){const rows=db.prepare("SELECT id,case_id AS caseId,title,content,status,version,created_at AS createdAt FROM knowledge_objects WHERE case_id=? ORDER BY created_at").all(caseId) as Omit<KnowledgeObject,"sources">[];const refs=db.prepare("SELECT source_id AS sourceId,source_version AS version,provenance_state AS provenance FROM source_refs WHERE knowledge_id=? ORDER BY source_id,source_version");return rows.map(r=>({...r,sources:refs.all(r.id)})) as KnowledgeObject[]}
  };
  const sources:SourceRepository={
    insert(v){db.prepare("INSERT INTO sources(id,version,uri,title,checksum,created_at) VALUES(?,?,?,?,?,?)").run(v.id,v.version,v.uri,v.title,v.checksum,v.createdAt)},
    get(id,version){return db.prepare("SELECT id,version,uri,title,checksum,created_at AS createdAt FROM sources WHERE id=? AND version=?").get(id,version) as SourceRecord|undefined}
  };
  const provenance:ProvenanceRepository={
    insert(v){db.prepare("INSERT INTO provenance_records(id,knowledge_id,source_id,source_version,status,created_at) VALUES(?,?,?,?,?,?)").run(v.id,v.knowledgeId,v.sourceId,v.sourceVersion,v.status,v.createdAt)},
    listByKnowledge(knowledgeId){return db.prepare("SELECT id,knowledge_id AS knowledgeId,source_id AS sourceId,source_version AS sourceVersion,status,created_at AS createdAt FROM provenance_records WHERE knowledge_id=? ORDER BY created_at,id").all(knowledgeId) as ProvenanceRecord[]}
  };
  const audit:AuditRepository={
    append(v){db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)").run(v.eventId,v.actor,v.action,v.object,v.objectVersion,v.timestamp,v.authorizationContext,v.outcome,JSON.stringify(v.provenanceRefs))},
    listForObjects(ids){if(ids.length===0)return[];const placeholders=ids.map(()=>"?").join(",");const rows=db.prepare(`SELECT event_id AS eventId,actor,action,object_id AS object,object_version AS objectVersion,timestamp,authorization_context AS authorizationContext,outcome,provenance_refs_json AS provenanceJson FROM audit_events WHERE object_id IN (${placeholders}) ORDER BY timestamp,event_id`).all(...ids) as Array<Omit<AuditEvent,"provenanceRefs">&{provenanceJson:string}>;return rows.map(r=>{const {provenanceJson,...rest}=r;return {...rest,provenanceRefs:JSON.parse(provenanceJson) as string[]};});}
  };
  return {cases,knowledge,sources,provenance,audit};
}
