import {createHash,randomUUID} from "node:crypto";
import type Database from "better-sqlite3";
import {database} from "./sqlite";
import {requireAuthorization} from "./authorization";
import type {ActorContext} from "./actor";
import type {AuditEvent,KnowledgeObject} from "./domain";
import {transitionReviewSignal} from "./impact-analysis";

export type VerificationVerdict="MATCH"|"MISMATCH";
export type VerificationStatus="RECORDED"|"CLOSED";
export type VerificationRecord={
  verificationId:string;
  version:number;
  envelopeId:string;
  envelopeVersion:number;
  signalId:string;
  signalVersion:number;
  targetType:"KNOWLEDGE_VERSION"|"RELATION";
  targetId:string;
  expectedVersion:number;
  observedVersion:number|null;
  expectedHash:string;
  observedHash:string|null;
  verdict:VerificationVerdict;
  status:VerificationStatus;
  evidence:Record<string,unknown>;
  closureNote:string|null;
  createdAt:string;
  actor:string;
  supersedesVersion:number|null;
};

type EnvelopeRow={
  envelopeId:string;version:number;proposalId:string;proposalVersion:number;
  operationType:"KNOWLEDGE_EVOLUTION"|"RELATION_EVOLUTION"|"RELATION_REVOKE";
  targetType:"KNOWLEDGE_VERSION"|"RELATION";targetId:string;baseVersion:number;
  payloadJson:string;payloadHash:string;status:string;actor:string;
};
type SignalRow={signalId:string;version:number;status:string};
type ProposalLink={workId:string};
type WorkLink={signalId:string};

function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  const object=value as Record<string,unknown>;
  return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}
function hash(value:unknown){return createHash("sha256").update(canonicalJson(value)).digest("hex");}
function verificationId(envelopeId:string){return `verify-${createHash("sha256").update(envelopeId).digest("hex").slice(0,32)}`;}

function latestConsumedEnvelope(envelopeId:string,db:Database.Database):EnvelopeRow{
  const row=db.prepare(`
    SELECT envelope_id AS envelopeId,version,proposal_id AS proposalId,proposal_version AS proposalVersion,
      operation_type AS operationType,target_type AS targetType,target_id AS targetId,base_version AS baseVersion,
      payload_json AS payloadJson,payload_hash AS payloadHash,status,actor
    FROM remediation_execution_envelopes WHERE envelope_id=? ORDER BY version DESC LIMIT 1
  `).get(envelopeId) as EnvelopeRow|undefined;
  if(!row)throw new Error("EXECUTION_ENVELOPE_NOT_FOUND");
  if(row.status!=="CONSUMED")throw new Error("EXECUTION_NOT_CONSUMED");
  return row;
}

function signalForEnvelope(envelope:EnvelopeRow,db:Database.Database):SignalRow{
  const proposal=db.prepare("SELECT work_id AS workId FROM remediation_proposals WHERE proposal_id=? AND version=?")
    .get(envelope.proposalId,envelope.proposalVersion) as ProposalLink|undefined;
  if(!proposal)throw new Error("REMEDIATION_PROPOSAL_NOT_FOUND");
  const work=db.prepare("SELECT signal_id AS signalId FROM remediation_work_items WHERE work_id=? ORDER BY version DESC LIMIT 1")
    .get(proposal.workId) as WorkLink|undefined;
  if(!work)throw new Error("REMEDIATION_WORK_NOT_FOUND");
  const signal=db.prepare("SELECT signal_id AS signalId,version,status FROM review_signals WHERE signal_id=? ORDER BY version DESC LIMIT 1")
    .get(work.signalId) as SignalRow|undefined;
  if(!signal)throw new Error("REVIEW_SIGNAL_NOT_FOUND");
  if(signal.status==="RESOLVED")throw new Error("REVIEW_SIGNAL_RESOLVED_TERMINAL");
  return signal;
}

function normalizeKnowledge(input:any){
  return {
    id:input.id,caseId:input.caseId,title:input.title,content:input.content,status:input.status,
    version:input.version,
    sources:[...(input.sources??[])].map((s:any)=>({sourceId:s.sourceId,version:s.version,provenance:s.provenance}))
      .sort((a:any,b:any)=>a.sourceId.localeCompare(b.sourceId)||a.version-b.version),
    createdAt:input.createdAt
  };
}

function observedKnowledge(id:string,db:Database.Database):KnowledgeObject|null{
  const row=db.prepare("SELECT id,case_id AS caseId,title,content,status,version,created_at AS createdAt FROM knowledge_objects WHERE id=?").get(id) as Omit<KnowledgeObject,"sources">|undefined;
  if(!row)return null;
  const sources=db.prepare("SELECT source_id AS sourceId,source_version AS version,provenance_state AS provenance FROM source_refs WHERE knowledge_id=? ORDER BY source_id,source_version").all(id) as KnowledgeObject["sources"];
  return {...row,sources};
}

