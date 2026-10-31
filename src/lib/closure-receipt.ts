import {createHash,randomUUID} from "node:crypto";
import type Database from "better-sqlite3";
import {database} from "./sqlite";
import {requireAuthorization} from "./authorization";
import type {ActorContext} from "./actor";
import type {AuditEvent} from "./domain";

export type ClosureReceipt={
  receiptId:string;
  verificationId:string;
  verificationVersion:number;
  signalId:string;
  signalVersion:number;
  workId:string;
  workVersion:number;
  proposalId:string;
  proposalVersion:number;
  envelopeId:string;
  envelopeVersion:number;
  targetType:"KNOWLEDGE_VERSION"|"RELATION";
  targetId:string;
  targetVersion:number;
  chainHash:string;
  snapshot:Record<string,unknown>;
  createdAt:string;
  actor:string;
};

type AuditRow={
  eventId:string;actor:string;action:string;objectId:string;objectVersion:number;
  timestamp:string;authorizationContext:string;outcome:string;provenanceRefsJson:string;
};

function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  const object=value as Record<string,unknown>;
  return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}
function sha256(value:unknown){return createHash("sha256").update(typeof value==="string"?value:canonicalJson(value)).digest("hex");}
function receiptId(verificationId:string){return `receipt-${sha256(verificationId).slice(0,32)}`;}

function auditRow(action:string,objectId:string,objectVersion:number,db:Database.Database){
  const row=db.prepare(`
    SELECT event_id AS eventId,actor,action,object_id AS objectId,object_version AS objectVersion,
      timestamp,authorization_context AS authorizationContext,outcome,provenance_refs_json AS provenanceRefsJson
    FROM audit_events WHERE action=? AND object_id=? AND object_version=?
    ORDER BY event_id LIMIT 1
  `).get(action,objectId,objectVersion) as AuditRow|undefined;
  if(!row)throw new Error("CLOSURE_AUDIT_EVIDENCE_MISSING");
  return {
    eventId:row.eventId,actor:row.actor,action:row.action,objectId:row.objectId,objectVersion:row.objectVersion,
    timestamp:row.timestamp,authorizationContext:row.authorizationContext,outcome:row.outcome,
    provenanceRefs:JSON.parse(row.provenanceRefsJson) as string[]
  };
}

function mutationAction(operationType:string){
  if(operationType==="KNOWLEDGE_EVOLUTION")return "KNOWLEDGE_EVOLVE";
  return operationType==="RELATION_REVOKE"?"KNOWLEDGE_RELATION_REVOKE":"KNOWLEDGE_RELATION_EVOLVE";
}

