import { createHash,randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { database } from "./sqlite";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";
import { assertPublishable,knowledgeObjectSchema,type AuditEvent } from "./domain";
import { getLatestSourceState } from "./source-ledger";

export type ExecutionOperation="KNOWLEDGE_EVOLUTION"|"RELATION_EVOLUTION"|"RELATION_REVOKE";
export type ExecutionEnvelopeStatus="PREPARED"|"AUTHORIZED"|"CANCELLED"|"CONSUMED";

export type ExecutionEnvelope={
  envelopeId:string;
  version:number;
  proposalId:string;
  proposalVersion:number;
  operationType:ExecutionOperation;
  targetType:"KNOWLEDGE_VERSION"|"RELATION";
  targetId:string;
  baseVersion:number;
  payload:Record<string,unknown>;
  payloadHash:string;
  status:ExecutionEnvelopeStatus;
  authorizedAt:string|null;
  expiresAt:string|null;
  createdAt:string;
  actor:string;
  supersedesVersion:number|null;
};

type ProposalRow={
  proposalId:string;
  version:number;
  workId:string;
  workVersion:number;
  proposalType:string;
  targetType:"KNOWLEDGE_VERSION"|"RELATION";
  targetId:string;
  baseVersion:number;
  payloadJson:string;
  status:string;
};

type WorkRow={workId:string;status:string;signalId:string};
type SignalRow={signalId:string;status:string};

const relationPayload=z.object({
  provenance:z.enum(["UNKNOWN","PARTIAL","TRACEABLE","VERIFIED","REVOKED"]),
  evidenceRefs:z.array(z.string().min(1)).min(1),
  status:z.enum(["ACTIVE","REVOKED"])
});
const authorizationSchema=z.object({validForSeconds:z.number().int().min(60).max(3600).default(900)});

function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  const object=value as Record<string,unknown>;
  return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function payloadHash(payload:Record<string,unknown>){
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function mapEnvelope(row:any):ExecutionEnvelope{
  return {
    envelopeId:row.envelopeId,version:row.version,proposalId:row.proposalId,proposalVersion:row.proposalVersion,
    operationType:row.operationType,targetType:row.targetType,targetId:row.targetId,baseVersion:row.baseVersion,
    payload:JSON.parse(row.payloadJson) as Record<string,unknown>,payloadHash:row.payloadHash,status:row.status,
    authorizedAt:row.authorizedAt??null,expiresAt:row.expiresAt??null,createdAt:row.createdAt,actor:row.actor,
    supersedesVersion:row.supersedesVersion??null
  };
}

function latestAcceptedProposal(proposalId:string,db:Database.Database):ProposalRow{
  const row=db.prepare(`
    SELECT proposal_id AS proposalId,version,work_id AS workId,work_version AS workVersion,
      proposal_type AS proposalType,target_type AS targetType,target_id AS targetId,base_version AS baseVersion,
      payload_json AS payloadJson,status
    FROM remediation_proposals WHERE proposal_id=? ORDER BY version DESC LIMIT 1
  `).get(proposalId) as ProposalRow|undefined;
  if(!row)throw new Error("REMEDIATION_PROPOSAL_NOT_FOUND");
  if(row.status!=="ACCEPTED")throw new Error("REMEDIATION_PROPOSAL_NOT_ACCEPTED");
  if(row.proposalType==="NO_CHANGE"||row.proposalType==="ESCALATE")throw new Error("REMEDIATION_PROPOSAL_NOT_EXECUTABLE");
  return row;
}

function ensureDecisionAndSignalActive(proposal:ProposalRow,db:Database.Database){
  const work=db.prepare(`
    SELECT work_id AS workId,status,signal_id AS signalId
    FROM remediation_work_items WHERE work_id=? ORDER BY version DESC LIMIT 1
  `).get(proposal.workId) as WorkRow|undefined;
  if(!work||work.status!=="DECIDED")throw new Error("REMEDIATION_WORK_NOT_DECIDED");
  const signal=db.prepare("SELECT signal_id AS signalId,status FROM review_signals WHERE signal_id=? ORDER BY version DESC LIMIT 1")
    .get(work.signalId) as SignalRow|undefined;
  if(!signal)throw new Error("REVIEW_SIGNAL_NOT_FOUND");
  if(signal.status==="RESOLVED")throw new Error("REVIEW_SIGNAL_RESOLVED");
  return {work,signal};
}

function ensureKnowledgePreflight(proposal:ProposalRow,payload:Record<string,unknown>,db:Database.Database){
  const row=db.prepare("SELECT id,case_id AS caseId,version FROM knowledge_objects WHERE id=?").get(proposal.targetId) as {id:string;caseId:string;version:number}|undefined;
  if(!row)throw new Error("KNOWLEDGE_NOT_FOUND");
  if(row.version!==proposal.baseVersion)throw new Error("EXECUTION_TARGET_STALE");
  const nextRaw=(payload as {next?:unknown}).next;
  if(nextRaw===undefined)throw new Error("EXECUTION_PAYLOAD_INVALID");
  const next=assertPublishable(knowledgeObjectSchema.parse(nextRaw));
  if(next.id!==proposal.targetId||next.version!==proposal.baseVersion+1||next.caseId!==row.caseId)throw new Error("EXECUTION_PAYLOAD_TARGET_MISMATCH");
  for(const source of next.sources){
    if(!db.prepare("SELECT 1 FROM sources WHERE id=? AND version=?").get(source.sourceId,source.version))throw new Error("EXECUTION_SOURCE_NOT_FOUND");
    if(getLatestSourceState(source.sourceId,source.version,db)?.status==="REVOKED")throw new Error("EXECUTION_REVOKED_SOURCE_DENIED");
  }
}

function ensureRelationPreflight(proposal:ProposalRow,payload:Record<string,unknown>,db:Database.Database){
  const row=db.prepare("SELECT version,status FROM knowledge_relations WHERE relation_id=? ORDER BY version DESC LIMIT 1").get(proposal.targetId) as {version:number;status:string}|undefined;
  if(!row)throw new Error("RELATION_NOT_FOUND");
  if(row.version!==proposal.baseVersion||row.status==="REVOKED")throw new Error("EXECUTION_TARGET_STALE");
  const parsed=relationPayload.parse(payload);
  if(proposal.proposalType==="RELATION_REVOKE"&&parsed.status!=="REVOKED")throw new Error("EXECUTION_PAYLOAD_TARGET_MISMATCH");
  if(proposal.proposalType==="RELATION_EVOLUTION"&&parsed.status!=="ACTIVE")throw new Error("EXECUTION_PAYLOAD_TARGET_MISMATCH");
}

function validateExecutableProposal(proposal:ProposalRow,db:Database.Database){
  ensureDecisionAndSignalActive(proposal,db);
  const payload=JSON.parse(proposal.payloadJson) as Record<string,unknown>;
  if(proposal.proposalType==="KNOWLEDGE_EVOLUTION"){
    if(proposal.targetType!=="KNOWLEDGE_VERSION")throw new Error("EXECUTION_PROPOSAL_TARGET_MISMATCH");
    ensureKnowledgePreflight(proposal,payload,db);
  }else{
    if(proposal.targetType!=="RELATION")throw new Error("EXECUTION_PROPOSAL_TARGET_MISMATCH");
    ensureRelationPreflight(proposal,payload,db);
  }
  return payload;
}

function latestEnvelope(envelopeId:string,db:Database.Database):ExecutionEnvelope|undefined{
  const row=db.prepare(`
    SELECT envelope_id AS envelopeId,version,proposal_id AS proposalId,proposal_version AS proposalVersion,
      operation_type AS operationType,target_type AS targetType,target_id AS targetId,base_version AS baseVersion,
      payload_json AS payloadJson,payload_hash AS payloadHash,status,authorized_at AS authorizedAt,
      expires_at AS expiresAt,created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM remediation_execution_envelopes WHERE envelope_id=? ORDER BY version DESC LIMIT 1
  `).get(envelopeId);
  return row?mapEnvelope(row):undefined;
}

function insertEnvelope(db:Database.Database,value:ExecutionEnvelope){
  db.prepare(`
    INSERT INTO remediation_execution_envelopes(
      envelope_id,version,proposal_id,proposal_version,operation_type,target_type,target_id,base_version,
      payload_json,payload_hash,status,authorized_at,expires_at,created_at,actor,supersedes_version
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(value.envelopeId,value.version,value.proposalId,value.proposalVersion,value.operationType,value.targetType,value.targetId,value.baseVersion,JSON.stringify(value.payload),value.payloadHash,value.status,value.authorizedAt,value.expiresAt,value.createdAt,value.actor,value.supersedesVersion);
}

function appendAudit(db:Database.Database,event:AuditEvent){
  db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(event.eventId,event.actor,event.action,event.object,event.objectVersion,event.timestamp,event.authorizationContext,event.outcome,JSON.stringify(event.provenanceRefs));
}

function audit(actor:ActorContext,action:string,envelope:ExecutionEnvelope):AuditEvent{
  return {
    eventId:randomUUID(),actor:actor.actorId,action,object:envelope.envelopeId,objectVersion:envelope.version,
    timestamp:new Date().toISOString(),authorizationContext:`${actor.authentication}:${actor.role}`,
    outcome:"ALLOWED",provenanceRefs:[`${envelope.proposalId}@${envelope.proposalVersion}`,envelope.payloadHash]
  };
}

export function prepareExecutionEnvelope(proposalId:string,actor:ActorContext,db:Database.Database=database()):ExecutionEnvelope{
  requireAuthorization(actor.role,"REMEDIATION_EXECUTION_PREPARE");
  const proposal=latestAcceptedProposal(proposalId,db);
  const payload=validateExecutableProposal(proposal,db);
  const envelopeId=`exec-${createHash("sha256").update(`${proposal.proposalId}@${proposal.version}`).digest("hex").slice(0,32)}`;
  const existing=latestEnvelope(envelopeId,db);
  if(existing)return existing;

  const value:ExecutionEnvelope={
    envelopeId,version:1,proposalId:proposal.proposalId,proposalVersion:proposal.version,
    operationType:proposal.proposalType as ExecutionOperation,targetType:proposal.targetType,targetId:proposal.targetId,
    baseVersion:proposal.baseVersion,payload,payloadHash:payloadHash(payload),status:"PREPARED",
    authorizedAt:null,expiresAt:null,createdAt:new Date().toISOString(),actor:actor.actorId,supersedesVersion:null
  };
  return db.transaction(()=>{
    insertEnvelope(db,value);
    appendAudit(db,audit(actor,"REMEDIATION_EXECUTION_PREPARE",value));
    return value;
  })();
}

export function authorizeExecutionEnvelope(envelopeId:string,input:unknown,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"REMEDIATION_EXECUTION_AUTHORIZE");
  const parsed=authorizationSchema.parse(input);
  const current=latestEnvelope(envelopeId,db);
  if(!current)throw new Error("EXECUTION_ENVELOPE_NOT_FOUND");
  if(current.status!=="PREPARED")throw new Error("EXECUTION_ENVELOPE_NOT_PREPARED");
  const proposal=latestAcceptedProposal(current.proposalId,db);
  if(proposal.version!==current.proposalVersion)throw new Error("EXECUTION_PROPOSAL_CHANGED");
  const payload=validateExecutableProposal(proposal,db);
  if(payloadHash(payload)!==current.payloadHash)throw new Error("EXECUTION_PAYLOAD_HASH_MISMATCH");

  const authorizedAt=new Date();
  const next:ExecutionEnvelope={
    ...current,version:current.version+1,status:"AUTHORIZED",authorizedAt:authorizedAt.toISOString(),
    expiresAt:new Date(authorizedAt.getTime()+parsed.validForSeconds*1000).toISOString(),
    createdAt:authorizedAt.toISOString(),actor:actor.actorId,supersedesVersion:current.version
  };
  return db.transaction(()=>{
    insertEnvelope(db,next);
    appendAudit(db,audit(actor,"REMEDIATION_EXECUTION_AUTHORIZE",next));
    return {envelope:next,executionPerformed:false as const};
  })();
}

export function cancelExecutionEnvelope(envelopeId:string,actor:ActorContext,db:Database.Database=database()):ExecutionEnvelope{
  requireAuthorization(actor.role,"REMEDIATION_EXECUTION_AUTHORIZE");
  const current=latestEnvelope(envelopeId,db);
  if(!current)throw new Error("EXECUTION_ENVELOPE_NOT_FOUND");
  if(current.status!=="PREPARED"&&current.status!=="AUTHORIZED")throw new Error("EXECUTION_ENVELOPE_TERMINAL");
  const next:ExecutionEnvelope={...current,version:current.version+1,status:"CANCELLED",createdAt:new Date().toISOString(),actor:actor.actorId,supersedesVersion:current.version};
  return db.transaction(()=>{
    insertEnvelope(db,next);
    appendAudit(db,audit(actor,"REMEDIATION_EXECUTION_CANCEL",next));
    return next;
  })();
}

export function listExecutionEnvelopeHistory(envelopeId:string,db:Database.Database=database()):ExecutionEnvelope[]{
  return db.prepare(`
    SELECT envelope_id AS envelopeId,version,proposal_id AS proposalId,proposal_version AS proposalVersion,
      operation_type AS operationType,target_type AS targetType,target_id AS targetId,base_version AS baseVersion,
      payload_json AS payloadJson,payload_hash AS payloadHash,status,authorized_at AS authorizedAt,
      expires_at AS expiresAt,created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM remediation_execution_envelopes WHERE envelope_id=? ORDER BY version
  `).all(envelopeId).map(mapEnvelope);
}


export function assertExecutionEnvelopeConsumable(
  envelopeId:string,
  at:Date=new Date(),
  db:Database.Database=database()
):ExecutionEnvelope{
  const current=latestEnvelope(envelopeId,db);
  if(!current)throw new Error("EXECUTION_ENVELOPE_NOT_FOUND");
  if(current.status==="CONSUMED")throw new Error("EXECUTION_ENVELOPE_ALREADY_CONSUMED");
  if(current.status!=="AUTHORIZED")throw new Error("EXECUTION_ENVELOPE_NOT_AUTHORIZED");
  if(!current.authorizedAt||!current.expiresAt)throw new Error("EXECUTION_AUTHORIZATION_INCOMPLETE");
  const now=at.getTime();
  const authorizedAt=Date.parse(current.authorizedAt);
  const expiresAt=Date.parse(current.expiresAt);
  if(!Number.isFinite(now)||!Number.isFinite(authorizedAt)||!Number.isFinite(expiresAt))throw new Error("EXECUTION_TEMPORAL_STATE_INVALID");
  if(now<authorizedAt)throw new Error("EXECUTION_BEFORE_AUTHORIZATION");
  if(now>expiresAt)throw new Error("EXECUTION_AUTHORIZATION_EXPIRED");

  const proposal=latestAcceptedProposal(current.proposalId,db);
  if(proposal.version!==current.proposalVersion)throw new Error("EXECUTION_PROPOSAL_CHANGED");
  const payload=validateExecutableProposal(proposal,db);
  if(payloadHash(payload)!==current.payloadHash)throw new Error("EXECUTION_PAYLOAD_HASH_MISMATCH");
  return current;
}

export function appendConsumedExecutionEnvelope(
  current:ExecutionEnvelope,
  actor:ActorContext,
  at:Date=new Date(),
  db:Database.Database=database()
):ExecutionEnvelope{
  requireAuthorization(actor.role,"REMEDIATION_EXECUTE");
  const latest=latestEnvelope(current.envelopeId,db);
  if(!latest)throw new Error("EXECUTION_ENVELOPE_NOT_FOUND");
  if(latest.version!==current.version||latest.status!=="AUTHORIZED")throw new Error("EXECUTION_ENVELOPE_STATE_CHANGED");
  const next:ExecutionEnvelope={
    ...latest,
    version:latest.version+1,
    status:"CONSUMED",
    createdAt:at.toISOString(),
    actor:actor.actorId,
    supersedesVersion:latest.version
  };
  insertEnvelope(db,next);
  appendAudit(db,audit(actor,"REMEDIATION_EXECUTION_CONSUME",next));
  return next;
}
