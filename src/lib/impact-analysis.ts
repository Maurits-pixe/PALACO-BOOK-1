import { createHash,randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { database } from "./sqlite";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";
import type { AuditEvent } from "./domain";
import type { RelationType } from "./knowledge-graph";

export type ImpactCauseKind="SOURCE_REVOKED"|"SOURCE_CHANGED";
export type ImpactTargetType="KNOWLEDGE_VERSION"|"RELATION";
export type ImpactKind="DIRECT_SOURCE"|"GRAPH_PROPAGATION"|"CONTEXT_REVIEW";
export type ImpactSeverity="REVIEW_REQUIRED"|"CONTEXT_REVIEW";

export type ImpactCandidate={
  signalId:string;
  causeKind:ImpactCauseKind;
  causeSourceId:string;
  causeSourceVersion:number;
  targetType:ImpactTargetType;
  targetId:string;
  targetVersion:number;
  impactKind:ImpactKind;
  severity:ImpactSeverity;
  path:string[];
};

export type ImpactReport={
  cause:{kind:ImpactCauseKind;sourceId:string;sourceVersion:number};
  maxDepth:number;
  candidates:ImpactCandidate[];
  automaticStateChanges:false;
};

type NodeRef={knowledgeId:string;version:number};
type QueueItem={node:NodeRef;depth:number;path:string[]};
type RelationRow={
  relationId:string;
  version:number;
  sourceKnowledgeId:string;
  sourceObjectVersion:number;
  targetKnowledgeId:string;
  targetObjectVersion:number;
  relationType:RelationType;
  provenance:string;
  status:string;
};

const inputSchema=z.object({
  causeKind:z.enum(["SOURCE_REVOKED","SOURCE_CHANGED"]),
  source:z.object({id:z.string().min(1),version:z.number().int().positive()}),
  maxDepth:z.number().int().min(0).max(12).default(6)
});

function nodeKey(node:NodeRef){return `${node.knowledgeId}@${node.version}`;}
function sameNode(a:NodeRef,b:NodeRef){return a.knowledgeId===b.knowledgeId&&a.version===b.version;}
function relationToken(row:RelationRow){return `relation:${row.relationId}@${row.version}:${row.relationType}`;}

function signalId(value:Omit<ImpactCandidate,"signalId">){
  const canonical=JSON.stringify([
    value.causeKind,value.causeSourceId,value.causeSourceVersion,
    value.targetType,value.targetId,value.targetVersion,value.impactKind,value.path
  ]);
  return `impact-${createHash("sha256").update(canonical).digest("hex").slice(0,32)}`;
}

function addCandidate(map:Map<string,ImpactCandidate>,value:Omit<ImpactCandidate,"signalId">){
  const candidate={...value,signalId:signalId(value)};
  const key=`${candidate.targetType}:${candidate.targetId}@${candidate.targetVersion}:${candidate.impactKind}`;
  const current=map.get(key);
  if(!current||current.severity==="CONTEXT_REVIEW"&&candidate.severity==="REVIEW_REQUIRED")map.set(key,candidate);
}

function latestRelationsFor(node:NodeRef,db:Database.Database):RelationRow[]{
  return db.prepare(`
    SELECT r.relation_id AS relationId,r.version,
      r.source_knowledge_id AS sourceKnowledgeId,r.source_object_version AS sourceObjectVersion,
      r.target_knowledge_id AS targetKnowledgeId,r.target_object_version AS targetObjectVersion,
      r.relation_type AS relationType,r.provenance_state AS provenance,r.status
    FROM knowledge_relations r
    JOIN (SELECT relation_id,MAX(version) AS version FROM knowledge_relations GROUP BY relation_id) latest
      ON latest.relation_id=r.relation_id AND latest.version=r.version
    WHERE r.status='ACTIVE' AND r.provenance_state<>'REVOKED'
      AND ((r.source_knowledge_id=? AND r.source_object_version=?)
        OR (r.target_knowledge_id=? AND r.target_object_version=?))
    ORDER BY r.relation_id
  `).all(node.knowledgeId,node.version,node.knowledgeId,node.version) as RelationRow[];
}

function dependencyNext(row:RelationRow,current:NodeRef):NodeRef|null{
  const source={knowledgeId:row.sourceKnowledgeId,version:row.sourceObjectVersion};
  const target={knowledgeId:row.targetKnowledgeId,version:row.targetObjectVersion};
  if((row.relationType==="supports"||row.relationType==="explains"||row.relationType==="used_in")&&sameNode(current,source))return target;
  if((row.relationType==="derived_from"||row.relationType==="references")&&sameNode(current,target))return source;
  return null;
}

function contextualOther(row:RelationRow,current:NodeRef):NodeRef|null{
  if(row.relationType!=="contradicts"&&row.relationType!=="related_to")return null;
  const source={knowledgeId:row.sourceKnowledgeId,version:row.sourceObjectVersion};
  const target={knowledgeId:row.targetKnowledgeId,version:row.targetObjectVersion};
  if(sameNode(current,source))return target;
  if(sameNode(current,target))return source;
  return null;
}

export function analyzeImpact(input:unknown,actor:ActorContext,db:Database.Database=database()):ImpactReport{
  requireAuthorization(actor.role,"IMPACT_ANALYZE");
  const parsed=inputSchema.parse(input);
  if(!db.prepare("SELECT 1 FROM sources WHERE id=? AND version=?").get(parsed.source.id,parsed.source.version))throw new Error("SOURCE_VERSION_NOT_FOUND");

  const causeBase={
    causeKind:parsed.causeKind,
    causeSourceId:parsed.source.id,
    causeSourceVersion:parsed.source.version
  } as const;
  const candidates=new Map<string,ImpactCandidate>();
  const seeds=db.prepare(`
    SELECT knowledge_id AS knowledgeId,object_version AS version
    FROM knowledge_version_sources
    WHERE source_id=? AND source_version=?
    ORDER BY knowledge_id,object_version
  `).all(parsed.source.id,parsed.source.version) as NodeRef[];

  const queue:QueueItem[]=[];
  const visited=new Set<string>();
  for(const node of seeds){
    const path=[`source:${parsed.source.id}@${parsed.source.version}`,`knowledge:${nodeKey(node)}`];
    addCandidate(candidates,{...causeBase,targetType:"KNOWLEDGE_VERSION",targetId:node.knowledgeId,targetVersion:node.version,impactKind:"DIRECT_SOURCE",severity:"REVIEW_REQUIRED",path});
    const key=nodeKey(node);
    if(!visited.has(key)){visited.add(key);queue.push({node,depth:0,path});}
  }

  while(queue.length){
    const current=queue.shift()!;
    for(const relation of latestRelationsFor(current.node,db)){
      const relPath=[...current.path,relationToken(relation)];
      const next=dependencyNext(relation,current.node);

      addCandidate(candidates,{
        ...causeBase,targetType:"RELATION",targetId:relation.relationId,targetVersion:relation.version,
        impactKind:next?"GRAPH_PROPAGATION":"CONTEXT_REVIEW",
        severity:next?"REVIEW_REQUIRED":"CONTEXT_REVIEW",path:relPath
      });

      if(next&&current.depth<parsed.maxDepth){
        const nextPath=[...relPath,`knowledge:${nodeKey(next)}`];
        addCandidate(candidates,{...causeBase,targetType:"KNOWLEDGE_VERSION",targetId:next.knowledgeId,targetVersion:next.version,impactKind:"GRAPH_PROPAGATION",severity:"REVIEW_REQUIRED",path:nextPath});
        const key=nodeKey(next);
        if(!visited.has(key)){visited.add(key);queue.push({node:next,depth:current.depth+1,path:nextPath});}
      }

      const contextual=contextualOther(relation,current.node);
      if(contextual){
        const contextPath=[...relPath,`knowledge:${nodeKey(contextual)}`];
        addCandidate(candidates,{...causeBase,targetType:"KNOWLEDGE_VERSION",targetId:contextual.knowledgeId,targetVersion:contextual.version,impactKind:"CONTEXT_REVIEW",severity:"CONTEXT_REVIEW",path:contextPath});
      }
    }
  }

  return {
    cause:{kind:parsed.causeKind,sourceId:parsed.source.id,sourceVersion:parsed.source.version},
    maxDepth:parsed.maxDepth,
    candidates:[...candidates.values()].sort((a,b)=>a.signalId.localeCompare(b.signalId)),
    automaticStateChanges:false
  };
}

function audit(actor:ActorContext,signal:ImpactCandidate):AuditEvent{
  return {
    eventId:randomUUID(),actor:actor.actorId,action:"IMPACT_SIGNAL_CREATE",object:signal.signalId,objectVersion:1,
    timestamp:new Date().toISOString(),authorizationContext:`${actor.authentication}:${actor.role}`,
    outcome:"ALLOWED",provenanceRefs:[`${signal.causeSourceId}@${signal.causeSourceVersion}`]
  };
}

export function recordImpactSignals(input:unknown,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"IMPACT_SIGNAL_WRITE");
  const report=analyzeImpact(input,actor,db);
  const recorded:ImpactCandidate[]=[];

  db.transaction(()=>{
    for(const candidate of report.candidates){
      if(db.prepare("SELECT 1 FROM review_signals WHERE signal_id=? LIMIT 1").get(candidate.signalId))continue;
      db.prepare(`
        INSERT INTO review_signals(signal_id,version,cause_kind,cause_source_id,cause_source_version,target_type,target_id,target_version,impact_kind,severity,path_json,status,created_at,actor,supersedes_version)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(candidate.signalId,1,candidate.causeKind,candidate.causeSourceId,candidate.causeSourceVersion,candidate.targetType,candidate.targetId,candidate.targetVersion,candidate.impactKind,candidate.severity,JSON.stringify(candidate.path),"OPEN",new Date().toISOString(),actor.actorId,null);
      const event=audit(actor,candidate);
      db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(event.eventId,event.actor,event.action,event.object,event.objectVersion,event.timestamp,event.authorizationContext,event.outcome,JSON.stringify(event.provenanceRefs));
      recorded.push(candidate);
    }
  })();

  return {...report,recorded};
}

export function listOpenReviewSignals(db:Database.Database=database()){
  return db.prepare(`
    SELECT s.signal_id AS signalId,s.version,s.cause_kind AS causeKind,s.cause_source_id AS causeSourceId,
      s.cause_source_version AS causeSourceVersion,s.target_type AS targetType,s.target_id AS targetId,
      s.target_version AS targetVersion,s.impact_kind AS impactKind,s.severity,s.path_json AS pathJson,
      s.status,s.created_at AS createdAt,s.actor,s.supersedes_version AS supersedesVersion
    FROM review_signals s
    JOIN (SELECT signal_id,MAX(version) AS version FROM review_signals GROUP BY signal_id) latest
      ON latest.signal_id=s.signal_id AND latest.version=s.version
    WHERE s.status='OPEN'
    ORDER BY s.created_at,s.signal_id
  `).all().map((row:any)=>({...row,path:JSON.parse(row.pathJson),pathJson:undefined}));
}


export type ReviewSignalStatus="OPEN"|"ACKNOWLEDGED"|"RESOLVED";
export type ReviewSignalRecord={
  signalId:string;
  version:number;
  causeKind:ImpactCauseKind;
  causeSourceId:string;
  causeSourceVersion:number;
  targetType:ImpactTargetType;
  targetId:string;
  targetVersion:number;
  impactKind:ImpactKind;
  severity:ImpactSeverity;
  path:string[];
  status:ReviewSignalStatus;
  createdAt:string;
  actor:string;
  supersedesVersion:number|null;
};

function mapReviewSignal(row:any):ReviewSignalRecord{
  return {
    signalId:row.signalId,version:row.version,causeKind:row.causeKind,
    causeSourceId:row.causeSourceId,causeSourceVersion:row.causeSourceVersion,
    targetType:row.targetType,targetId:row.targetId,targetVersion:row.targetVersion,
    impactKind:row.impactKind,severity:row.severity,path:JSON.parse(row.pathJson) as string[],
    status:row.status,createdAt:row.createdAt,actor:row.actor,supersedesVersion:row.supersedesVersion??null
  };
}

export function listReviewSignalHistory(signalId:string,db:Database.Database=database()):ReviewSignalRecord[]{
  return db.prepare(`
    SELECT signal_id AS signalId,version,cause_kind AS causeKind,cause_source_id AS causeSourceId,
      cause_source_version AS causeSourceVersion,target_type AS targetType,target_id AS targetId,
      target_version AS targetVersion,impact_kind AS impactKind,severity,path_json AS pathJson,
      status,created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM review_signals WHERE signal_id=? ORDER BY version
  `).all(signalId).map(mapReviewSignal);
}

export function transitionReviewSignal(signalId:string,status:"ACKNOWLEDGED"|"RESOLVED",actor:ActorContext,db:Database.Database=database()):ReviewSignalRecord{
  requireAuthorization(actor.role,"IMPACT_SIGNAL_WRITE");
  const row=db.prepare(`
    SELECT signal_id AS signalId,version,cause_kind AS causeKind,cause_source_id AS causeSourceId,
      cause_source_version AS causeSourceVersion,target_type AS targetType,target_id AS targetId,
      target_version AS targetVersion,impact_kind AS impactKind,severity,path_json AS pathJson,
      status,created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM review_signals WHERE signal_id=? ORDER BY version DESC LIMIT 1
  `).get(signalId);
  if(!row)throw new Error("REVIEW_SIGNAL_NOT_FOUND");
  const current=mapReviewSignal(row);
  const allowed=current.status==="OPEN"&&status==="ACKNOWLEDGED"||current.status==="ACKNOWLEDGED"&&status==="RESOLVED";
  if(!allowed){
    if(current.status==="RESOLVED")throw new Error("REVIEW_SIGNAL_RESOLVED_TERMINAL");
    throw new Error("REVIEW_SIGNAL_TRANSITION_DENIED");
  }

  const next:ReviewSignalRecord={...current,version:current.version+1,status,createdAt:new Date().toISOString(),actor:actor.actorId,supersedesVersion:current.version};
  return db.transaction(()=>{
    db.prepare(`
      INSERT INTO review_signals(signal_id,version,cause_kind,cause_source_id,cause_source_version,target_type,target_id,target_version,impact_kind,severity,path_json,status,created_at,actor,supersedes_version)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(next.signalId,next.version,next.causeKind,next.causeSourceId,next.causeSourceVersion,next.targetType,next.targetId,next.targetVersion,next.impactKind,next.severity,JSON.stringify(next.path),next.status,next.createdAt,next.actor,next.supersedesVersion);
    const event:AuditEvent={
      eventId:randomUUID(),actor:actor.actorId,
      action:status==="ACKNOWLEDGED"?"IMPACT_SIGNAL_ACKNOWLEDGE":"IMPACT_SIGNAL_RESOLVE",
      object:next.signalId,objectVersion:next.version,timestamp:next.createdAt,
      authorizationContext:`${actor.authentication}:${actor.role}`,outcome:"ALLOWED",
      provenanceRefs:[`${next.causeSourceId}@${next.causeSourceVersion}`]
    };
    db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(event.eventId,event.actor,event.action,event.object,event.objectVersion,event.timestamp,event.authorizationContext,event.outcome,JSON.stringify(event.provenanceRefs));
    return next;
  })();
}