function buildClosureSnapshot(verificationIdValue:string,db:Database.Database){
  const verification=db.prepare(`
    SELECT verification_id AS verificationId,version,envelope_id AS envelopeId,envelope_version AS envelopeVersion,
      signal_id AS signalId,signal_version AS signalVersion,target_type AS targetType,target_id AS targetId,
      expected_version AS expectedVersion,observed_version AS observedVersion,expected_hash AS expectedHash,
      observed_hash AS observedHash,verdict,status,evidence_json AS evidenceJson,closure_note AS closureNote,
      created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM remediation_verifications WHERE verification_id=? ORDER BY version DESC LIMIT 1
  `).get(verificationIdValue) as any;
  if(!verification)throw new Error("VERIFICATION_NOT_FOUND");
  if(verification.status!=="CLOSED"||verification.verdict!=="MATCH")throw new Error("CLOSURE_RECEIPT_REQUIRES_CLOSED_MATCH");
  if(!verification.supersedesVersion)throw new Error("CLOSURE_CHAIN_INVALID");
  if(verification.observedVersion!==verification.expectedVersion||verification.expectedHash!==verification.observedHash)throw new Error("CLOSURE_CHAIN_INVALID");

  const envelope=db.prepare(`
    SELECT envelope_id AS envelopeId,version,proposal_id AS proposalId,proposal_version AS proposalVersion,
      operation_type AS operationType,target_type AS targetType,target_id AS targetId,base_version AS baseVersion,
      payload_hash AS payloadHash,status,authorized_at AS authorizedAt,expires_at AS expiresAt,created_at AS createdAt,
      actor,supersedes_version AS supersedesVersion
    FROM remediation_execution_envelopes WHERE envelope_id=? ORDER BY version DESC LIMIT 1
  `).get(verification.envelopeId) as any;
  if(!envelope||envelope.status!=="CONSUMED"||envelope.version!==verification.envelopeVersion||envelope.version!==3)throw new Error("CLOSURE_CHAIN_INVALID");

  const proposal=db.prepare(`
    SELECT proposal_id AS proposalId,version,work_id AS workId,work_version AS workVersion,
      proposal_type AS proposalType,target_type AS targetType,target_id AS targetId,base_version AS baseVersion,
      payload_json AS payloadJson,rationale,status,decision_note AS decisionNote,created_at AS createdAt,
      actor,supersedes_version AS supersedesVersion
    FROM remediation_proposals WHERE proposal_id=? ORDER BY version DESC LIMIT 1
  `).get(envelope.proposalId) as any;
  if(!proposal||proposal.status!=="ACCEPTED"||proposal.version!==envelope.proposalVersion||proposal.version!==2)throw new Error("CLOSURE_CHAIN_INVALID");

  const work=db.prepare(`
    SELECT work_id AS workId,version,signal_id AS signalId,signal_version AS signalVersion,
      target_type AS targetType,target_id AS targetId,target_version AS targetVersion,status,assignee,
      created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM remediation_work_items WHERE work_id=? ORDER BY version DESC LIMIT 1
  `).get(proposal.workId) as any;
  if(!work||work.status!=="DECIDED"||work.version!==4)throw new Error("CLOSURE_CHAIN_INVALID");

  const signal=db.prepare(`
    SELECT signal_id AS signalId,version,cause_kind AS causeKind,cause_source_id AS causeSourceId,
      cause_source_version AS causeSourceVersion,target_type AS targetType,target_id AS targetId,
      target_version AS targetVersion,impact_kind AS impactKind,severity,status,path_json AS pathJson,
      created_at AS createdAt,actor,supersedes_version AS supersedesVersion
    FROM review_signals WHERE signal_id=? ORDER BY version DESC LIMIT 1
  `).get(work.signalId) as any;
  if(!signal||signal.status!=="RESOLVED"||!signal.supersedesVersion)throw new Error("CLOSURE_CHAIN_INVALID");

  if(
    verification.signalId!==signal.signalId||
    proposal.workId!==work.workId||
    work.signalId!==signal.signalId||
    verification.targetType!==signal.targetType||
    verification.targetId!==signal.targetId||
    work.targetType!==signal.targetType||
    work.targetId!==signal.targetId||
    work.targetVersion!==signal.targetVersion||
    proposal.targetType!==signal.targetType||
    proposal.targetId!==signal.targetId||
    proposal.baseVersion!==signal.targetVersion||
    envelope.targetType!==proposal.targetType||
    envelope.targetId!==proposal.targetId||
    envelope.baseVersion!==proposal.baseVersion||
    verification.expectedVersion!==proposal.baseVersion+1
  )throw new Error("CLOSURE_CHAIN_LINK_MISMATCH");

  const proposalPayloadHash=sha256(JSON.parse(proposal.payloadJson));
  if(proposalPayloadHash!==envelope.payloadHash)throw new Error("CLOSURE_PAYLOAD_HASH_MISMATCH");

  const verificationMatchVersion=verification.supersedesVersion;
  const signalAckVersion=signal.supersedesVersion;
  const audits=[
    auditRow("REMEDIATION_WORK_CREATE",work.workId,1,db),
    auditRow("REMEDIATION_WORK_CLAIM",work.workId,2,db),
    auditRow("REMEDIATION_PROPOSE",proposal.proposalId,1,db),
    auditRow("REMEDIATION_DECIDE_ACCEPT",proposal.proposalId,2,db),
    auditRow("REMEDIATION_EXECUTION_PREPARE",envelope.envelopeId,1,db),
    auditRow("REMEDIATION_EXECUTION_AUTHORIZE",envelope.envelopeId,2,db),
    auditRow(mutationAction(envelope.operationType),envelope.targetId,verification.expectedVersion,db),
    auditRow("REMEDIATION_EXECUTION_CONSUME",envelope.envelopeId,3,db),
    auditRow("REMEDIATION_VERIFY_MATCH",verification.verificationId,verificationMatchVersion,db),
    auditRow("IMPACT_SIGNAL_ACKNOWLEDGE",signal.signalId,signalAckVersion,db),
    auditRow("REMEDIATION_VERIFICATION_CLOSE",verification.verificationId,verification.version,db),
    auditRow("IMPACT_SIGNAL_RESOLVE",signal.signalId,signal.version,db)
  ];
  if(audits.some(a=>a.outcome!=="ALLOWED"))throw new Error("CLOSURE_AUDIT_OUTCOME_INVALID");

  const snapshot={
    schemaVersion:"veldgids.closure-receipt.v1",
    signal:{
      signalId:signal.signalId,version:signal.version,status:signal.status,causeKind:signal.causeKind,
      causeSourceId:signal.causeSourceId,causeSourceVersion:signal.causeSourceVersion,targetType:signal.targetType,
      targetId:signal.targetId,targetVersion:signal.targetVersion,impactKind:signal.impactKind,severity:signal.severity,
      path:JSON.parse(signal.pathJson),createdAt:signal.createdAt,actor:signal.actor,supersedesVersion:signal.supersedesVersion
    },
    work:{
      workId:work.workId,version:work.version,status:work.status,signalId:work.signalId,signalVersion:work.signalVersion,
      targetType:work.targetType,targetId:work.targetId,targetVersion:work.targetVersion,assignee:work.assignee,
      createdAt:work.createdAt,actor:work.actor,supersedesVersion:work.supersedesVersion
    },
    proposal:{
      proposalId:proposal.proposalId,version:proposal.version,status:proposal.status,workId:proposal.workId,
      workVersion:proposal.workVersion,proposalType:proposal.proposalType,targetType:proposal.targetType,
      targetId:proposal.targetId,baseVersion:proposal.baseVersion,payloadHash:proposalPayloadHash,
      rationale:proposal.rationale,decisionNote:proposal.decisionNote,createdAt:proposal.createdAt,actor:proposal.actor,
      supersedesVersion:proposal.supersedesVersion
    },
    envelope:{
      envelopeId:envelope.envelopeId,version:envelope.version,status:envelope.status,proposalId:envelope.proposalId,
      proposalVersion:envelope.proposalVersion,operationType:envelope.operationType,targetType:envelope.targetType,
      targetId:envelope.targetId,baseVersion:envelope.baseVersion,payloadHash:envelope.payloadHash,
      authorizedAt:envelope.authorizedAt,expiresAt:envelope.expiresAt,createdAt:envelope.createdAt,
      actor:envelope.actor,supersedesVersion:envelope.supersedesVersion
    },
    verification:{
      verificationId:verification.verificationId,version:verification.version,status:verification.status,
      verdict:verification.verdict,envelopeId:verification.envelopeId,envelopeVersion:verification.envelopeVersion,
      signalId:verification.signalId,signalVersion:verification.signalVersion,targetType:verification.targetType,
      targetId:verification.targetId,expectedVersion:verification.expectedVersion,observedVersion:verification.observedVersion,
      expectedHash:verification.expectedHash,observedHash:verification.observedHash,
      evidence:JSON.parse(verification.evidenceJson),closureNote:verification.closureNote,
      createdAt:verification.createdAt,actor:verification.actor,supersedesVersion:verification.supersedesVersion
    },
    audits
  };
  return {snapshot,verification,signal,work,proposal,envelope};
}

