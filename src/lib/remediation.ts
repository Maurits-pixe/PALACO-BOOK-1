import { createHash,randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { database } from "./sqlite";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";
import type { AuditEvent } from "./domain";

export type RemediationTargetType="KNOWLEDGE_VERSION"|"RELATION";
export type RemediationWorkStatus="OPEN"|"CLAIMED"|"PROPOSED"|"DECIDED";
export type RemediationProposalType="KNOWLEDGE_EVOLUTION"|"RELATION_EVOLUTION"|"RELATION_REVOKE"|"NO_CHANGE"|"ESCALATE";
export type RemediationProposalStatus="PROPOSED"|"ACCEPTED"|"REJECTED";

export type RemediationWorkItem={
  workId:string;
  version:number;
  signalId:string;
  signalVersion:number;
  targetType:RemediationTargetType;
  targetId:string;
  targetVersion:number;
  status:RemediationWorkStatus;
  assignee:string|null;
  createdAt:string;
  actor:string;
  supersedesVersion:number|null;
};

export type RemediationProposal={
  proposalId:string;
  version:number;
  workId:string;
  workVersion:number;
  proposalType:RemediationProposalType;
  targetType:RemediationTargetType;
  targetId:string;
  baseVersion:number;
  payload:Record<string,unknown>;
  rationale:string;
  status:RemediationProposalStatus;
  decisionNote:string|null;
  createdAt:string;
  actor:string;
  supersedesVersion:number|null;
};

type ReviewSignalRow={
  signalId:string;
  version:number;
  targetType:RemediationTargetType;
  targetId:string;
  targetVersion:number;
  status:"OPEN"|"ACKNOWLEDGED"|"RESOLVED";
};

const proposalSchema=z.object({
  proposalType:z.enum(["KNOWLEDGE_EVOLUTION","RELATION_EVOLUTION","RELATION_REVOKE","NO_CHANGE","ESCALATE"]),
  payload:z.record(z.string(),z.unknown()).default({}),
  rationale:z.string().min(1)
});
const decisionSchema=z.object({
  decision:z.enum(["ACCEPTED","REJECTED"]),
  note:z.string().min(1)
});

function deterministicWorkId(signalId:string){
  return `work-${createHash("sha256").update(signalId).digest("hex").slice(0,32)}`;
}

function mapWork(row:any):RemediationWorkItem{
  return {
    workId:row.workId,version:row.version,signalId:row.signalId,signalVersion:row.signalVersion,
    targetType:row.targetType,targetId:row.targetId,targetVersion:row.targetVersion,status:row.status,
    assignee:row.assignee??null,createdAt:row.createdAt,actor:row.actor,supersedesVersion:row.supersedesVersion??null
  };
}

function mapProposal(row:any):RemediationProposal{
  return {
    proposalId:row.proposalId,version:row.version,workId:row.workId,workVersion:row.workVersion,
    proposalType:row.proposalType,targetType:row.targetType,targetId:row.targetId,baseVersion:row.baseVersion,
    payload:JSON.parse(row.payloadJson) as Record<string,unknown>,rationale:row.rationale,status:row.status,
    decisionNote:row.decisionNote??null,createdAt:row.createdAt,actor:row.actor,supersedesVersion:row.supersedesVersion??null
  };
}

function latestSignal(signalId:string,db:Database.Database):ReviewSignalRow|undefined{
  return db.prepare(`
    SELECT signal_id AS signalId,version,target_type AS targetType,target_id AS targetId,target_version AS targetVersion,status
    FROM review_signals WHERE signal_id=? ORDER BY version DESC LIMIT 1
  `).get(signalId) as ReviewSignalRow|undefined;
}

function latestWork(workId:string,db:Database.Database):RemediationWorkItem|undefined{
  const row=db.prepare(`
    SELECT work_id AS workId,version,signal_id AS signalId,signal_version AS signalVersion,
      target_type AS targetType,target_id AS targetId,target_version AS targetVersion,status,assignee,
      created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM remediation_work_items WHERE work_id=? ORDER BY version DESC LIMIT 1
  `).get(workId);
  return row?mapWork(row):undefined;
}

function latestProposal(proposalId:string,db:Database.Database):RemediationProposal|undefined{
  const row=db.prepare(`
    SELECT proposal_id AS proposalId,version,work_id AS workId,work_version AS workVersion,
      proposal_type AS proposalType,target_type AS targetType,target_id AS targetId,base_version AS baseVersion,
      payload_json AS payloadJson,rationale,status,decision_note AS decisionNote,
      created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM remediation_proposals WHERE proposal_id=? ORDER BY version DESC LIMIT 1
  `).get(proposalId);
  return row?mapProposal(row):undefined;
}

function insertWork(db:Database.Database,value:RemediationWorkItem){
  db.prepare(`
    INSERT INTO remediation_work_items(
      work_id,version,signal_id,signal_version,target_type,target_id,target_version,status,assignee,created_at,actor,supersedes_version
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(value.workId,value.version,value.signalId,value.signalVersion,value.targetType,value.targetId,value.targetVersion,value.status,value.assignee,value.createdAt,value.actor,value.supersedesVersion);
}

function insertProposal(db:Database.Database,value:RemediationProposal){
  db.prepare(`
    INSERT INTO remediation_proposals(
      proposal_id,version,work_id,work_version,proposal_type,target_type,target_id,base_version,payload_json,rationale,status,decision_note,created_at,actor,supersedes_version
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(value.proposalId,value.version,value.workId,value.workVersion,value.proposalType,value.targetType,value.targetId,value.baseVersion,JSON.stringify(value.payload),value.rationale,value.status,value.decisionNote,value.createdAt,value.actor,value.supersedesVersion);
}

function appendAudit(db:Database.Database,event:AuditEvent){
  db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(event.eventId,event.actor,event.action,event.object,event.objectVersion,event.timestamp,event.authorizationContext,event.outcome,JSON.stringify(event.provenanceRefs));
}

function audit(actor:ActorContext,action:string,object:string,version:number,refs:string[]):AuditEvent{
  return {
    eventId:randomUUID(),actor:actor.actorId,action,object,objectVersion:version,
    timestamp:new Date().toISOString(),authorizationContext:`${actor.authentication}:${actor.role}`,
    outcome:"ALLOWED",provenanceRefs:refs
  };
}

function ensureSignalActive(signalId:string,db:Database.Database){
  const signal=latestSignal(signalId,db);
  if(!signal)throw new Error("REVIEW_SIGNAL_NOT_FOUND");
  if(signal.status==="RESOLVED")throw new Error("REVIEW_SIGNAL_RESOLVED");
  return signal;
}

function proposalAllowed(targetType:RemediationTargetType,proposalType:RemediationProposalType){
  if(proposalType==="NO_CHANGE"||proposalType==="ESCALATE")return true;
  if(targetType==="KNOWLEDGE_VERSION")return proposalType==="KNOWLEDGE_EVOLUTION";
  return proposalType==="RELATION_EVOLUTION"||proposalType==="RELATION_REVOKE";
}

export function materializeRemediationWork(signalId:string,actor:ActorContext,db:Database.Database=database()):RemediationWorkItem{
  requireAuthorization(actor.role,"REMEDIATION_WORK_WRITE");
  const signal=ensureSignalActive(signalId,db);
  const workId=deterministicWorkId(signalId);
  const existing=latestWork(workId,db);
  if(existing)return existing;

  const value:RemediationWorkItem={
    workId,version:1,signalId:signal.signalId,signalVersion:signal.version,
    targetType:signal.targetType,targetId:signal.targetId,targetVersion:signal.targetVersion,
    status:"OPEN",assignee:null,createdAt:new Date().toISOString(),actor:actor.actorId,supersedesVersion:null
  };
  return db.transaction(()=>{
    insertWork(db,value);
    appendAudit(db,audit(actor,"REMEDIATION_WORK_CREATE",value.workId,value.version,[`${signal.signalId}@${signal.version}`]));
    return value;
  })();
}

export function claimRemediationWork(workId:string,actor:ActorContext,db:Database.Database=database()):RemediationWorkItem{
  requireAuthorization(actor.role,"REMEDIATION_WORK_WRITE");
  const current=latestWork(workId,db);
  if(!current)throw new Error("REMEDIATION_WORK_NOT_FOUND");
  ensureSignalActive(current.signalId,db);
  if(current.status!=="OPEN")throw new Error("REMEDIATION_WORK_NOT_OPEN");

  const next:RemediationWorkItem={...current,version:current.version+1,status:"CLAIMED",assignee:actor.actorId,createdAt:new Date().toISOString(),actor:actor.actorId,supersedesVersion:current.version};
  return db.transaction(()=>{
    insertWork(db,next);
    appendAudit(db,audit(actor,"REMEDIATION_WORK_CLAIM",next.workId,next.version,[`${next.signalId}@${next.signalVersion}`]));
    return next;
  })();
}

export function submitRemediationProposal(workId:string,input:unknown,actor:ActorContext,db:Database.Database=database()):RemediationProposal{
  requireAuthorization(actor.role,"REMEDIATION_PROPOSE");
  const parsed=proposalSchema.parse(input);
  const current=latestWork(workId,db);
  if(!current)throw new Error("REMEDIATION_WORK_NOT_FOUND");
  ensureSignalActive(current.signalId,db);
  if(current.status!=="CLAIMED")throw new Error("REMEDIATION_WORK_NOT_CLAIMED");
  if(current.assignee!==actor.actorId)throw new Error("REMEDIATION_ASSIGNEE_MISMATCH");
  if(!proposalAllowed(current.targetType,parsed.proposalType))throw new Error("REMEDIATION_PROPOSAL_TARGET_MISMATCH");

  const proposal:RemediationProposal={
    proposalId:randomUUID(),version:1,workId:current.workId,workVersion:current.version,
    proposalType:parsed.proposalType,targetType:current.targetType,targetId:current.targetId,baseVersion:current.targetVersion,
    payload:parsed.payload,rationale:parsed.rationale,status:"PROPOSED",decisionNote:null,
    createdAt:new Date().toISOString(),actor:actor.actorId,supersedesVersion:null
  };
  const work:RemediationWorkItem={...current,version:current.version+1,status:"PROPOSED",createdAt:new Date().toISOString(),actor:actor.actorId,supersedesVersion:current.version};

  return db.transaction(()=>{
    insertProposal(db,proposal);
    insertWork(db,work);
    appendAudit(db,audit(actor,"REMEDIATION_PROPOSE",proposal.proposalId,proposal.version,[work.workId,`${work.signalId}@${work.signalVersion}`]));
    return proposal;
  })();
}

export function decideRemediationProposal(proposalId:string,input:unknown,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"REMEDIATION_DECIDE");
  const parsed=decisionSchema.parse(input);
  const current=latestProposal(proposalId,db);
  if(!current)throw new Error("REMEDIATION_PROPOSAL_NOT_FOUND");
  if(current.status!=="PROPOSED")throw new Error("REMEDIATION_PROPOSAL_ALREADY_DECIDED");
  if(current.actor===actor.actorId)throw new Error("REMEDIATION_SEPARATION_OF_DUTIES");
  const work=latestWork(current.workId,db);
  if(!work)throw new Error("REMEDIATION_WORK_NOT_FOUND");
  ensureSignalActive(work.signalId,db);
  if(work.status!=="PROPOSED")throw new Error("REMEDIATION_WORK_NOT_PROPOSED");

  const proposal:RemediationProposal={
    ...current,version:current.version+1,workVersion:work.version,status:parsed.decision,decisionNote:parsed.note,
    createdAt:new Date().toISOString(),actor:actor.actorId,supersedesVersion:current.version
  };
  const decidedWork:RemediationWorkItem={
    ...work,version:work.version+1,status:"DECIDED",createdAt:new Date().toISOString(),
    actor:actor.actorId,supersedesVersion:work.version
  };

  return db.transaction(()=>{
    insertProposal(db,proposal);
    insertWork(db,decidedWork);
    appendAudit(db,audit(actor,parsed.decision==="ACCEPTED"?"REMEDIATION_DECIDE_ACCEPT":"REMEDIATION_DECIDE_REJECT",proposal.proposalId,proposal.version,[decidedWork.workId,`${decidedWork.signalId}@${decidedWork.signalVersion}`]));
    return {proposal,work:decidedWork,executionPerformed:false as const};
  })();
}

export function listRemediationQueue(db:Database.Database=database()):RemediationWorkItem[]{
  return db.prepare(`
    SELECT w.work_id AS workId,w.version,w.signal_id AS signalId,w.signal_version AS signalVersion,
      w.target_type AS targetType,w.target_id AS targetId,w.target_version AS targetVersion,w.status,w.assignee,
      w.created_at AS createdAt,w.actor,w.supersedes_version AS supersedesVersion
    FROM remediation_work_items w
    JOIN (SELECT work_id,MAX(version) AS version FROM remediation_work_items GROUP BY work_id) latest
      ON latest.work_id=w.work_id AND latest.version=w.version
    ORDER BY w.created_at,w.work_id
  `).all().map(mapWork);
}

export function listRemediationWorkHistory(workId:string,db:Database.Database=database()):RemediationWorkItem[]{
  return db.prepare(`
    SELECT work_id AS workId,version,signal_id AS signalId,signal_version AS signalVersion,
      target_type AS targetType,target_id AS targetId,target_version AS targetVersion,status,assignee,
      created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM remediation_work_items WHERE work_id=? ORDER BY version
  `).all(workId).map(mapWork);
}

export function listRemediationProposalHistory(proposalId:string,db:Database.Database=database()):RemediationProposal[]{
  return db.prepare(`
    SELECT proposal_id AS proposalId,version,work_id AS workId,work_version AS workVersion,
      proposal_type AS proposalType,target_type AS targetType,target_id AS targetId,base_version AS baseVersion,
      payload_json AS payloadJson,rationale,status,decision_note AS decisionNote,
      created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM remediation_proposals WHERE proposal_id=? ORDER BY version
  `).all(proposalId).map(mapProposal);
}
