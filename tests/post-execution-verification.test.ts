import assert from "node:assert/strict";
import {test} from "node:test";
import Database from "better-sqlite3";
import {applyMigrations} from "../src/lib/sqlite";
import {createCaseKnowledgeTransaction} from "../src/lib/transaction";
import {recordImpactSignals,transitionReviewSignal,listReviewSignalHistory} from "../src/lib/impact-analysis";
import {registerSourceVersion,transitionSourceState} from "../src/lib/source-ledger";
import {claimRemediationWork,decideRemediationProposal,materializeRemediationWork,submitRemediationProposal} from "../src/lib/remediation";
import {authorizeExecutionEnvelope,prepareExecutionEnvelope} from "../src/lib/execution-envelope";
import {consumeExecutionEnvelope} from "../src/lib/remediation-executor";
import {evolveKnowledge} from "../src/lib/knowledge-history";
import {
  closeVerifiedRemediation,
  listPostExecutionVerificationHistory,
  recordPostExecutionVerification
} from "../src/lib/post-execution-verification";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
const developer:ActorContext={actorId:"dev-1",role:"DEVELOPER",authentication:"TEST"};
const reviewerA:ActorContext={actorId:"reviewer-a",role:"REVIEWER",authentication:"TEST"};
const reviewerB:ActorContext={actorId:"reviewer-b",role:"REVIEWER",authentication:"TEST"};