function mapReceipt(row:any):ClosureReceipt{
  return {
    receiptId:row.receiptId,verificationId:row.verificationId,verificationVersion:row.verificationVersion,
    signalId:row.signalId,signalVersion:row.signalVersion,workId:row.workId,workVersion:row.workVersion,
    proposalId:row.proposalId,proposalVersion:row.proposalVersion,envelopeId:row.envelopeId,
    envelopeVersion:row.envelopeVersion,targetType:row.targetType,targetId:row.targetId,targetVersion:row.targetVersion,
    chainHash:row.chainHash,snapshot:JSON.parse(row.snapshotJson),createdAt:row.createdAt,actor:row.actor
  };
}

function loadReceipt(id:string,db:Database.Database):ClosureReceipt|undefined{
  const row=db.prepare(`
    SELECT receipt_id AS receiptId,verification_id AS verificationId,verification_version AS verificationVersion,
      signal_id AS signalId,signal_version AS signalVersion,work_id AS workId,work_version AS workVersion,
      proposal_id AS proposalId,proposal_version AS proposalVersion,envelope_id AS envelopeId,envelope_version AS envelopeVersion,
      target_type AS targetType,target_id AS targetId,target_version AS targetVersion,chain_hash AS chainHash,
      snapshot_json AS snapshotJson,created_at AS createdAt,actor
    FROM remediation_closure_receipts WHERE receipt_id=?
  `).get(id);
  return row?mapReceipt(row):undefined;
}

function appendAudit(db:Database.Database,event:AuditEvent){
  db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(event.eventId,event.actor,event.action,event.object,event.objectVersion,event.timestamp,event.authorizationContext,event.outcome,JSON.stringify(event.provenanceRefs));
}