function expectedAndObserved(envelope:EnvelopeRow,db:Database.Database){
  const payload=JSON.parse(envelope.payloadJson) as Record<string,unknown>;
  if(envelope.operationType==="KNOWLEDGE_EVOLUTION"){
    const expected=normalizeKnowledge((payload as {next:unknown}).next);
    const observedRaw=observedKnowledge(envelope.targetId,db);
    const observed=observedRaw?normalizeKnowledge(observedRaw):null;
    return {expected,observed,expectedVersion:envelope.baseVersion+1,observedVersion:observed?.version??null};
  }

  const relation=db.prepare(`
    SELECT relation_id AS relationId,version,provenance_state AS provenance,evidence_refs_json AS evidenceRefsJson,status
    FROM knowledge_relations WHERE relation_id=? ORDER BY version DESC LIMIT 1
  `).get(envelope.targetId) as {relationId:string;version:number;provenance:string;evidenceRefsJson:string;status:string}|undefined;
  const expected={
    relationId:envelope.targetId,version:envelope.baseVersion+1,
    provenance:(payload as any).provenance,
    evidenceRefs:[...((payload as any).evidenceRefs??[])].sort(),
    status:(payload as any).status
  };
  const observed=relation?{
    relationId:relation.relationId,version:relation.version,provenance:relation.provenance,
    evidenceRefs:(JSON.parse(relation.evidenceRefsJson) as string[]).sort(),status:relation.status
  }:null;
  return {expected,observed,expectedVersion:envelope.baseVersion+1,observedVersion:observed?.version??null};
}

function mutationAuditAction(operation:EnvelopeRow["operationType"]){
  if(operation==="KNOWLEDGE_EVOLUTION")return "KNOWLEDGE_EVOLVE";
  return operation==="RELATION_REVOKE"?"KNOWLEDGE_RELATION_REVOKE":"KNOWLEDGE_RELATION_EVOLVE";
}

function evaluateEnvelopeState(envelope:EnvelopeRow,db:Database.Database){
  const state=expectedAndObserved(envelope,db);
  const expectedHash=hash(state.expected);
  const observedHash=state.observed?hash(state.observed):null;
  const mutationAction=mutationAuditAction(envelope.operationType);
  const mutationAuditPresent=Boolean(db.prepare("SELECT 1 FROM audit_events WHERE action=? AND object_id=? AND object_version=? LIMIT 1")
    .get(mutationAction,envelope.targetId,state.expectedVersion));
  const consumeAuditPresent=Boolean(db.prepare("SELECT 1 FROM audit_events WHERE action='REMEDIATION_EXECUTION_CONSUME' AND object_id=? AND object_version=? LIMIT 1")
    .get(envelope.envelopeId,envelope.version));
  const stateMatches=expectedHash===observedHash&&state.observedVersion===state.expectedVersion;
  const verdict:VerificationVerdict=stateMatches&&mutationAuditPresent&&consumeAuditPresent?"MATCH":"MISMATCH";
  return {...state,expectedHash,observedHash,mutationAuditPresent,consumeAuditPresent,stateMatches,verdict};
}

function latestVerification(id:string,db:Database.Database):VerificationRecord|undefined{
  const row=db.prepare(`
    SELECT verification_id AS verificationId,version,envelope_id AS envelopeId,envelope_version AS envelopeVersion,
      signal_id AS signalId,signal_version AS signalVersion,target_type AS targetType,target_id AS targetId,
      expected_version AS expectedVersion,observed_version AS observedVersion,expected_hash AS expectedHash,
      observed_hash AS observedHash,verdict,status,evidence_json AS evidenceJson,closure_note AS closureNote,
      created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM remediation_verifications WHERE verification_id=? ORDER BY version DESC LIMIT 1
  `).get(id) as any;
  return row?{...row,evidence:JSON.parse(row.evidenceJson),evidenceJson:undefined,observedVersion:row.observedVersion??null,observedHash:row.observedHash??null,closureNote:row.closureNote??null,supersedesVersion:row.supersedesVersion??null}:undefined;
}

