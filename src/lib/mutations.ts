import { randomUUID } from "node:crypto";
import { caseSchema,knowledgeObjectSchema,assertPublishable,type AuditEvent } from "./domain";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";
import { sqliteStore as store } from "./store-sqlite";

function audit(actor:ActorContext,action:string,object:string,version:number,provenanceRefs:string[]):AuditEvent{return {eventId:randomUUID(),actor:actor.actorId,action,object,objectVersion:version,timestamp:new Date().toISOString(),authorizationContext:`${actor.authentication}:${actor.role}`,outcome:"ALLOWED",provenanceRefs};}
export function createCase(input:unknown,actor:ActorContext){requireAuthorization(actor.role,"CASE_CREATE");const value=caseSchema.parse(input);store.createCase(value);store.appendAudit(audit(actor,"CASE_CREATE",value.id,1,[]));return value;}
export function createKnowledge(input:unknown,actor:ActorContext){requireAuthorization(actor.role,"KNOWLEDGE_CREATE");const value=assertPublishable(knowledgeObjectSchema.parse(input));if(value.status==="PUBLISHED")requireAuthorization(actor.role,"KNOWLEDGE_PUBLISH");store.createKnowledge(value);store.appendAudit(audit(actor,"KNOWLEDGE_CREATE",value.id,value.version,value.sources.map(s=>s.sourceId)));return value;}
