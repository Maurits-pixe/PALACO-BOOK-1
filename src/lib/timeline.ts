import type Database from "better-sqlite3";
import { database } from "./sqlite";
import { sqliteRepositories } from "./sqlite-repositories";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";

export function buildCaseTimeline(caseId:string,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"AUDIT_READ");
  const repos=sqliteRepositories(db);
  const caseRecord=repos.cases.get(caseId);
  if(!caseRecord)return null;
  const knowledge=repos.knowledge.listByCase(caseId);
  const provenance=knowledge.flatMap(k=>repos.provenance.listByKnowledge(k.id));
  const sources=provenance.map(p=>repos.sources.get(p.sourceId,p.sourceVersion)).filter(Boolean);
  const objectIds=[caseId,...knowledge.map(k=>k.id),...sources.map(s=>s!.id),...provenance.map(p=>p.id)];
  const audit=repos.audit.listForObjects([...new Set(objectIds)]);
  return {
    case:caseRecord,
    knowledge,
    sources,
    provenance,
    timeline:audit.map(e=>({actor:e.actor,action:e.action,object:e.object,version:e.objectVersion,timestamp:e.timestamp,authorizationContext:e.authorizationContext,provenanceRefs:e.provenanceRefs,outcome:e.outcome}))
  };
}
