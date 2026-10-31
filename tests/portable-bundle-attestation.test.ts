import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
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
import {exportPortableClosureBundle} from "../src/lib/portable-closure-bundle";
import {
  createPortableBundleAttestation,
  portableAttestationSigningConfigFromEnv,
  signPortableClosureBundle,
  verifyPortableBundleAttestation
} from "../src/lib/portable-bundle-attestation";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
const developer:ActorContext={actorId:"dev-1",role:"DEVELOPER",authentication:"TEST"};
const reviewerA:ActorContext={actorId:"reviewer-a",role:"REVIEWER",authentication:"TEST"};
const reviewerB:ActorContext={actorId:"reviewer-b",role:"REVIEWER",authentication:"TEST"};

function keys(){
  const pair=generateKeyPairSync("ed25519");
  return {
    privateKeyPem:pair.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}).toString()
  };
}

function setup(){
  const db=new Database(":memory:");
  applyMigrations(db);
  const createdAt="2026-10-31T13:00:00.000Z";
  const base={
    id:"knowledge-1",caseId:"case-1",title:"Initial",content:"v1",status:"PUBLISHED" as const,version:1,
    sources:[{sourceId:"source-1",version:1,provenance:"VERIFIED" as const}],createdAt
  };
  createCaseKnowledgeTransaction({
    case:{id:"case-1",title:"Case",objective:"Attestation",status:"ACTIVE",createdAt},
    knowledge:base,
    source:{id:"source-1",uri:"https://example.test/source-1",title:"Source 1",version:1,checksum:"sum-1",createdAt},
    provenance:{id:"prov-1",status:"VERIFIED",createdAt}
  },owner,db);
  registerSourceVersion({
    id:"source-1",version:2,uri:"https://example.test/source-1/v2",title:"Source 1 v2",
    checksum:"sum-2",createdAt:"2026-10-31T13:05:00.000Z"
  },developer,db);
  transitionSourceState({sourceId:"source-1",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  const signal=recordImpactSignals({causeKind:"SOURCE_REVOKED",source:{id:"source-1",version:1},maxDepth:1},reviewerA,db).recorded
    .find(x=>x.targetType==="KNOWLEDGE_VERSION"&&x.targetId==="knowledge-1");
  if(!signal)throw new Error("TEST_SIGNAL_MISSING");
  return {db,base,signalId:signal.signalId};
}

function receipt(db:Database.Database,base:ReturnType<typeof setup>["base"],signalId:string){
  const work=materializeRemediationWork(signalId,reviewerA,db);
  claimRemediationWork(work.workId,reviewerA,db);
  const proposal=submitRemediationProposal(work.workId,{
    proposalType:"KNOWLEDGE_EVOLUTION",
    payload:{next:{...base,title:"Remediated",content:"v2",version:2,sources:[{sourceId:"source-1",version:2,provenance:"VERIFIED"}],createdAt:"2026-10-31T13:10:00.000Z"}},
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

test("trusted Ed25519 attestation verifies a valid portable bundle",()=>{
  const {db,base,signalId}=setup();
  const closed=receipt(db,base,signalId);
  const bundle=exportPortableClosureBundle(closed.receiptId,developer,db);
  const key=keys();
  const signedAt=new Date("2026-10-31T13:30:00.000Z");
  const attestation=signPortableClosureBundle(bundle,{keyId:"hq-ed25519-1",privateKeyPem:key.privateKeyPem},signedAt);
  const result=verifyPortableBundleAttestation(bundle,attestation,{
    "hq-ed25519-1":{publicKeyPem:key.publicKeyPem,status:"TRUSTED",notBefore:"2026-10-31T13:00:00.000Z",notAfter:"2026-11-01T00:00:00.000Z"}
  });
  assert.equal(result.verdict,"VALID");
  assert.equal(result.originAttestationVerified,true);
  assert.equal(result.checks.signature,true);
  assert.equal(result.checks.trustedKey,true);
  assert.equal(result.authorityGranted,false);
  assert.equal(result.substantiveTruthVerified,false);
  assert.ok(!JSON.stringify(attestation).includes("PRIVATE KEY"));
  db.close();
});

test("wrong public key fails signature/fingerprint verification",()=>{
  const {db,base,signalId}=setup();
  const closed=receipt(db,base,signalId);
  const bundle=exportPortableClosureBundle(closed.receiptId,developer,db);
  const signer=keys();
  const wrong=keys();
  const attestation=signPortableClosureBundle(bundle,{keyId:"hq-ed25519-1",privateKeyPem:signer.privateKeyPem},new Date("2026-10-31T13:30:00.000Z"));
  const result=verifyPortableBundleAttestation(bundle,attestation,{
    "hq-ed25519-1":{publicKeyPem:wrong.publicKeyPem,status:"TRUSTED"}
  });
  assert.equal(result.verdict,"INVALID");
  assert.equal(result.originAttestationVerified,false);
  assert.equal(result.checks.keyFingerprint,false);
  db.close();
});

test("cryptographically valid signature is insufficient for untrusted or revoked keys",()=>{
  const {db,base,signalId}=setup();
  const closed=receipt(db,base,signalId);
  const bundle=exportPortableClosureBundle(closed.receiptId,developer,db);
  const key=keys();
  const attestation=signPortableClosureBundle(bundle,{keyId:"hq-ed25519-1",privateKeyPem:key.privateKeyPem},new Date("2026-10-31T13:30:00.000Z"));
  const untrusted=verifyPortableBundleAttestation(bundle,attestation,{
    "hq-ed25519-1":{publicKeyPem:key.publicKeyPem,status:"UNTRUSTED"}
  });
  assert.equal(untrusted.verdict,"INVALID");
  assert.equal(untrusted.checks.signature,true);
  assert.equal(untrusted.checks.trustedKey,false);
  const revoked=verifyPortableBundleAttestation(bundle,attestation,{
    "hq-ed25519-1":{publicKeyPem:key.publicKeyPem,status:"REVOKED"}
  });
  assert.equal(revoked.verdict,"INVALID");
  assert.equal(revoked.checks.signature,true);
  assert.ok(revoked.errors.includes("ATTESTATION_KEY_REVOKED"));
  db.close();
});

test("signature outside the trusted key time window fails closed",()=>{
  const {db,base,signalId}=setup();
  const closed=receipt(db,base,signalId);
  const bundle=exportPortableClosureBundle(closed.receiptId,developer,db);
  const key=keys();
  const attestation=signPortableClosureBundle(bundle,{keyId:"hq-ed25519-1",privateKeyPem:key.privateKeyPem},new Date("2026-10-31T13:30:00.000Z"));
  const result=verifyPortableBundleAttestation(bundle,attestation,{
    "hq-ed25519-1":{publicKeyPem:key.publicKeyPem,status:"TRUSTED",notBefore:"2026-10-31T14:00:00.000Z"}
  });
  assert.equal(result.verdict,"INVALID");
  assert.equal(result.checks.temporalValidity,false);
  assert.ok(result.errors.includes("ATTESTATION_TIME_OUTSIDE_TRUST_WINDOW"));
  db.close();
});

test("owner-only attestation performs no database mutation and reviewer cannot sign",()=>{
  const {db,base,signalId}=setup();
  const closed=receipt(db,base,signalId);
  const key=keys();
  const before=(db.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as {count:number}).count;
  assert.throws(()=>createPortableBundleAttestation(closed.receiptId,reviewerA,{keyId:"hq-ed25519-1",privateKeyPem:key.privateKeyPem},db),/AUTHORIZATION_DENIED/);
  const result=createPortableBundleAttestation(closed.receiptId,owner,{keyId:"hq-ed25519-1",privateKeyPem:key.privateKeyPem},db,new Date("2026-10-31T13:30:00.000Z"));
  const after=(db.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as {count:number}).count;
  assert.equal(result.mutationPerformed,false);
  assert.equal(result.authorityEmbeddedInBundle,false);
  assert.equal(after,before);
  assert.ok(!JSON.stringify(result).includes(key.privateKeyPem));
  db.close();
});

test("non-Ed25519 private keys are rejected",()=>{
  const {db,base,signalId}=setup();
  const closed=receipt(db,base,signalId);
  const bundle=exportPortableClosureBundle(closed.receiptId,developer,db);
  const pair=generateKeyPairSync("ec",{namedCurve:"P-256"});
  const privateKeyPem=pair.privateKey.export({type:"pkcs8",format:"pem"}).toString();
  assert.throws(()=>signPortableClosureBundle(bundle,{keyId:"wrong-key",privateKeyPem}),/ATTESTATION_KEY_NOT_ED25519/);
  db.close();
});

test("server signer config is explicit and never invents key material",()=>{
  assert.throws(()=>portableAttestationSigningConfigFromEnv({}),/BUNDLE_SIGNER_NOT_CONFIGURED/);
  const key=keys();
  const escaped=key.privateKeyPem.replace(/\n/g,"\\n");
  const config=portableAttestationSigningConfigFromEnv({
    VELDGIDS_BUNDLE_SIGNING_KEY_ID:"hq-ed25519-1",
    VELDGIDS_BUNDLE_SIGNING_PRIVATE_KEY_PEM:escaped
  });
  assert.equal(config.keyId,"hq-ed25519-1");
  assert.equal(config.privateKeyPem,key.privateKeyPem);
});
