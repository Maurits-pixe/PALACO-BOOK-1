import assert from "node:assert/strict";
import {test} from "node:test";
import Database from "better-sqlite3";
import {applyMigrations} from "../src/lib/sqlite";
import {createCaseKnowledgeTransaction} from "../src/lib/transaction";
import {recordImpactSignals,transitionReviewSignal} from "../src/lib/impact-analysis";
import {registerSourceVersion,transitionSourceState} from "../src/lib/source-ledger";
import {claimRemediationWork,decideRemediationProposal,materializeRemediationWork,submitRemediationProposal} from "../src/lib/remediation";
import {authorizeExecutionEnvelope,prepareExecutionEnvelope} from "../src/lib/execution-envelope";
import {consumeExecutionEnvelope} from "../src/lib/remediation-executor";
import {closeVerifiedRemediation,recordPostExecutionVerification} from "../src/lib/post-execution-verification";
import {createClosureReceipt,getClosureReceipt,replayClosureReceipt} from "../src/lib/closure-receipt";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
const developer:ActorContext={actorId:"dev-1",role:"DEVELOPER",authentication:"TEST"};
const reviewerA:ActorContext={actorId:"reviewer-a",role:"REVIEWER",authentication:"TEST"};
const reviewerB:ActorContext={actorId:"reviewer-b",role:"REVIEWER",authentication:"TEST"};

function setup(){
  const db=new Database(":memory:");
  applyMigrations(db);
  const createdAt="2026-10-31T11:00:00.000Z";
  const base={
    id:"knowledge-1",caseId:"case-1",title:"Initial",content:"v1",status:"PUBLISHED" as const,version:1,
    sources:[{sourceId:"source-1",version:1,provenance:"VERIFIED" as const}],createdAt
  };
  createCaseKnowledgeTransaction({
    case:{id:"case-1",title:"Case",objective:"Closure receipt",status:"ACTIVE",createdAt},
    knowledge:base,
    source:{id:"source-1",uri:"https://example.test/source-1",title:"Source 1",version:1,checksum:"sum-1",createdAt},
    provenance:{id:"prov-1",status:"VERIFIED",createdAt}
  },owner,db);
  registerSourceVersion({
    id:"source-1",version:2,uri:"https://example.test/source-1/v2",title:"Source 1 v2",
    checksum:"sum-2",createdAt:"2026-10-31T11:05:00.000Z"
  },developer,db);
  transitionSourceState({sourceId:"source-1",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  const signal=recordImpactSignals({causeKind:"SOURCE_REVOKED",source:{id:"source-1",version:1},maxDepth:1},reviewerA,db).recorded
    .find(x=>x.targetType==="KNOWLEDGE_VERSION"&&x.targetId==="knowledge-1");
  if(!signal)throw new Error("TEST_SIGNAL_MISSING");
  return {db,base,signalId:signal.signalId};
}

function nextKnowledge(base:ReturnType<typeof setup>["base"]){
  return {
    ...base,title:"Remediated",content:"v2",version:2,
    sources:[{sourceId:"source-1",version:2,provenance:"VERIFIED" as const}],
    createdAt:"2026-10-31T11:10:00.000Z"
  };
}

function executeAndVerify(db:Database.Database,base:ReturnType<typeof setup>["base"],signalId:string){
  const work=materializeRemediationWork(signalId,reviewerA,db);
  claimRemediationWork(work.workId,reviewerA,db);
  const proposal=submitRemediationProposal(work.workId,{
    proposalType:"KNOWLEDGE_EVOLUTION",payload:{next:nextKnowledge(base)},rationale:"replace withdrawn source"
  },reviewerA,db);
  decideRemediationProposal(proposal.proposalId,{decision:"ACCEPTED",note:"independent decision"},reviewerB,db);
  const prepared=prepareExecutionEnvelope(proposal.proposalId,developer,db);
  authorizeExecutionEnvelope(prepared.envelopeId,{validForSeconds:300},owner,db);
  consumeExecutionEnvelope(prepared.envelopeId,owner,db);
  return recordPostExecutionVerification(prepared.envelopeId,reviewerA,db);
}

function closeChain(db:Database.Database,base:ReturnType<typeof setup>["base"],signalId:string){
  const verification=executeAndVerify(db,base,signalId);
  transitionReviewSignal(signalId,"ACKNOWLEDGED",reviewerB,db);
  const closed=closeVerifiedRemediation(verification.verificationId,"verified remediation closed",reviewerA,db);
  return closed.verification;
}

test("closed remediation seals one causal closure receipt",()=>{
  const {db,base,signalId}=setup();
  const verification=closeChain(db,base,signalId);
  const receipt=createClosureReceipt(verification.verificationId,reviewerA,db);
  assert.equal(receipt.verificationVersion,2);
  assert.equal(receipt.signalVersion,3);
  assert.equal(receipt.workVersion,4);
  assert.equal(receipt.proposalVersion,2);
  assert.equal(receipt.envelopeVersion,3);
  assert.equal(receipt.targetVersion,2);
  assert.equal(receipt.chainHash.length,64);
  const snapshot=receipt.snapshot as any;
  assert.equal(snapshot.schemaVersion,"veldgids.closure-receipt.v1");
  assert.equal(snapshot.signal.status,"RESOLVED");
  assert.equal(snapshot.work.status,"DECIDED");
  assert.equal(snapshot.proposal.status,"ACCEPTED");
  assert.equal(snapshot.envelope.status,"CONSUMED");
  assert.equal(snapshot.verification.status,"CLOSED");
  assert.equal(snapshot.verification.verdict,"MATCH");
  assert.equal(snapshot.audits.length,12);
  db.close();
});

test("receipt creation is idempotent and seal audit is written once",()=>{
  const {db,base,signalId}=setup();
  const verification=closeChain(db,base,signalId);
  const first=createClosureReceipt(verification.verificationId,reviewerA,db);
  const second=createClosureReceipt(verification.verificationId,owner,db);
  assert.equal(first.receiptId,second.receiptId);
  assert.equal(first.chainHash,second.chainHash);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM remediation_closure_receipts").get() as {count:number}).count,1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='CLOSURE_RECEIPT_SEAL'").get() as {count:number}).count,1);
  db.close();
});

