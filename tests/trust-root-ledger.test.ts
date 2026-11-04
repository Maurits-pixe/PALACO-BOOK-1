import assert from "node:assert/strict";
import {createHash,createPublicKey,generateKeyPairSync,sign as cryptoSign} from "node:crypto";
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
  compromiseRevocationAffecting,currentTrustEpoch,getTrustRootKey,registerTrustRootKey,
  retireTrustRootKey,revokeTrustRootKey,rotateTrustRootKey,trustStateAt,trustTrustRootKey
} from "../src/lib/trust-root-ledger";
import {
  createLedgerBoundPortableBundleAttestation,ledgerBoundAttestationFormat,
  verifyLedgerBoundPortableBundleAttestation
} from "../src/lib/ledger-bound-attestation";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
const developer:ActorContext={actorId:"dev-1",role:"DEVELOPER",authentication:"TEST"};
const reviewer:ActorContext={actorId:"reviewer-1",role:"REVIEWER",authentication:"TEST"};

function keys(){
  const pair=generateKeyPairSync("ed25519");
  return {
    privateKeyPem:pair.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}).toString()
  };
}
function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  const o=value as Record<string,unknown>;
  return `{${Object.keys(o).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}
function fp(publicKeyPem:string){
  return createHash("sha256").update(createPublicKey(publicKeyPem).export({type:"spki",format:"der"})).digest("hex");
}
function setupClosure(){
  const db=new Database(":memory:"); applyMigrations(db);
  const createdAt="2026-11-04T08:00:00.000Z";
  const base={id:"knowledge-1",caseId:"case-1",title:"Initial",content:"v1",status:"PUBLISHED" as const,version:1,sources:[{sourceId:"source-1",version:1,provenance:"VERIFIED" as const}],createdAt};
  createCaseKnowledgeTransaction({case:{id:"case-1",title:"Case",objective:"Trust ledger",status:"ACTIVE",createdAt},knowledge:base,source:{id:"source-1",uri:"https://example.test/source-1",title:"Source",version:1,checksum:"sum-1",createdAt},provenance:{id:"prov-1",status:"VERIFIED",createdAt}},owner,db);
  registerSourceVersion({id:"source-1",version:2,uri:"https://example.test/source-1/v2",title:"Source v2",checksum:"sum-2",createdAt:"2026-11-04T08:01:00.000Z"},developer,db);
  transitionSourceState({sourceId:"source-1",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  const signal=recordImpactSignals({causeKind:"SOURCE_REVOKED",source:{id:"source-1",version:1},maxDepth:1},reviewer,db).recorded.find(x=>x.targetType==="KNOWLEDGE_VERSION"&&x.targetId==="knowledge-1")!;
  const work=materializeRemediationWork(signal.signalId,reviewer,db); claimRemediationWork(work.workId,reviewer,db);
  const proposal=submitRemediationProposal(work.workId,{proposalType:"KNOWLEDGE_EVOLUTION",payload:{next:{...base,title:"Remediated",content:"v2",version:2,sources:[{sourceId:"source-1",version:2,provenance:"VERIFIED"}],createdAt:"2026-11-04T08:02:00.000Z"}},rationale:"replace source"},reviewer,db);
  decideRemediationProposal(proposal.proposalId,{decision:"ACCEPTED",note:"accepted"},owner,db);
  const prepared=prepareExecutionEnvelope(proposal.proposalId,developer,db); authorizeExecutionEnvelope(prepared.envelopeId,{validForSeconds:300},owner,db); consumeExecutionEnvelope(prepared.envelopeId,owner,db);
  const verification=recordPostExecutionVerification(prepared.envelopeId,reviewer,db); transitionReviewSignal(signal.signalId,"ACKNOWLEDGED",owner,db);
  const closed=closeVerifiedRemediation(verification.verificationId,"closed",reviewer,db);
  const receipt=createClosureReceipt(closed.verification.verificationId,reviewer,db);
  return {db,receipt};
}

test("trust-root lifecycle is append-only and epochs are monotone",()=>{
  const db=new Database(":memory:"); applyMigrations(db); const k=keys();
  const reg=registerTrustRootKey({keyId:"k1",publicKeyPem:k.publicKeyPem},owner,db,"2026-11-04T08:00:00Z");
  const trusted=trustTrustRootKey("k1",{reason:"activate"},owner,db,"2026-11-04T08:01:00Z");
  assert.equal(reg.event.epoch,1); assert.equal(trusted.event.epoch,2); assert.equal(currentTrustEpoch(db),2);
  assert.deepEqual(getTrustRootKey("k1",reviewer,db).history.map(x=>x.status),["REGISTERED","TRUSTED"]);
  assert.throws(()=>db.prepare("UPDATE trust_root_keys SET actor='x'").run(),/TRUST_ROOT_KEY_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM trust_root_key_events").run(),/TRUST_ROOT_EVENT_APPEND_ONLY/);
  db.close();
});

test("normal rotation preserves old epoch-bound attestation and moves signing to new key",()=>{
  const {db,receipt}=setupClosure(); const a=keys(),b=keys();
  registerTrustRootKey({keyId:"k1",publicKeyPem:a.publicKeyPem},owner,db,"2026-11-04T08:10:00Z");
  trustTrustRootKey("k1",{reason:"activate"},owner,db,"2026-11-04T08:11:00Z");
  const old=createLedgerBoundPortableBundleAttestation(receipt.receiptId,owner,{keyId:"k1",privateKeyPem:a.privateKeyPem},db,new Date("2026-11-04T08:12:00Z"));
  rotateTrustRootKey({fromKeyId:"k1",toKeyId:"k2",toPublicKeyPem:b.publicKeyPem,reason:"rotation"},owner,db,"2026-11-04T08:20:00Z");
  assert.equal(verifyLedgerBoundPortableBundleAttestation(old.bundle,old.attestation,reviewer,db).verdict,"VALID");
  assert.throws(()=>createLedgerBoundPortableBundleAttestation(receipt.receiptId,owner,{keyId:"k1",privateKeyPem:a.privateKeyPem},db,new Date("2026-11-04T08:21:00Z")),/TRUST_ROOT_KEY_NOT_TRUSTED_AT_SIGNING/);
  const fresh=createLedgerBoundPortableBundleAttestation(receipt.receiptId,owner,{keyId:"k2",privateKeyPem:b.privateKeyPem},db,new Date("2026-11-04T08:21:00Z"));
  assert.equal(verifyLedgerBoundPortableBundleAttestation(fresh.bundle,fresh.attestation,developer,db).verdict,"VALID");
  db.close();
});

test("later compromise revocation may explicitly invalidate older signatures from invalid_from",()=>{
  const {db,receipt}=setupClosure(); const a=keys(),b=keys();
  registerTrustRootKey({keyId:"k1",publicKeyPem:a.publicKeyPem},owner,db,"2026-11-04T08:10:00Z");
  trustTrustRootKey("k1",{reason:"activate"},owner,db,"2026-11-04T08:11:00Z");
  const old=createLedgerBoundPortableBundleAttestation(receipt.receiptId,owner,{keyId:"k1",privateKeyPem:a.privateKeyPem},db,new Date("2026-11-04T08:12:00Z"));
  rotateTrustRootKey({fromKeyId:"k1",toKeyId:"k2",toPublicKeyPem:b.publicKeyPem,reason:"rotate"},owner,db,"2026-11-04T08:20:00Z");
  revokeTrustRootKey("k1",{invalidFrom:"2026-11-04T08:05:00Z",reason:"compromise"},owner,db,"2026-11-04T08:30:00Z");
  const result=verifyLedgerBoundPortableBundleAttestation(old.bundle,old.attestation,reviewer,db);
  assert.equal(result.verdict,"INVALID"); assert.ok(result.errors.includes("ATTESTATION_COMPROMISE_REVOCATION"));
  assert.ok(compromiseRevocationAffecting("k1","2026-11-04T08:12:00Z",old.attestation.trustEpoch,db));
  db.close();
});

test("terminal keys never become trusted again",()=>{
  const db=new Database(":memory:"); applyMigrations(db); const k=keys();
  registerTrustRootKey({keyId:"k1",publicKeyPem:k.publicKeyPem},owner,db,"2026-11-04T08:00:00Z");
  trustTrustRootKey("k1",{reason:"activate"},owner,db,"2026-11-04T08:01:00Z");
  retireTrustRootKey("k1",{reason:"retire"},owner,db,"2026-11-04T08:02:00Z");
  assert.throws(()=>trustTrustRootKey("k1",{reason:"reactivate"},owner,db,"2026-11-04T08:03:00Z"),/TRUST_ROOT_TRANSITION_DENIED/);
  revokeTrustRootKey("k1",{invalidFrom:"2026-11-04T08:02:00Z",reason:"compromised"},owner,db,"2026-11-04T08:04:00Z");
  assert.throws(()=>trustTrustRootKey("k1",{reason:"reactivate"},owner,db,"2026-11-04T08:05:00Z"),/TRUST_ROOT_TRANSITION_DENIED/);
  db.close();
});

test("duplicate fingerprint rotation rolls back and leaves source key trusted",()=>{
  const db=new Database(":memory:"); applyMigrations(db); const k=keys();
  registerTrustRootKey({keyId:"k1",publicKeyPem:k.publicKeyPem},owner,db,"2026-11-04T08:00:00Z");
  trustTrustRootKey("k1",{reason:"activate"},owner,db,"2026-11-04T08:01:00Z");
  assert.throws(()=>rotateTrustRootKey({fromKeyId:"k1",toKeyId:"k2",toPublicKeyPem:k.publicKeyPem,reason:"bad rotate"},owner,db,"2026-11-04T08:02:00Z"));
  assert.equal(getTrustRootKey("k1",reviewer,db).history.at(-1)?.status,"TRUSTED");
  assert.equal(currentTrustEpoch(db),2);
  db.close();
});

test("backdated trust is denied and reviewer cannot write trust state",()=>{
  const db=new Database(":memory:"); applyMigrations(db); const k=keys();
  registerTrustRootKey({keyId:"k1",publicKeyPem:k.publicKeyPem},owner,db,"2026-11-04T08:00:00Z");
  assert.throws(()=>trustTrustRootKey("k1",{effectiveAt:"2026-11-04T07:00:00Z",reason:"backdate"},owner,db,"2026-11-04T08:01:00Z"),/TRUST_ROOT_EFFECTIVE_BACKDATE_DENIED/);
  assert.throws(()=>trustTrustRootKey("k1",{reason:"reviewer write"},reviewer,db,"2026-11-04T08:02:00Z"),/AUTHORIZATION_DENIED/);
  assert.equal(getTrustRootKey("k1",reviewer,db).history.length,1);
  db.close();
});

test("later TRUSTED event cannot retroactively legitimize an attestation bound to earlier REGISTERED epoch",()=>{
  const {db,receipt}=setupClosure(); const k=keys();
  const reg=registerTrustRootKey({keyId:"k1",publicKeyPem:k.publicKeyPem},owner,db,"2026-11-04T08:10:00Z");
  const bundle=exportPortableClosureBundle(receipt.receiptId,developer,db);
  const unsigned={format:ledgerBoundAttestationFormat,algorithm:"Ed25519",keyId:"k1",publicKeyFingerprint:fp(k.publicKeyPem),signedAt:"2026-11-04T08:10:30.000Z",trustEpoch:reg.event.epoch,trustKeyVersion:1,trustKeyEventEpoch:reg.event.epoch,bundleId:bundle.bundleId,bundleHash:bundle.bundleHash,snapshotHash:bundle.snapshotHash,receiptId:bundle.receipt.receiptId,originChainHash:bundle.receipt.originChainHash};
  const signature=cryptoSign(null,Buffer.from(canonicalJson(unsigned)),k.privateKeyPem).toString("base64");
  trustTrustRootKey("k1",{reason:"later trust"},owner,db,"2026-11-04T08:11:00Z");
  const result=verifyLedgerBoundPortableBundleAttestation(bundle,{...unsigned,signature},reviewer,db);
  assert.equal(result.verdict,"INVALID"); assert.equal(result.checks.historicalTrust,false);
  db.close();
});

test("trust ledger never stores private key material",()=>{
  const db=new Database(":memory:"); applyMigrations(db); const k=keys();
  registerTrustRootKey({keyId:"k1",publicKeyPem:k.publicKeyPem},owner,db,"2026-11-04T08:00:00Z");
  const dump=JSON.stringify(getTrustRootKey("k1",reviewer,db));
  assert.ok(!dump.includes("PRIVATE KEY")); assert.ok(dump.includes("PUBLIC KEY"));
  db.close();
});
