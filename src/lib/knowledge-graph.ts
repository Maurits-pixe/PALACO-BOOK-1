import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { database } from "./sqlite";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";
import type { AuditEvent } from "./domain";

export const relationTypes=["supports","contradicts","derived_from","related_to","explains","references","used_in"] as const;
export type RelationType=(typeof relationTypes)[number];
export type RelationStatus="ACTIVE"|"REVOKED";
export type RelationProvenance="UNKNOWN"|"PARTIAL"|"TRACEABLE"|"VERIFIED"|"REVOKED";

export type KnowledgeVersionRef={knowledgeId:string;version:number};
export type KnowledgeRelationRecord={
  relationId:string;
  version:number;
  source:KnowledgeVersionRef;
  target:KnowledgeVersionRef;
  relationType:RelationType;
  provenance:RelationProvenance;
  evidenceRefs:string[];
  status:RelationStatus;
  createdAt:string;
  actor:string;
  supersedesVersion:number|null;
};

const endpoint=z.object({knowledgeId:z.string().min(1),version:z.number().int().positive()});
const createSchema=z.object({
  relationId:z.string().min(1),
  source:endpoint,
  target:endpoint,
  relationType:z.enum(relationTypes),
  provenance:z.enum(["UNKNOWN","PARTIAL","TRACEABLE","VERIFIED","REVOKED"]),
  evidenceRefs:z.array(z.string().min(1)).min(1)
});
const evolveSchema=z.object({
  relationId:z.string().min(1),
  provenance:z.enum(["UNKNOWN","PARTIAL","TRACEABLE","VERIFIED","REVOKED"]),
  evidenceRefs:z.array(z.string().min(1)).min(1),
  status:z.enum(["ACTIVE","REVOKED"])
});

function ensureVersion(db:Database.Database,ref:KnowledgeVersionRef){
  const row=db.prepare("SELECT 1 FROM knowledge_versions WHERE knowledge_id=? AND version=?").get(ref.knowledgeId,ref.version);
  if(!row)throw new Error("KNOWLEDGE_VERSION_NOT_FOUND");
}

function mapRow(row:any):KnowledgeRelationRecord{
  return {
    relationId:row.relationId,
    version:row.version,
    source:{knowledgeId:row.sourceKnowledgeId,version:row.sourceObjectVersion},
    target:{knowledgeId:row.targetKnowledgeId,version:row.targetObjectVersion},
    relationType:row.relationType,
    provenance:row.provenance,
    evidenceRefs:JSON.parse(row.evidenceRefsJson) as string[],
    status:row.status,
    createdAt:row.createdAt,
    actor:row.actor,
    supersedesVersion:row.supersedesVersion??null
  };
}

function relationAudit(actor:ActorContext,action:string,relationId:string,version:number,evidenceRefs:string[]):AuditEvent{
  return {
    eventId:randomUUID(),
    actor:actor.actorId,
    action,
    object:relationId,
    objectVersion:version,
    timestamp:new Date().toISOString(),
    authorizationContext:`${actor.authentication}:${actor.role}`,
    outcome:"ALLOWED",
    provenanceRefs:evidenceRefs
  };
}

function appendAudit(db:Database.Database,event:AuditEvent){
  db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(event.eventId,event.actor,event.action,event.object,event.objectVersion,event.timestamp,event.authorizationContext,event.outcome,JSON.stringify(event.provenanceRefs));
}

