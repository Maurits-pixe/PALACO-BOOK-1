import assert from "node:assert/strict";
import {test} from "node:test";
import Database from "better-sqlite3";
import {applyMigrations} from "../src/lib/sqlite";
import {createCaseKnowledgeTransaction} from "../src/lib/transaction";
import {recordImpactSignals,transitionReviewSignal} from "../src/lib/impact-analysis";
import {registerSourceVersion,transitionSourceState} from "../src/lib/source-ledger";
import {claimRemediationWork,decideRemediationProposal,materializeRemediationWork,submitRemediationProposal} from "../src/lib/remediation";
import {authorizeExecutionEnvelope,cancelExecutionEnvelope,listExecutionEnvelopeHistory,prepareExecutionEnvelope} from "../src/lib/execution-envelope";
import {evolveKnowledge} from "../src/lib/knowledge-history";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
const developer:ActorContext={actorId:"dev-1",role:"DEVELOPER",authentication:"TEST"};
const reviewerA:ActorContext={actorId:"reviewer-a",role:"REVIEWER",authentication:"TEST"};
const reviewerB:ActorContext={actorId:"reviewer-b",role:"REVIEWER",authentication:"TEST"};

function setup(){
  const db=new Database(":memory:");
  applyMigrations(db);
  const createdAt="2026-10-31T08:00:00.000Z";
  const base={
    id:"knowledge-1",caseId:"case-1",title:"Initial",content:"v1",status:"PUBLISHED" as const,version:1,
    sources:[{sourceId:"source-1",version:1,provenance:"VERIFIED" as const}],createdAt
  };
  createCaseKnowledgeTransaction({
    case:{id:"case-1",title:"Case",objective:"Execution preflight",status:"ACTIVE",createdAt},
    knowledge:base,
    source:{id:"source-1",uri:"https://example.test/source-1",title:"Source 1",version:1,checksum:"sum-1",createdAt},
    provenance:{id:"prov-1",status:"VERIFIED",createdAt}
  },owner,db);
  registerSourceVersion({id:"source-1",version:2,uri:"https://example.test/source-1/v2",title:"Source 1 v2",checksum:"sum-2",createdAt:"2026-10-31T08:05:00.000Z"},developer,db);
  transitionSourceState({sourceId:"source-1",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  const signal=recordImpactSignals({causeKind:"SOURCE_REVOKED",source:{id:"source-1",version:1},maxDepth:1},reviewerA,db).recorded
    .find(x=>x.targetType==="KNOWLEDGE_VERSION"&&x.targetId==="knowledge-1");
  if(!signal)throw new Error("TEST_SIGNAL_MISSING");
  return {db,base,signalId:signal.signalId};
}

function nextKnowledge(base:ReturnType<typeof setup>["base"],sourceVersion=2){
  return {
    ...base,title:"Remediated",content:"v2",version:2,createdAt:"2026-10-31T08:10:00.000Z",
    sources:[{sourceId:"source-1",version:sourceVersion,provenance:"VERIFIED" as const}]
  };
}

function acceptedKnowledgeProposal(db:Database.Database,signalId:string,next:unknown,proposalType:"KNOWLEDGE_EVOLUTION"|"NO_CHANGE"="KNOWLEDGE_EVOLUTION"){
  const work=materializeRemediationWork(signalId,reviewerA,db);
  claimRemediationWork(work.workId,reviewerA,db);
  const proposal=submitRemediationProposal(work.workId,{
    proposalType,
    payload:proposalType==="KNOWLEDGE_EVOLUTION"?{next}:{},
    rationale:"independent remediation proposal"
  },reviewerA,db);
  decideRemediationProposal(proposal.proposalId,{decision:"ACCEPTED",note:"accepted after independent review"},reviewerB,db);
  return proposal.proposalId;
}

test("accepted executable proposal can be prepared without changing knowledge",()=>{
  const {db,base,signalId}=setup();
  const proposalId=acceptedKnowledgeProposal(db,signalId,nextKnowledge(base));
  const envelope=prepareExecutionEnvelope(proposalId,developer,db);
  assert.equal(envelope.status,"PREPARED");
  assert.equal(envelope.operationType,"KNOWLEDGE_EVOLUTION");
  assert.equal(envelope.targetId,"knowledge-1");
  assert.equal(envelope.baseVersion,1);
  assert.equal(envelope.payloadHash.length,64);
  assert.deepEqual(db.prepare("SELECT version,title FROM knowledge_objects WHERE id='knowledge-1'").get(),{version:1,title:"Initial"});
  db.close();
});

test("only owner authorizes an envelope and authorization still performs no execution",()=>{
  const {db,base,signalId}=setup();
  const proposalId=acceptedKnowledgeProposal(db,signalId,nextKnowledge(base));
  const envelope=prepareExecutionEnvelope(proposalId,developer,db);
  assert.throws(()=>authorizeExecutionEnvelope(envelope.envelopeId,{validForSeconds:120},developer,db),/AUTHORIZATION_DENIED/);
  const result=authorizeExecutionEnvelope(envelope.envelopeId,{validForSeconds:120},owner,db);
  assert.equal(result.envelope.status,"AUTHORIZED");
  assert.equal(result.executionPerformed,false);
  assert.ok(Date.parse(result.envelope.expiresAt!)>Date.parse(result.envelope.authorizedAt!));
  assert.deepEqual(listExecutionEnvelopeHistory(envelope.envelopeId,db).map(x=>x.status),["PREPARED","AUTHORIZED"]);
  assert.deepEqual(db.prepare("SELECT version,title FROM knowledge_objects WHERE id='knowledge-1'").get(),{version:1,title:"Initial"});
  db.close();
});

test("preflight rejects stale targets after the accepted decision",()=>{
  const {db,base,signalId}=setup();
  const next=nextKnowledge(base);
  const proposalId=acceptedKnowledgeProposal(db,signalId,next);
  evolveKnowledge(next,owner,db);
  assert.throws(()=>prepareExecutionEnvelope(proposalId,developer,db),/EXECUTION_TARGET_STALE/);
  db.close();
});

test("preflight denies a new published version that still cites the revoked source version",()=>{
  const {db,base,signalId}=setup();
  const proposalId=acceptedKnowledgeProposal(db,signalId,nextKnowledge(base,1));
  assert.throws(()=>prepareExecutionEnvelope(proposalId,developer,db),/EXECUTION_REVOKED_SOURCE_DENIED/);
  db.close();
});

test("NO_CHANGE and ESCALATE-style decisions are not executable envelopes",()=>{
  const {db,base,signalId}=setup();
  const proposalId=acceptedKnowledgeProposal(db,signalId,nextKnowledge(base),"NO_CHANGE");
  assert.throws(()=>prepareExecutionEnvelope(proposalId,developer,db),/REMEDIATION_PROPOSAL_NOT_EXECUTABLE/);
  db.close();
});

test("resolved review signal invalidates an already prepared envelope before authorization",()=>{
  const {db,base,signalId}=setup();
  const proposalId=acceptedKnowledgeProposal(db,signalId,nextKnowledge(base));
  const envelope=prepareExecutionEnvelope(proposalId,developer,db);
  transitionReviewSignal(signalId,"ACKNOWLEDGED",reviewerA,db);
  transitionReviewSignal(signalId,"RESOLVED",reviewerA,db);
  assert.throws(()=>authorizeExecutionEnvelope(envelope.envelopeId,{validForSeconds:300},owner,db),/REVIEW_SIGNAL_RESOLVED/);
  db.close();
});

test("execution envelope history is append-only and cancellation is terminal for this slice",()=>{
  const {db,base,signalId}=setup();
  const proposalId=acceptedKnowledgeProposal(db,signalId,nextKnowledge(base));
  const envelope=prepareExecutionEnvelope(proposalId,developer,db);
  authorizeExecutionEnvelope(envelope.envelopeId,{validForSeconds:300},owner,db);
  const cancelled=cancelExecutionEnvelope(envelope.envelopeId,owner,db);
  assert.equal(cancelled.status,"CANCELLED");
  assert.throws(()=>authorizeExecutionEnvelope(envelope.envelopeId,{validForSeconds:300},owner,db),/EXECUTION_ENVELOPE_NOT_PREPARED/);
  assert.throws(()=>db.prepare("UPDATE remediation_execution_envelopes SET status='CONSUMED'").run(),/REMEDIATION_EXECUTION_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM remediation_execution_envelopes").run(),/REMEDIATION_EXECUTION_APPEND_ONLY/);
  db.close();
});

test("prepare and authorize actions are audited with proposal and payload-hash provenance",()=>{
  const {db,base,signalId}=setup();
  const proposalId=acceptedKnowledgeProposal(db,signalId,nextKnowledge(base));
  const envelope=prepareExecutionEnvelope(proposalId,developer,db);
  authorizeExecutionEnvelope(envelope.envelopeId,{validForSeconds:300},owner,db);
  const rows=db.prepare("SELECT action,provenance_refs_json AS refs FROM audit_events WHERE action LIKE 'REMEDIATION_EXECUTION_%' ORDER BY timestamp,event_id").all() as Array<{action:string;refs:string}>;
  assert.deepEqual(rows.map(x=>x.action),["REMEDIATION_EXECUTION_PREPARE","REMEDIATION_EXECUTION_AUTHORIZE"]);
  assert.ok(rows.every(x=>JSON.parse(x.refs).includes(envelope.payloadHash)));
  db.close();
});
