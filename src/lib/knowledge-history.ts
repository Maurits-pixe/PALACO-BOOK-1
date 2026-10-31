import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { knowledgeObjectSchema,assertPublishable,type AuditEvent,type KnowledgeObject } from "./domain";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";
import { database } from "./sqlite";

export type KnowledgeVersionRecord=KnowledgeObject&{
  recordedAt:string;
  recordedBy:string;
  supersedesVersion:number|null;
};

function currentKnowledge(id:string,db:Database.Database):KnowledgeObject|undefined{
  const row=db.prepare("SELECT id,case_id AS caseId,title,content,status,version,created_at AS createdAt FROM knowledge_objects WHERE id=?").get(id) as Omit<KnowledgeObject,"sources">|undefined;
  if(!row)return undefined;
  const sources=db.prepare("SELECT source_id AS sourceId,source_version AS version,provenance_state AS provenance FROM source_refs WHERE knowledge_id=? ORDER BY source_id,source_version").all(id) as KnowledgeObject["sources"];
  return {...row,sources};
}

function evolutionAudit(actor:ActorContext,value:KnowledgeObject):AuditEvent{
  return {
    eventId:randomUUID(),
    actor:actor.actorId,
    action:"KNOWLEDGE_EVOLVE",
    object:value.id,
    objectVersion:value.version,
    timestamp:new Date().toISOString(),
    authorizationContext:`${actor.authentication}:${actor.role}`,
    outcome:"ALLOWED",
    provenanceRefs:value.sources.map(source=>source.sourceId)
  };
}

export function evolveKnowledge(input:unknown,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"KNOWLEDGE_EVOLVE");
  const next=assertPublishable(knowledgeObjectSchema.parse(input));
  if(next.status==="PUBLISHED")requireAuthorization(actor.role,"KNOWLEDGE_PUBLISH");

  const current=currentKnowledge(next.id,db);
  if(!current)throw new Error("KNOWLEDGE_NOT_FOUND");
  if(current.caseId!==next.caseId)throw new Error("KNOWLEDGE_CASE_IMMUTABLE");
  if(next.version!==current.version+1)throw new Error("KNOWLEDGE_VERSION_NOT_NEXT");

  return db.transaction(()=>{
    db.prepare("UPDATE knowledge_objects SET title=?,content=?,status=?,version=?,created_at=? WHERE id=?")
      .run(next.title,next.content,next.status,next.version,next.createdAt,next.id);

    db.prepare("DELETE FROM source_refs WHERE knowledge_id=?").run(next.id);
    const sourceInsert=db.prepare("INSERT INTO source_refs(knowledge_id,source_id,source_version,provenance_state) VALUES(?,?,?,?)");
    for(const source of next.sources){
      sourceInsert.run(next.id,source.sourceId,source.version,source.provenance);
    }

    const audit=evolutionAudit(actor,next);
    db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(audit.eventId,audit.actor,audit.action,audit.object,audit.objectVersion,audit.timestamp,audit.authorizationContext,audit.outcome,JSON.stringify(audit.provenanceRefs));
    return next;
  })();
}

export function listKnowledgeVersions(id:string,db:Database.Database=database()):KnowledgeVersionRecord[]{
  const rows=db.prepare("SELECT knowledge_id AS id,case_id AS caseId,title,content,status,version,created_at AS createdAt,recorded_at AS recordedAt,actor AS recordedBy,supersedes_version AS supersedesVersion FROM knowledge_versions WHERE knowledge_id=? ORDER BY version").all(id) as Array<Omit<KnowledgeVersionRecord,"sources">>;
  const sourceQuery=db.prepare("SELECT source_id AS sourceId,source_version AS version,provenance_state AS provenance FROM knowledge_version_sources WHERE knowledge_id=? AND object_version=? ORDER BY source_id,source_version");
  return rows.map(row=>({...row,sources:sourceQuery.all(id,row.version) as KnowledgeObject["sources"]}));
}
