import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { database } from "./sqlite";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";
import type { AuditEvent } from "./domain";

export type SourceStateStatus="ACTIVE"|"SUPERSEDED"|"REVOKED";

export type SourceStateRecord={
  sourceId:string;
  sourceVersion:number;
  stateVersion:number;
  status:SourceStateStatus;
  replacementSourceVersion:number|null;
  reason:string;
  createdAt:string;
  actor:string;
  supersedesStateVersion:number|null;
};

const sourceVersionSchema=z.object({
  id:z.string().min(1),
  version:z.number().int().positive(),
  uri:z.string().min(1),
  title:z.string().min(1),
  checksum:z.string().min(1),
  createdAt:z.string().datetime()
});

const transitionSchema=z.object({
  sourceId:z.string().min(1),
  sourceVersion:z.number().int().positive(),
  status:z.enum(["SUPERSEDED","REVOKED"]),
  replacementSourceVersion:z.number().int().positive().optional(),
  reason:z.string().min(1)
});

function mapState(row:any):SourceStateRecord{
  return {
    sourceId:row.sourceId,sourceVersion:row.sourceVersion,stateVersion:row.stateVersion,
    status:row.status,replacementSourceVersion:row.replacementSourceVersion??null,
    reason:row.reason,createdAt:row.createdAt,actor:row.actor,
    supersedesStateVersion:row.supersedesStateVersion??null
  };
}

function appendAudit(db:Database.Database,event:AuditEvent){
  db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(event.eventId,event.actor,event.action,event.object,event.objectVersion,event.timestamp,event.authorizationContext,event.outcome,JSON.stringify(event.provenanceRefs));
}

export function registerSourceVersion(input:unknown,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"SOURCE_REGISTER");
  const value=sourceVersionSchema.parse(input);
  const latest=db.prepare("SELECT MAX(version) AS version FROM sources WHERE id=?").get(value.id) as {version:number|null};
  const expected=(latest.version??0)+1;
  if(value.version!==expected)throw new Error("SOURCE_VERSION_NOT_NEXT");

  return db.transaction(()=>{
    db.prepare("INSERT INTO sources(id,version,uri,title,checksum,created_at) VALUES(?,?,?,?,?,?)")
      .run(value.id,value.version,value.uri,value.title,value.checksum,value.createdAt);
    const event:AuditEvent={
      eventId:randomUUID(),actor:actor.actorId,action:"SOURCE_REGISTER",
      object:`${value.id}@${value.version}`,objectVersion:value.version,timestamp:new Date().toISOString(),
      authorizationContext:`${actor.authentication}:${actor.role}`,outcome:"ALLOWED",
      provenanceRefs:[value.checksum]
    };
    appendAudit(db,event);
    return value;
  })();
}

export function getLatestSourceState(sourceId:string,sourceVersion:number,db:Database.Database=database()):SourceStateRecord|undefined{
  const row=db.prepare(`
    SELECT source_id AS sourceId,source_version AS sourceVersion,state_version AS stateVersion,
      status,replacement_source_version AS replacementSourceVersion,reason,created_at AS createdAt,
      actor,supersedes_state_version AS supersedesStateVersion
    FROM source_states
    WHERE source_id=? AND source_version=?
    ORDER BY state_version DESC LIMIT 1
  `).get(sourceId,sourceVersion);
  return row?mapState(row):undefined;
}

export function listSourceStateHistory(sourceId:string,sourceVersion:number,db:Database.Database=database()):SourceStateRecord[]{
  return db.prepare(`
    SELECT source_id AS sourceId,source_version AS sourceVersion,state_version AS stateVersion,
      status,replacement_source_version AS replacementSourceVersion,reason,created_at AS createdAt,
      actor,supersedes_state_version AS supersedesStateVersion
    FROM source_states
    WHERE source_id=? AND source_version=?
    ORDER BY state_version
  `).all(sourceId,sourceVersion).map(mapState);
}

export function transitionSourceState(input:unknown,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"SOURCE_STATE_WRITE");
  const parsed=transitionSchema.parse(input);
  if(!db.prepare("SELECT 1 FROM sources WHERE id=? AND version=?").get(parsed.sourceId,parsed.sourceVersion))throw new Error("SOURCE_VERSION_NOT_FOUND");

  const current=getLatestSourceState(parsed.sourceId,parsed.sourceVersion,db);
  if(!current)throw new Error("SOURCE_STATE_NOT_FOUND");
  if(current.status!=="ACTIVE")throw new Error("SOURCE_STATE_TERMINAL");

  if(parsed.status==="SUPERSEDED"){
    if(parsed.replacementSourceVersion===undefined)throw new Error("REPLACEMENT_SOURCE_VERSION_REQUIRED");
    if(parsed.replacementSourceVersion<=parsed.sourceVersion)throw new Error("REPLACEMENT_SOURCE_VERSION_INVALID");
    if(!db.prepare("SELECT 1 FROM sources WHERE id=? AND version=?").get(parsed.sourceId,parsed.replacementSourceVersion))throw new Error("REPLACEMENT_SOURCE_VERSION_NOT_FOUND");
  }else if(parsed.replacementSourceVersion!==undefined){
    throw new Error("REVOKED_SOURCE_CANNOT_DECLARE_REPLACEMENT");
  }

  const next:SourceStateRecord={
    sourceId:parsed.sourceId,sourceVersion:parsed.sourceVersion,stateVersion:current.stateVersion+1,
    status:parsed.status,replacementSourceVersion:parsed.replacementSourceVersion??null,
    reason:parsed.reason,createdAt:new Date().toISOString(),actor:actor.actorId,
    supersedesStateVersion:current.stateVersion
  };

  return db.transaction(()=>{
    db.prepare(`
      INSERT INTO source_states(source_id,source_version,state_version,status,replacement_source_version,reason,created_at,actor,supersedes_state_version)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(next.sourceId,next.sourceVersion,next.stateVersion,next.status,next.replacementSourceVersion,next.reason,next.createdAt,next.actor,next.supersedesStateVersion);

    const action=next.status==="REVOKED"?"SOURCE_REVOKE":"SOURCE_SUPERSEDE";
    const event:AuditEvent={
      eventId:randomUUID(),actor:actor.actorId,action,object:`${next.sourceId}@${next.sourceVersion}`,
      objectVersion:next.stateVersion,timestamp:next.createdAt,
      authorizationContext:`${actor.authentication}:${actor.role}`,outcome:"ALLOWED",
      provenanceRefs:next.replacementSourceVersion?[`${next.sourceId}@${next.replacementSourceVersion}`]:[]
    };
    appendAudit(db,event);

    return {
      state:next,
      impactCause:{
        causeKind:next.status==="REVOKED"?"SOURCE_REVOKED" as const:"SOURCE_CHANGED" as const,
        source:{id:next.sourceId,version:next.sourceVersion}
      },
      automaticImpact:false as const
    };
  })();
}