export function createKnowledgeRelation(input:unknown,actor:ActorContext,db:Database.Database=database()):KnowledgeRelationRecord{
  requireAuthorization(actor.role,"KNOWLEDGE_RELATE");
  const parsed=createSchema.parse(input);
  if(parsed.source.knowledgeId===parsed.target.knowledgeId)throw new Error("SELF_RELATION_DENIED");
  ensureVersion(db,parsed.source);
  ensureVersion(db,parsed.target);
  if(db.prepare("SELECT 1 FROM knowledge_relations WHERE relation_id=? LIMIT 1").get(parsed.relationId))throw new Error("RELATION_EXISTS");

  const value:KnowledgeRelationRecord={
    ...parsed,
    version:1,
    status:"ACTIVE",
    createdAt:new Date().toISOString(),
    actor:actor.actorId,
    supersedesVersion:null
  };

  return db.transaction(()=>{
    db.prepare("INSERT INTO knowledge_relations(relation_id,version,source_knowledge_id,source_object_version,target_knowledge_id,target_object_version,relation_type,provenance_state,evidence_refs_json,status,created_at,actor,supersedes_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(value.relationId,value.version,value.source.knowledgeId,value.source.version,value.target.knowledgeId,value.target.version,value.relationType,value.provenance,JSON.stringify(value.evidenceRefs),value.status,value.createdAt,value.actor,value.supersedesVersion);
    appendAudit(db,relationAudit(actor,"KNOWLEDGE_RELATE",value.relationId,value.version,value.evidenceRefs));
    return value;
  })();
}

export function evolveKnowledgeRelation(input:unknown,actor:ActorContext,db:Database.Database=database()):KnowledgeRelationRecord{
  requireAuthorization(actor.role,"KNOWLEDGE_RELATE");
  const parsed=evolveSchema.parse(input);
  const row=db.prepare("SELECT relation_id AS relationId,version,source_knowledge_id AS sourceKnowledgeId,source_object_version AS sourceObjectVersion,target_knowledge_id AS targetKnowledgeId,target_object_version AS targetObjectVersion,relation_type AS relationType,provenance_state AS provenance,evidence_refs_json AS evidenceRefsJson,status,created_at AS createdAt,actor,supersedes_version AS supersedesVersion FROM knowledge_relations WHERE relation_id=? ORDER BY version DESC LIMIT 1").get(parsed.relationId);
  if(!row)throw new Error("RELATION_NOT_FOUND");
  const current=mapRow(row);
  if(current.status==="REVOKED")throw new Error("RELATION_REVOKED_TERMINAL");

  const value:KnowledgeRelationRecord={
    ...current,
    version:current.version+1,
    provenance:parsed.provenance,
    evidenceRefs:parsed.evidenceRefs,
    status:parsed.status,
    createdAt:new Date().toISOString(),
    actor:actor.actorId,
    supersedesVersion:current.version
  };

  return db.transaction(()=>{
    db.prepare("INSERT INTO knowledge_relations(relation_id,version,source_knowledge_id,source_object_version,target_knowledge_id,target_object_version,relation_type,provenance_state,evidence_refs_json,status,created_at,actor,supersedes_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(value.relationId,value.version,value.source.knowledgeId,value.source.version,value.target.knowledgeId,value.target.version,value.relationType,value.provenance,JSON.stringify(value.evidenceRefs),value.status,value.createdAt,value.actor,value.supersedesVersion);
    appendAudit(db,relationAudit(actor,value.status==="REVOKED"?"KNOWLEDGE_RELATION_REVOKE":"KNOWLEDGE_RELATION_EVOLVE",value.relationId,value.version,value.evidenceRefs));
    return value;
  })();
}

export function listKnowledgeRelations(knowledgeId:string,db:Database.Database=database()):KnowledgeRelationRecord[]{
  const rows=db.prepare(`
    SELECT r.relation_id AS relationId,r.version,
      r.source_knowledge_id AS sourceKnowledgeId,r.source_object_version AS sourceObjectVersion,
      r.target_knowledge_id AS targetKnowledgeId,r.target_object_version AS targetObjectVersion,
      r.relation_type AS relationType,r.provenance_state AS provenance,
      r.evidence_refs_json AS evidenceRefsJson,r.status,r.created_at AS createdAt,r.actor,
      r.supersedes_version AS supersedesVersion
    FROM knowledge_relations r
    JOIN (SELECT relation_id,MAX(version) AS version FROM knowledge_relations GROUP BY relation_id) latest
      ON latest.relation_id=r.relation_id AND latest.version=r.version
    WHERE r.source_knowledge_id=? OR r.target_knowledge_id=?
    ORDER BY r.created_at,r.relation_id
  `).all(knowledgeId,knowledgeId);
  return rows.map(mapRow);
}

export function listKnowledgeRelationHistory(relationId:string,db:Database.Database=database()):KnowledgeRelationRecord[]{
  return db.prepare("SELECT relation_id AS relationId,version,source_knowledge_id AS sourceKnowledgeId,source_object_version AS sourceObjectVersion,target_knowledge_id AS targetKnowledgeId,target_object_version AS targetObjectVersion,relation_type AS relationType,provenance_state AS provenance,evidence_refs_json AS evidenceRefsJson,status,created_at AS createdAt,actor,supersedes_version AS supersedesVersion FROM knowledge_relations WHERE relation_id=? ORDER BY version")
    .all(relationId).map(mapRow);
}