export function createClosureReceipt(verificationIdValue:string,actor:ActorContext,db:Database.Database=database()):ClosureReceipt{
  requireAuthorization(actor.role,"CLOSURE_RECEIPT_CREATE");
  const built=buildClosureSnapshot(verificationIdValue,db);
  const id=receiptId(verificationIdValue);
  const chainHash=sha256(built.snapshot);
  const existing=loadReceipt(id,db);
  if(existing){
    if(existing.chainHash!==chainHash||canonicalJson(existing.snapshot)!==canonicalJson(built.snapshot))throw new Error("CLOSURE_RECEIPT_CONFLICT");
    return existing;
  }

  const value:ClosureReceipt={
    receiptId:id,verificationId:built.verification.verificationId,verificationVersion:built.verification.version,
    signalId:built.signal.signalId,signalVersion:built.signal.version,workId:built.work.workId,workVersion:built.work.version,
    proposalId:built.proposal.proposalId,proposalVersion:built.proposal.version,envelopeId:built.envelope.envelopeId,
    envelopeVersion:built.envelope.version,targetType:built.verification.targetType,targetId:built.verification.targetId,
    targetVersion:built.verification.observedVersion,chainHash,snapshot:built.snapshot,createdAt:new Date().toISOString(),actor:actor.actorId
  };

  return db.transaction(()=>{
    db.prepare(`
      INSERT INTO remediation_closure_receipts(
        receipt_id,verification_id,verification_version,signal_id,signal_version,work_id,work_version,
        proposal_id,proposal_version,envelope_id,envelope_version,target_type,target_id,target_version,
        chain_hash,snapshot_json,created_at,actor
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(value.receiptId,value.verificationId,value.verificationVersion,value.signalId,value.signalVersion,
      value.workId,value.workVersion,value.proposalId,value.proposalVersion,value.envelopeId,value.envelopeVersion,
      value.targetType,value.targetId,value.targetVersion,value.chainHash,JSON.stringify(value.snapshot),value.createdAt,value.actor);
    const event:AuditEvent={
      eventId:randomUUID(),actor:actor.actorId,action:"CLOSURE_RECEIPT_SEAL",object:value.receiptId,objectVersion:1,
      timestamp:value.createdAt,authorizationContext:`${actor.authentication}:${actor.role}`,outcome:"ALLOWED",
      provenanceRefs:[`${value.verificationId}@${value.verificationVersion}`,value.chainHash]
    };
    appendAudit(db,event);
    return value;
  })();
}

export function getClosureReceipt(id:string,actor:ActorContext,db:Database.Database=database()):ClosureReceipt{
  requireAuthorization(actor.role,"CLOSURE_RECEIPT_READ");
  const receipt=loadReceipt(id,db);
  if(!receipt)throw new Error("CLOSURE_RECEIPT_NOT_FOUND");
  return receipt;
}

export function replayClosureReceipt(id:string,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"CLOSURE_RECEIPT_REPLAY");
  const receipt=loadReceipt(id,db);
  if(!receipt)throw new Error("CLOSURE_RECEIPT_NOT_FOUND");

  const storedHashMatchesSnapshot=sha256(receipt.snapshot)===receipt.chainHash;
  let rebuiltHash:string|null=null;
  let currentSnapshotMatchesStored=false;
  let chainFailure:string|null=null;
  try{
    const rebuilt=buildClosureSnapshot(receipt.verificationId,db);
    rebuiltHash=sha256(rebuilt.snapshot);
    currentSnapshotMatchesStored=canonicalJson(rebuilt.snapshot)===canonicalJson(receipt.snapshot)&&rebuiltHash===receipt.chainHash;
  }catch(error){
    chainFailure=error instanceof Error?error.message:"CLOSURE_REPLAY_CHAIN_INVALID";
  }
  const sealAuditPresent=Boolean(db.prepare("SELECT 1 FROM audit_events WHERE action='CLOSURE_RECEIPT_SEAL' AND object_id=? AND object_version=1 LIMIT 1").get(receipt.receiptId));
  const valid=storedHashMatchesSnapshot&&currentSnapshotMatchesStored&&sealAuditPresent&&!chainFailure;

  return {
    receiptId:receipt.receiptId,
    verdict:valid?"VALID" as const:"INVALID" as const,
    chainHash:receipt.chainHash,
    rebuiltHash,
    checks:{storedHashMatchesSnapshot,currentSnapshotMatchesStored,sealAuditPresent},
    failure:chainFailure,
    mutationPerformed:false as const
  };
}