test("replay is VALID and does not mutate any ledger",()=>{
  const {db,base,signalId}=setup();
  const verification=closeChain(db,base,signalId);
  const receipt=createClosureReceipt(verification.verificationId,reviewerA,db);
  const before={
    audits:(db.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as {count:number}).count,
    receipts:(db.prepare("SELECT COUNT(*) AS count FROM remediation_closure_receipts").get() as {count:number}).count,
    verifications:(db.prepare("SELECT COUNT(*) AS count FROM remediation_verifications").get() as {count:number}).count,
    signals:(db.prepare("SELECT COUNT(*) AS count FROM review_signals").get() as {count:number}).count
  };
  const replay=replayClosureReceipt(receipt.receiptId,developer,db);
  assert.equal(replay.verdict,"VALID");
  assert.equal(replay.mutationPerformed,false);
  assert.deepEqual(replay.checks,{storedHashMatchesSnapshot:true,currentSnapshotMatchesStored:true,sealAuditPresent:true});
  const after={
    audits:(db.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as {count:number}).count,
    receipts:(db.prepare("SELECT COUNT(*) AS count FROM remediation_closure_receipts").get() as {count:number}).count,
    verifications:(db.prepare("SELECT COUNT(*) AS count FROM remediation_verifications").get() as {count:number}).count,
    signals:(db.prepare("SELECT COUNT(*) AS count FROM review_signals").get() as {count:number}).count
  };
  assert.deepEqual(after,before);
  db.close();
});

test("developer may read and replay but cannot seal a closure receipt",()=>{
  const {db,base,signalId}=setup();
  const verification=closeChain(db,base,signalId);
  assert.throws(()=>createClosureReceipt(verification.verificationId,developer,db),/AUTHORIZATION_DENIED/);
  const receipt=createClosureReceipt(verification.verificationId,reviewerA,db);
  assert.equal(getClosureReceipt(receipt.receiptId,developer,db).chainHash,receipt.chainHash);
  assert.equal(replayClosureReceipt(receipt.receiptId,developer,db).verdict,"VALID");
  db.close();
});