function setup(){
  const db=new Database(":memory:");
  applyMigrations(db);
  const createdAt="2026-10-31T10:00:00.000Z";
  const base={
    id:"knowledge-1",caseId:"case-1",title:"Initial",content:"v1",status:"PUBLISHED" as const,version:1,
    sources:[{sourceId:"source-1",version:1,provenance:"VERIFIED" as const}],createdAt
  };
  createCaseKnowledgeTransaction({
    case:{id:"case-1",title:"Case",objective:"Verification",status:"ACTIVE",createdAt},
    knowledge:base,
    source:{id:"source-1",uri:"https://example.test/source-1",title:"Source 1",version:1,checksum:"sum-1",createdAt},
    provenance:{id:"prov-1",status:"VERIFIED",createdAt}
  },owner,db);
  registerSourceVersion({
    id:"source-1",version:2,uri:"https://example.test/source-1/v2",title:"Source 1 v2",
    checksum:"sum-2",createdAt:"2026-10-31T10:05:00.000Z"
  },developer,db);
  transitionSourceState({sourceId:"source-1",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  const signal=recordImpactSignals({causeKind:"SOURCE_REVOKED",source:{id:"source-1",version:1},maxDepth:1},reviewerA,db).recorded
    .find(x=>x.targetType==="KNOWLEDGE_VERSION"&&x.targetId==="knowledge-1");
  if(!signal)throw new Error("TEST_SIGNAL_MISSING");
  return {db,base,signalId:signal.signalId};
}

function nextKnowledge(base:ReturnType<typeof setup>["base"],version=2,title="Remediated"){
  return {
    ...base,title,content:`v${version}`,version,
    sources:[{sourceId:"source-1",version:2,provenance:"VERIFIED" as const}],
    createdAt:`2026-10-31T10:${version===2?"10":"20"}:00.000Z`
  };
}

function execute(db:Database.Database,base:ReturnType<typeof setup>["base"],signalId:string){
  const work=materializeRemediationWork(signalId,reviewerA,db);
  claimRemediationWork(work.workId,reviewerA,db);
  const proposal=submitRemediationProposal(work.workId,{
    proposalType:"KNOWLEDGE_EVOLUTION",payload:{next:nextKnowledge(base)},rationale:"replace revoked source"
  },reviewerA,db);
  decideRemediationProposal(proposal.proposalId,{decision:"ACCEPTED",note:"independent decision"},reviewerB,db);
  const prepared=prepareExecutionEnvelope(proposal.proposalId,developer,db);
  authorizeExecutionEnvelope(prepared.envelopeId,{validForSeconds:300},owner,db);
  const consumed=consumeExecutionEnvelope(prepared.envelopeId,owner,db).envelope;
  return consumed;
}

test("post-execution verification records MATCH without resolving the review signal",()=>{
  const {db,base,signalId}=setup();
  const consumed=execute(db,base,signalId);
  const verification=recordPostExecutionVerification(consumed.envelopeId,reviewerA,db);
  assert.equal(verification.verdict,"MATCH");
  assert.equal(verification.status,"RECORDED");
  assert.equal((verification.evidence as any).stateMatches,true);
  assert.equal((verification.evidence as any).mutationAuditPresent,true);
  assert.equal((verification.evidence as any).consumeAuditPresent,true);
  assert.equal(listReviewSignalHistory(signalId,db).at(-1)?.status,"OPEN");
  db.close();
});

test("executor cannot verify or close its own consumed execution",()=>{
  const {db,base,signalId}=setup();
  const consumed=execute(db,base,signalId);
  assert.throws(()=>recordPostExecutionVerification(consumed.envelopeId,owner,db),/VERIFICATION_EXECUTOR_SEPARATION_REQUIRED/);
  const verification=recordPostExecutionVerification(consumed.envelopeId,reviewerA,db);
  transitionReviewSignal(signalId,"ACKNOWLEDGED",reviewerA,db);
  assert.throws(()=>closeVerifiedRemediation(verification.verificationId,"owner self close",owner,db),/CLOSURE_EXECUTOR_SEPARATION_REQUIRED/);
  db.close();
});

test("executed remediation cannot be resolved directly without a closed MATCH verification",()=>{
  const {db,base,signalId}=setup();
  execute(db,base,signalId);
  transitionReviewSignal(signalId,"ACKNOWLEDGED",reviewerA,db);
  assert.throws(()=>transitionReviewSignal(signalId,"RESOLVED",reviewerA,db),/POST_EXECUTION_VERIFICATION_REQUIRED/);
  assert.equal(listReviewSignalHistory(signalId,db).at(-1)?.status,"ACKNOWLEDGED");
  db.close();
});

test("closure requires acknowledgement even after MATCH",()=>{
  const {db,base,signalId}=setup();
  const consumed=execute(db,base,signalId);
  const verification=recordPostExecutionVerification(consumed.envelopeId,reviewerA,db);
  assert.throws(()=>closeVerifiedRemediation(verification.verificationId,"close too early",reviewerA,db),/REVIEW_SIGNAL_ACK_REQUIRED/);
  assert.equal(listPostExecutionVerificationHistory(verification.verificationId,db).at(-1)?.status,"RECORDED");
  db.close();
});

test("MATCH plus explicit acknowledgement allows closure and resolves the signal atomically",()=>{
  const {db,base,signalId}=setup();
  const consumed=execute(db,base,signalId);
  const verification=recordPostExecutionVerification(consumed.envelopeId,reviewerA,db);
  transitionReviewSignal(signalId,"ACKNOWLEDGED",reviewerB,db);
  const result=closeVerifiedRemediation(verification.verificationId,"state and audit evidence verified",reviewerA,db);
  assert.equal(result.verification.status,"CLOSED");
  assert.equal(result.reviewSignal.status,"RESOLVED");
  assert.deepEqual(listPostExecutionVerificationHistory(verification.verificationId,db).map(x=>x.status),["RECORDED","CLOSED"]);
  assert.deepEqual(listReviewSignalHistory(signalId,db).map(x=>x.status),["OPEN","ACKNOWLEDGED","RESOLVED"]);
  db.close();
});

test("state drift after execution is recorded as MISMATCH and cannot close",()=>{
  const {db,base,signalId}=setup();
  const consumed=execute(db,base,signalId);
  evolveKnowledge(nextKnowledge({...base,title:"Remediated",content:"v2",version:2,sources:[{sourceId:"source-1",version:2,provenance:"VERIFIED" as const}],createdAt:"2026-10-31T10:10:00.000Z"},3,"Later edit"),owner,db);
  const verification=recordPostExecutionVerification(consumed.envelopeId,reviewerA,db);
  assert.equal(verification.verdict,"MISMATCH");
  assert.equal(verification.observedVersion,3);
  transitionReviewSignal(signalId,"ACKNOWLEDGED",reviewerB,db);
  assert.throws(()=>closeVerifiedRemediation(verification.verificationId,"should fail",reviewerA,db),/VERIFICATION_MATCH_REQUIRED/);
  assert.equal(listReviewSignalHistory(signalId,db).at(-1)?.status,"ACKNOWLEDGED");
  db.close();
});


test("a previously matching verification cannot close after later target drift",()=>{
  const {db,base,signalId}=setup();
  const consumed=execute(db,base,signalId);
  const verification=recordPostExecutionVerification(consumed.envelopeId,reviewerA,db);
  assert.equal(verification.verdict,"MATCH");
  evolveKnowledge(nextKnowledge({...base,title:"Remediated",content:"v2",version:2,sources:[{sourceId:"source-1",version:2,provenance:"VERIFIED" as const}],createdAt:"2026-10-31T10:10:00.000Z"},3,"Later edit"),owner,db);
  transitionReviewSignal(signalId,"ACKNOWLEDGED",reviewerB,db);
  assert.throws(()=>closeVerifiedRemediation(verification.verificationId,"stale match must not close",reviewerA,db),/VERIFICATION_STALE_AT_CLOSURE/);
  assert.equal(listPostExecutionVerificationHistory(verification.verificationId,db).at(-1)?.status,"RECORDED");
  assert.equal(listReviewSignalHistory(signalId,db).at(-1)?.status,"ACKNOWLEDGED");
  db.close();
});

test("verification ledger is append-only",()=>{
  const {db,base,signalId}=setup();
  const consumed=execute(db,base,signalId);
  const verification=recordPostExecutionVerification(consumed.envelopeId,reviewerA,db);
  assert.throws(()=>db.prepare("UPDATE remediation_verifications SET verdict='MISMATCH'").run(),/REMEDIATION_VERIFICATION_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM remediation_verifications").run(),/REMEDIATION_VERIFICATION_APPEND_ONLY/);
  assert.equal(listPostExecutionVerificationHistory(verification.verificationId,db).length,1);
  db.close();
});

test("late signal-resolution audit failure rolls back verification closure and signal resolution",()=>{
  const {db,base,signalId}=setup();
  const consumed=execute(db,base,signalId);
  const verification=recordPostExecutionVerification(consumed.envelopeId,reviewerA,db);
  transitionReviewSignal(signalId,"ACKNOWLEDGED",reviewerB,db);
  db.exec(`
    CREATE TRIGGER fail_signal_resolve_audit
    BEFORE INSERT ON audit_events
    WHEN NEW.action='IMPACT_SIGNAL_RESOLVE'
    BEGIN SELECT RAISE(ABORT,'FORCED_SIGNAL_RESOLVE_AUDIT_FAILURE'); END;
  `);
  assert.throws(()=>closeVerifiedRemediation(verification.verificationId,"atomic closure",reviewerA,db),/FORCED_SIGNAL_RESOLVE_AUDIT_FAILURE/);
  assert.equal(listPostExecutionVerificationHistory(verification.verificationId,db).at(-1)?.status,"RECORDED");
  assert.equal(listReviewSignalHistory(signalId,db).at(-1)?.status,"ACKNOWLEDGED");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='REMEDIATION_VERIFICATION_CLOSE'").get() as {count:number}).count,0);
  db.close();
});