function insertVerification(db:Database.Database,value:VerificationRecord){
  db.prepare(`
    INSERT INTO remediation_verifications(
      verification_id,version,envelope_id,envelope_version,signal_id,signal_version,target_type,target_id,
      expected_version,observed_version,expected_hash,observed_hash,verdict,status,evidence_json,closure_note,
      created_at,actor,supersedes_version
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(value.verificationId,value.version,value.envelopeId,value.envelopeVersion,value.signalId,value.signalVersion,
    value.targetType,value.targetId,value.expectedVersion,value.observedVersion,value.expectedHash,value.observedHash,
    value.verdict,value.status,JSON.stringify(value.evidence),value.closureNote,value.createdAt,value.actor,value.supersedesVersion);
}

function appendAudit(db:Database.Database,event:AuditEvent){
  db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(event.eventId,event.actor,event.action,event.object,event.objectVersion,event.timestamp,event.authorizationContext,event.outcome,JSON.stringify(event.provenanceRefs));
}
function audit(actor:ActorContext,action:string,value:VerificationRecord):AuditEvent{
  return {
    eventId:randomUUID(),actor:actor.actorId,action,object:value.verificationId,objectVersion:value.version,
    timestamp:value.createdAt,authorizationContext:`${actor.authentication}:${actor.role}`,outcome:"ALLOWED",
    provenanceRefs:[`${value.envelopeId}@${value.envelopeVersion}`,value.expectedHash,value.observedHash??"NO_OBSERVED_STATE"]
  };
}

export function recordPostExecutionVerification(envelopeId:string,actor:ActorContext,db:Database.Database=database()):VerificationRecord{
  requireAuthorization(actor.role,"REMEDIATION_VERIFY");
  const envelope=latestConsumedEnvelope(envelopeId,db);
  if(envelope.actor===actor.actorId)throw new Error("VERIFICATION_EXECUTOR_SEPARATION_REQUIRED");
  const signal=signalForEnvelope(envelope,db);
  const id=verificationId(envelope.envelopeId);
  const previous=latestVerification(id,db);
  if(previous?.status==="CLOSED")throw new Error("VERIFICATION_CLOSED_TERMINAL");

  const evaluated=evaluateEnvelopeState(envelope,db);
  const value:VerificationRecord={
    verificationId:id,version:(previous?.version??0)+1,envelopeId:envelope.envelopeId,envelopeVersion:envelope.version,
    signalId:signal.signalId,signalVersion:signal.version,targetType:envelope.targetType,targetId:envelope.targetId,
    expectedVersion:evaluated.expectedVersion,observedVersion:evaluated.observedVersion,expectedHash:evaluated.expectedHash,observedHash:evaluated.observedHash,verdict:evaluated.verdict,status:"RECORDED",
    evidence:{stateMatches:evaluated.stateMatches,mutationAuditPresent:evaluated.mutationAuditPresent,consumeAuditPresent:evaluated.consumeAuditPresent,operationType:envelope.operationType,payloadHash:envelope.payloadHash},
    closureNote:null,createdAt:new Date().toISOString(),actor:actor.actorId,supersedesVersion:previous?.version??null
  };
  return db.transaction(()=>{
    insertVerification(db,value);
    appendAudit(db,audit(actor,evaluated.verdict==="MATCH"?"REMEDIATION_VERIFY_MATCH":"REMEDIATION_VERIFY_MISMATCH",value));
    return value;
  })();
}

export function closeVerifiedRemediation(verificationIdValue:string,note:string,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"REMEDIATION_CLOSE");
  if(!note.trim())throw new Error("VERIFICATION_CLOSURE_NOTE_REQUIRED");
  const current=latestVerification(verificationIdValue,db);
  if(!current)throw new Error("VERIFICATION_NOT_FOUND");
  if(current.status==="CLOSED")throw new Error("VERIFICATION_CLOSED_TERMINAL");
  if(current.verdict!=="MATCH")throw new Error("VERIFICATION_MATCH_REQUIRED");

  const envelope=latestConsumedEnvelope(current.envelopeId,db);
  if(envelope.actor===actor.actorId)throw new Error("CLOSURE_EXECUTOR_SEPARATION_REQUIRED");
  const signal=signalForEnvelope(envelope,db);
  if(signal.signalId!==current.signalId)throw new Error("VERIFICATION_SIGNAL_DRIFT");
  if(signal.status!=="ACKNOWLEDGED")throw new Error("REVIEW_SIGNAL_ACK_REQUIRED");
  const reevaluated=evaluateEnvelopeState(envelope,db);
  if(
    reevaluated.verdict!=="MATCH"||
    reevaluated.expectedHash!==current.expectedHash||
    reevaluated.observedHash!==current.observedHash
  )throw new Error("VERIFICATION_STALE_AT_CLOSURE");

  const closed:VerificationRecord={
    ...current,version:current.version+1,signalVersion:signal.version,status:"CLOSED",closureNote:note.trim(),
    createdAt:new Date().toISOString(),actor:actor.actorId,supersedesVersion:current.version
  };
  return db.transaction(()=>{
    insertVerification(db,closed);
    appendAudit(db,audit(actor,"REMEDIATION_VERIFICATION_CLOSE",closed));
    const resolved=transitionReviewSignal(signal.signalId,"RESOLVED",actor,db);
    return {verification:closed,reviewSignal:resolved};
  })();
}

export function listPostExecutionVerificationHistory(verificationIdValue:string,db:Database.Database=database()):VerificationRecord[]{
  return db.prepare(`
    SELECT verification_id AS verificationId,version,envelope_id AS envelopeId,envelope_version AS envelopeVersion,
      signal_id AS signalId,signal_version AS signalVersion,target_type AS targetType,target_id AS targetId,
      expected_version AS expectedVersion,observed_version AS observedVersion,expected_hash AS expectedHash,
      observed_hash AS observedHash,verdict,status,evidence_json AS evidenceJson,closure_note AS closureNote,
      created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM remediation_verifications WHERE verification_id=? ORDER BY version
  `).all(verificationIdValue).map((row:any)=>({...row,evidence:JSON.parse(row.evidenceJson),evidenceJson:undefined,observedVersion:row.observedVersion??null,observedHash:row.observedHash??null,closureNote:row.closureNote??null,supersedesVersion:row.supersedesVersion??null}));
}