test("receipt cannot be sealed before MATCH verification is CLOSED",()=>{
  const {db,base,signalId}=setup();
  const verification=executeAndVerify(db,base,signalId);
  assert.equal(verification.status,"RECORDED");
  assert.throws(()=>createClosureReceipt(verification.verificationId,reviewerA,db),/CLOSURE_RECEIPT_REQUIRES_CLOSED_MATCH/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM remediation_closure_receipts").get() as {count:number}).count,0);
  db.close();
});

test("closure receipts are append-only at the database boundary",()=>{
  const {db,base,signalId}=setup();
  const verification=closeChain(db,base,signalId);
  createClosureReceipt(verification.verificationId,reviewerA,db);
  assert.throws(()=>db.prepare("UPDATE remediation_closure_receipts SET chain_hash='tampered'").run(),/CLOSURE_RECEIPT_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM remediation_closure_receipts").run(),/CLOSURE_RECEIPT_APPEND_ONLY/);
  db.close();
});

test("late seal-audit failure rolls back receipt creation atomically",()=>{
  const {db,base,signalId}=setup();
  const verification=closeChain(db,base,signalId);
  db.exec(`
    CREATE TRIGGER fail_closure_receipt_seal
    BEFORE INSERT ON audit_events
    WHEN NEW.action='CLOSURE_RECEIPT_SEAL'
    BEGIN SELECT RAISE(ABORT,'FORCED_CLOSURE_RECEIPT_SEAL_FAILURE'); END;
  `);
  assert.throws(()=>createClosureReceipt(verification.verificationId,reviewerA,db),/FORCED_CLOSURE_RECEIPT_SEAL_FAILURE/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM remediation_closure_receipts").get() as {count:number}).count,0);
  db.close();
});

test("replay rejects a forged receipt without changing state",()=>{
  const {db,base,signalId}=setup();
  const verification=closeChain(db,base,signalId);
  const row=db.prepare(`
    SELECT v.verification_id AS verificationId,v.version AS verificationVersion,
      s.signal_id AS signalId,s.version AS signalVersion,
      w.work_id AS workId,w.version AS workVersion,
      p.proposal_id AS proposalId,p.version AS proposalVersion,
      e.envelope_id AS envelopeId,e.version AS envelopeVersion,
      v.target_type AS targetType,v.target_id AS targetId,v.observed_version AS targetVersion
    FROM remediation_verifications v
    JOIN review_signals s ON s.signal_id=v.signal_id
    JOIN remediation_work_items w ON w.signal_id=s.signal_id
    JOIN remediation_proposals p ON p.work_id=w.work_id
    JOIN remediation_execution_envelopes e ON e.proposal_id=p.proposal_id
    WHERE v.verification_id=?
    ORDER BY s.version DESC,w.version DESC,p.version DESC,e.version DESC LIMIT 1
  `).get(verification.verificationId) as any;
  db.prepare(`
    INSERT INTO remediation_closure_receipts(
      receipt_id,verification_id,verification_version,signal_id,signal_version,work_id,work_version,
      proposal_id,proposal_version,envelope_id,envelope_version,target_type,target_id,target_version,
      chain_hash,snapshot_json,created_at,actor
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run("receipt-forged",row.verificationId,row.verificationVersion,row.signalId,row.signalVersion,row.workId,row.workVersion,
    row.proposalId,row.proposalVersion,row.envelopeId,row.envelopeVersion,row.targetType,row.targetId,row.targetVersion,
    "bad-hash","{}","2026-10-31T11:30:00.000Z","attacker");
  const replay=replayClosureReceipt("receipt-forged",developer,db);
  assert.equal(replay.verdict,"INVALID");
  assert.equal(replay.checks.storedHashMatchesSnapshot,false);
  assert.equal(replay.checks.currentSnapshotMatchesStored,false);
  assert.equal(replay.checks.sealAuditPresent,false);
  assert.equal(replay.mutationPerformed,false);
  db.close();
});
