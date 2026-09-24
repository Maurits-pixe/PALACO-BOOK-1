import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { database } from "./sqlite";
import { sqliteRepositories } from "./sqlite-repositories";
import { caseSchema,knowledgeObjectSchema,assertPublishable,type AuditEvent } from "./domain";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";

const sourceSchema=z.object({id:z.string().min(1),uri:z.string().min(1),title:z.string().min(1),version:z.number().int().positive(),checksum:z.string().min(1),createdAt:z.string().datetime()});
const provenanceSchema=z.object({id:z.string().min(1),status:z.enum(["UNKNOWN","PARTIAL","TRACEABLE","VERIFIED","REVOKED"]),createdAt:z.string().datetime()});
const inputSchema=z.object({case:caseSchema,knowledge:knowledgeObjectSchema,source:sourceSchema,provenance:provenanceSchema});

function event(actor:ActorContext,action:string,object:string,version:number,refs:string[]):AuditEvent{return {eventId:randomUUID(),actor:actor.actorId,action,object,objectVersion:version,timestamp:new Date().toISOString(),authorizationContext:`${actor.authentication}:${actor.role}`,outcome:"ALLOWED",provenanceRefs:refs};}

export function createCaseKnowledgeTransaction(input:unknown,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"CASE_CREATE");
  requireAuthorization(actor.role,"KNOWLEDGE_CREATE");
  const parsed=inputSchema.parse(input);
  if(parsed.knowledge.caseId!==parsed.case.id)throw new Error("CASE_KNOWLEDGE_MISMATCH");
  if(parsed.knowledge.sources.length!==1)throw new Error("SINGLE_SOURCE_SLICE_REQUIRED");
  const ref=parsed.knowledge.sources[0];
  if(ref.sourceId!==parsed.source.id||ref.version!==parsed.source.version||ref.provenance!==parsed.provenance.status)throw new Error("PROVENANCE_REFERENCE_MISMATCH");
  assertPublishable(parsed.knowledge);
  if(parsed.knowledge.status==="PUBLISHED")requireAuthorization(actor.role,"KNOWLEDGE_PUBLISH");
  const repos=sqliteRepositories(db);
  return db.transaction(()=>{
    repos.cases.insert(parsed.case);
    repos.sources.insert(parsed.source);
    repos.knowledge.insert(parsed.knowledge);
    repos.provenance.insert({...parsed.provenance,knowledgeId:parsed.knowledge.id,sourceId:parsed.source.id,sourceVersion:parsed.source.version});
    repos.audit.append(event(actor,"CASE_CREATE",parsed.case.id,1,[]));
    repos.audit.append(event(actor,"SOURCE_ATTACH",parsed.source.id,parsed.source.version,[parsed.source.id]));
    repos.audit.append(event(actor,"KNOWLEDGE_CREATE",parsed.knowledge.id,parsed.knowledge.version,[parsed.source.id]));
    repos.audit.append(event(actor,"PROVENANCE_WRITE",parsed.provenance.id,1,[parsed.source.id]));
    return {caseId:parsed.case.id,knowledgeId:parsed.knowledge.id,sourceId:parsed.source.id,provenanceId:parsed.provenance.id};
  })();
}
