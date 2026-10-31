import assert from "node:assert/strict";
import {test} from "node:test";
import Database from "better-sqlite3";
import {applyMigrations} from "../src/lib/sqlite";
import {createCaseKnowledgeTransaction} from "../src/lib/transaction";
import {recordImpactSignals,transitionReviewSignal} from "../src/lib/impact-analysis";
import {transitionSourceState} from "../src/lib/source-ledger";
import {
  claimRemediationWork,
  decideRemediationProposal,
  listRemediationProposalHistory,
  listRemediationQueue,
  listRemediationWorkHistory,
  materializeRemediationWork,
  submitRemediationProposal
} from "../src/lib/remediation";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
const reviewerA:ActorContext={actorId:"reviewer-a",role:"REVIEWER",authentication:"TEST"};
const reviewerB:ActorContext={actorId:"reviewer-b",role:"REVIEWER",authentication:"TEST"};
const user:ActorContext={actorId:"user-1",role:"USER",authentication:"TEST"};

function fixture(){
  const db=new Database(":memory:");
  applyMigrations(db);
  const createdAt="2026-10-31T07:00:00.000Z";
  createCaseKnowledgeTransaction({
    case:{id:"case-1",title:"Case",objective:"Remediation test",status:"ACTIVE",createdAt},
    knowledge:{
      id:"knowledge-1",caseId:"case-1",title:"Initial",content:"v1",status:"PUBLISHED",version:1,
      sources:[{sourceId:"source-1",version:1,provenance:"VERIFIED"}],createdAt
    },
    source:{id:"source-1",uri:"https://example.test/source-1",title:"Source 1",version:1,checksum:"sum-1",createdAt},
    provenance:{id:"prov-1",status:"VERIFIED",createdAt}
  },owner,db);
  transitionSourceState({sourceId:"source-1",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  const recorded=recordImpactSignals({causeKind:"SOURCE_REVOKED",source:{id:"source-1",version:1},maxDepth:1},reviewerA,db).recorded;
  const signal=recorded.find(x=>x.targetType==="KNOWLEDGE_VERSION"&&x.targetId==="knowledge-1");
  if(!signal)throw new Error("TEST_SIGNAL_MISSING");
  return {db,signalId:signal.signalId};
}

test("review signals materialize one deterministic remediation work item",()=>{
  const {db,signalId}=fixture();
  const first=materializeRemediationWork(signalId,reviewerA,db);
  const second=materializeRemediationWork(signalId,reviewerA,db);
  assert.equal(first.workId,second.workId);
  assert.equal(first.version,1);
  assert.equal(listRemediationQueue(db).length,1);
  assert.deepEqual(listRemediationWorkHistory(first.workId,db).map(x=>x.status),["OPEN"]);
  db.close();
});

test("claim is exclusive and unauthorized users cannot mutate the queue",()=>{
  const {db,signalId}=fixture();
  assert.throws(()=>materializeRemediationWork(signalId,user,db),/AUTHORIZATION_DENIED/);
  const work=materializeRemediationWork(signalId,reviewerA,db);
  const claimed=claimRemediationWork(work.workId,reviewerA,db);
  assert.equal(claimed.status,"CLAIMED");
  assert.equal(claimed.assignee,reviewerA.actorId);
  assert.throws(()=>claimRemediationWork(work.workId,reviewerB,db),/REMEDIATION_WORK_NOT_OPEN/);
  db.close();
});

test("proposal must match target type and may only be submitted by the assignee",()=>{
  const {db,signalId}=fixture();
  const work=materializeRemediationWork(signalId,reviewerA,db);
  claimRemediationWork(work.workId,reviewerA,db);
  assert.throws(()=>submitRemediationProposal(work.workId,{proposalType:"RELATION_REVOKE",payload:{},rationale:"wrong target"},reviewerA,db),/REMEDIATION_PROPOSAL_TARGET_MISMATCH/);
  assert.throws(()=>submitRemediationProposal(work.workId,{proposalType:"KNOWLEDGE_EVOLUTION",payload:{title:"v2"},rationale:"review"},reviewerB,db),/REMEDIATION_ASSIGNEE_MISMATCH/);
  const proposal=submitRemediationProposal(work.workId,{proposalType:"KNOWLEDGE_EVOLUTION",payload:{title:"v2"},rationale:"source withdrawn"},reviewerA,db);
  assert.equal(proposal.status,"PROPOSED");
  assert.equal(proposal.targetId,"knowledge-1");
  assert.equal(proposal.baseVersion,1);
  const current=db.prepare("SELECT version,title FROM knowledge_objects WHERE id='knowledge-1'").get() as {version:number;title:string};
  assert.deepEqual(current,{version:1,title:"Initial"});
  db.close();
});

test("proposal decision requires separation of duties and still performs no execution",()=>{
  const {db,signalId}=fixture();
  const work=materializeRemediationWork(signalId,reviewerA,db);
  claimRemediationWork(work.workId,reviewerA,db);
  const proposal=submitRemediationProposal(work.workId,{proposalType:"KNOWLEDGE_EVOLUTION",payload:{title:"v2"},rationale:"replace affected knowledge"},reviewerA,db);
  assert.throws(()=>decideRemediationProposal(proposal.proposalId,{decision:"ACCEPTED",note:"self approve"},reviewerA,db),/REMEDIATION_SEPARATION_OF_DUTIES/);
  const decision=decideRemediationProposal(proposal.proposalId,{decision:"ACCEPTED",note:"independent review complete"},reviewerB,db);
  assert.equal(decision.proposal.status,"ACCEPTED");
  assert.equal(decision.executionPerformed,false);
  assert.equal(decision.work.status,"DECIDED");
  assert.deepEqual(listRemediationProposalHistory(proposal.proposalId,db).map(x=>x.status),["PROPOSED","ACCEPTED"]);
  assert.deepEqual(listRemediationWorkHistory(work.workId,db).map(x=>x.status),["OPEN","CLAIMED","PROPOSED","DECIDED"]);
  const knowledge=db.prepare("SELECT version,title FROM knowledge_objects WHERE id='knowledge-1'").get() as {version:number;title:string};
  assert.deepEqual(knowledge,{version:1,title:"Initial"});
  const signal=db.prepare("SELECT status FROM review_signals WHERE signal_id=? ORDER BY version DESC LIMIT 1").get(signalId) as {status:string};
  assert.equal(signal.status,"OPEN");
  db.close();
});

test("resolved review signals block stale remediation work",()=>{
  const {db,signalId}=fixture();
  const work=materializeRemediationWork(signalId,reviewerA,db);
  transitionReviewSignal(signalId,"ACKNOWLEDGED",reviewerA,db);
  transitionReviewSignal(signalId,"RESOLVED",reviewerA,db);
  assert.throws(()=>claimRemediationWork(work.workId,reviewerA,db),/REVIEW_SIGNAL_RESOLVED/);
  db.close();
});

test("remediation history is append-only at the database boundary",()=>{
  const {db,signalId}=fixture();
  const work=materializeRemediationWork(signalId,reviewerA,db);
  claimRemediationWork(work.workId,reviewerA,db);
  const proposal=submitRemediationProposal(work.workId,{proposalType:"NO_CHANGE",payload:{},rationale:"evidence remains sufficient"},reviewerA,db);
  assert.throws(()=>db.prepare("UPDATE remediation_work_items SET status='DECIDED'").run(),/REMEDIATION_WORK_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM remediation_work_items").run(),/REMEDIATION_WORK_APPEND_ONLY/);
  assert.throws(()=>db.prepare("UPDATE remediation_proposals SET status='ACCEPTED' WHERE proposal_id=?").run(proposal.proposalId),/REMEDIATION_PROPOSAL_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM remediation_proposals").run(),/REMEDIATION_PROPOSAL_APPEND_ONLY/);
  db.close();
});

test("remediation actions are audited without downstream mutation",()=>{
  const {db,signalId}=fixture();
  const work=materializeRemediationWork(signalId,reviewerA,db);
  claimRemediationWork(work.workId,reviewerA,db);
  const proposal=submitRemediationProposal(work.workId,{proposalType:"NO_CHANGE",payload:{},rationale:"no change required"},reviewerA,db);
  decideRemediationProposal(proposal.proposalId,{decision:"REJECTED",note:"insufficient rationale"},reviewerB,db);
  const actions=(db.prepare("SELECT action FROM audit_events WHERE action LIKE 'REMEDIATION_%' ORDER BY timestamp,event_id").all() as Array<{action:string}>).map(x=>x.action);
  assert.ok(actions.includes("REMEDIATION_WORK_CREATE"));
  assert.ok(actions.includes("REMEDIATION_WORK_CLAIM"));
  assert.ok(actions.includes("REMEDIATION_PROPOSE"));
  assert.ok(actions.includes("REMEDIATION_DECIDE_REJECT"));
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM knowledge_versions WHERE knowledge_id='knowledge-1'").get() as {count:number}).count,1);
  db.close();
});
