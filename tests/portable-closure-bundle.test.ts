import assert from "node:assert/strict";
import {createHash} from "node:crypto";
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
import {createClosureReceipt} from "../src/lib/closure-receipt";
import {exportPortableClosureBundle,validatePortableClosureBundle} from "../src/lib/portable-closure-bundle";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
const developer:ActorContext={actorId:"dev-1",role:"DEVELOPER",authentication:"TEST"};
const reviewerA:ActorContext={actorId:"reviewer-a",role:"REVIEWER",authentication:"TEST"};
const reviewerB:ActorContext={actorId:"reviewer-b",role:"REVIEWER",authentication:"TEST"};
const user:ActorContext={actorId:"user-1",role:"USER",authentication:"TEST"};

function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  const object=value as Record<string,unknown>;
  return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}
function sha256(value:unknown){return createHash("sha256").update(typeof value==="string"?value:canonicalJson(value)).digest("hex");}

function setup(){
  const db=new Database(":memory:");
  applyMigrations(db);
  const createdAt="2026-10-31T12:00:00.000Z";
  const base={
    id:"knowledge-1",caseId:"case-1",title:"Initial",content:"v1",status:"PUBLISHED" as const,version:1,
    sources:[{sourceId:"source-1",version:1,provenance:"VERIFIED" as const}],createdAt
  };
  createCaseKnowledgeTransaction({
    case:{id:"case-1",title:"Case",objective:"Portable replay",status:"ACTIVE",createdAt},
    knowledge:base,
    source:{id:"source-1",uri:"https://example.test/source-1",title:"Source 1",version:1,checksum:"sum-1",createdAt},
    provenance:{id:"prov-1",status:"VERIFIED",createdAt}
  },owner,db);
  registerSourceVersion({
    id:"source-1",version:2,uri:"https://example.test/source-1/v2",title:"Source 1 v2",
    checksum:"sum-2",createdAt:"2026-10-31T12:05:00.000Z"
  },developer,db);
  transitionSourceState({sourceId:"source-1",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  const signal=recordImpactSignals({causeKind:"SOURCE_REVOKED",source:{id:"source-1",version:1},maxDepth:1},reviewerA,db).recorded
    .find(x=>x.targetType==="KNOWLEDGE_VERSION"&&x.targetId==="knowledge-1");
  if(!signal)throw new Error("TEST_SIGNAL_MISSING");
  return {db,base,signalId:signal.signalId};
}

function closeReceipt(db:Database.Database,base:ReturnType<typeof setup>["base"],signalId:string){
  const work=materializeRemediationWork(signalId,reviewerA,db);
  claimRemediationWork(work.workId,reviewerA,db);
  const proposal=submitRemediationProposal(work.workId,{
    proposalType:"KNOWLEDGE_EVOLUTION",
    payload:{next:{...base,title:"Remediated",content:"v2",version:2,sources:[{sourceId:"source-1",version:2,provenance:"VERIFIED"}],createdAt:"2026-10-31T12:10:00.000Z"}},
    rationale:"replace withdrawn source"
  },reviewerA,db);
  decideRemediationProposal(proposal.proposalId,{decision:"ACCEPTED",note:"independent decision"},reviewerB,db);
  const prepared=prepareExecutionEnvelope(proposal.proposalId,developer,db);
  authorizeExecutionEnvelope(prepared.envelopeId,{validForSeconds:300},owner,db);
  consumeExecutionEnvelope(prepared.envelopeId,owner,db);
  const verification=recordPostExecutionVerification(prepared.envelopeId,reviewerA,db);
  transitionReviewSignal(signalId,"ACKNOWLEDGED",reviewerB,db);
  const closed=closeVerifiedRemediation(verification.verificationId,"verified closure",reviewerA,db);
  return createClosureReceipt(closed.verification.verificationId,reviewerA,db);
}

test("portable bundle exports a valid database-free causal projection",()=>{
  const {db,base,signalId}=setup();
  const receipt=closeReceipt(db,base,signalId);
  const before={
    audits:(db.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as {count:number}).count,
    receipts:(db.prepare("SELECT COUNT(*) AS count FROM remediation_closure_receipts").get() as {count:number}).count
  };
  const bundle=exportPortableClosureBundle(receipt.receiptId,developer,db);
  const result=validatePortableClosureBundle(bundle);
  assert.equal(result.verdict,"VALID");
  assert.equal(result.mutationPerformed,false);
  assert.equal(result.substantiveTruthVerified,false);
  assert.equal(result.originReceiptAuthenticityVerified,false);
  assert.equal(bundle.capabilities.authority,"NONE");
  assert.equal(bundle.capabilities.executable,false);
  assert.equal(bundle.capabilities.mutable,false);
  assert.equal(bundle.receipt.originChainHash,receipt.chainHash);
  const serialized=JSON.stringify(bundle);
  for(const forbidden of ["authorizationContext","authentication","permissions","accessToken","refreshToken","cookie","password","secret","sessionId"]){
    assert.ok(!serialized.includes(`"${forbidden}"`),forbidden);
  }
  const after={
    audits:(db.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as {count:number}).count,
    receipts:(db.prepare("SELECT COUNT(*) AS count FROM remediation_closure_receipts").get() as {count:number}).count
  };
  assert.deepEqual(after,before);
  db.close();
});

test("ordinary portable bundle tampering is detected by hashes",()=>{
  const {db,base,signalId}=setup();
  const receipt=closeReceipt(db,base,signalId);
  const bundle=exportPortableClosureBundle(receipt.receiptId,developer,db);
  const tampered=structuredClone(bundle) as any;
  tampered.snapshot.proposal.rationale="tampered rationale";
  const result=validatePortableClosureBundle(tampered);
  assert.equal(result.verdict,"INVALID");
  assert.ok(result.errors.includes("SNAPSHOT_HASH_MISMATCH"));
  assert.ok(result.errors.includes("BUNDLE_HASH_MISMATCH"));
  db.close();
});

test("rehashed causal forgery still fails semantic link validation",()=>{
  const {db,base,signalId}=setup();
  const receipt=closeReceipt(db,base,signalId);
  const forged=structuredClone(exportPortableClosureBundle(receipt.receiptId,developer,db)) as any;
  forged.snapshot.envelope.targetId="different-target";
  forged.snapshotHash=sha256(forged.snapshot);
  const {bundleHash:ignored,...withoutHash}=forged;
  forged.bundleHash=sha256(withoutHash);
  const result=validatePortableClosureBundle(forged);
  assert.equal(result.verdict,"INVALID");
  assert.equal(result.checks.snapshotHash,true);
  assert.equal(result.checks.bundleHash,true);
  assert.equal(result.checks.causalChain,false);
  assert.ok(result.errors.includes("ENVELOPE_TARGET_LINK"));
  db.close();
});

test("bundle schema rejects authority or credential material",()=>{
  const {db,base,signalId}=setup();
  const receipt=closeReceipt(db,base,signalId);
  const bundle=exportPortableClosureBundle(receipt.receiptId,developer,db) as any;
  bundle.snapshot.audits[0].authorizationContext="TEST:OWNER";
  const result=validatePortableClosureBundle(bundle);
  assert.equal(result.verdict,"INVALID");
  assert.ok(result.errors.includes("BUNDLE_SCHEMA_INVALID"));
  db.close();
});

test("user cannot export portable closure bundles",()=>{
  const {db,base,signalId}=setup();
  const receipt=closeReceipt(db,base,signalId);
  assert.throws(()=>exportPortableClosureBundle(receipt.receiptId,user,db),/AUTHORIZATION_DENIED/);
  db.close();
});

test("portable validator needs no live database and does not grant authority",()=>{
  const {db,base,signalId}=setup();
  const receipt=closeReceipt(db,base,signalId);
  const bundle=exportPortableClosureBundle(receipt.receiptId,reviewerA,db);
  db.close();
  const result=validatePortableClosureBundle(JSON.parse(JSON.stringify(bundle)));
  assert.equal(result.verdict,"VALID");
  assert.equal(result.checks.originAnchorPresent,true);
  assert.equal(result.originReceiptAuthenticityVerified,false);
  assert.equal(result.substantiveTruthVerified,false);
});

test("origin chain hash is an anchor, not independently authenticated by the portable bundle",()=>{
  const {db,base,signalId}=setup();
  const receipt=closeReceipt(db,base,signalId);
  const forged=structuredClone(exportPortableClosureBundle(receipt.receiptId,developer,db)) as any;
  forged.receipt.originChainHash="a".repeat(64);
  const {bundleHash:ignored,...withoutHash}=forged;
  forged.bundleHash=sha256(withoutHash);
  const result=validatePortableClosureBundle(forged);
  assert.equal(result.verdict,"VALID");
  assert.equal(result.originReceiptAuthenticityVerified,false);
  assert.equal(result.checks.originAnchorPresent,true);
  db.close();
});
