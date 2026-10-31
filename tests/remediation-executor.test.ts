import assert from "node:assert/strict";
import {test} from "node:test";
import Database from "better-sqlite3";
import {applyMigrations} from "../src/lib/sqlite";
import {createCaseKnowledgeTransaction} from "../src/lib/transaction";
import {recordImpactSignals} from "../src/lib/impact-analysis";
import {registerSourceVersion,transitionSourceState} from "../src/lib/source-ledger";
import {claimRemediationWork,decideRemediationProposal,materializeRemediationWork,submitRemediationProposal} from "../src/lib/remediation";
import {authorizeExecutionEnvelope,listExecutionEnvelopeHistory,prepareExecutionEnvelope} from "../src/lib/execution-envelope";
import {consumeExecutionEnvelope} from "../src/lib/remediation-executor";
import {evolveKnowledge,listKnowledgeVersions} from "../src/lib/knowledge-history";
import {createKnowledgeRelation,listKnowledgeRelationHistory} from "../src/lib/knowledge-graph";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
const developer:ActorContext={actorId:"dev-1",role:"DEVELOPER",authentication:"TEST"};
const reviewerA:ActorContext={actorId:"reviewer-a",role:"REVIEWER",authentication:"TEST"};
const reviewerB:ActorContext={actorId:"reviewer-b",role:"REVIEWER",authentication:"TEST"};

function seedKnowledge(db:Database.Database,id:string,caseId:string,sourceId:string){
  const createdAt="2026-10-31T08:30:00.000Z";
  const knowledge={
    id,caseId,title:`${id} v1`,content:"v1",status:"PUBLISHED" as const,version:1,
    sources:[{sourceId,version:1,provenance:"VERIFIED" as const}],createdAt
  };
  createCaseKnowledgeTransaction({
    case:{id:caseId,title:`Case ${id}`,objective:"Controlled execution",status:"ACTIVE",createdAt},
    knowledge,
    source:{id:sourceId,uri:`https://example.test/${sourceId}`,title:sourceId,version:1,checksum:`sum-${sourceId}-1`,createdAt},
    provenance:{id:`prov-${sourceId}`,status:"VERIFIED",createdAt}
  },owner,db);
  return knowledge;
}

function knowledgeFixture(){
  const db=new Database(":memory:");
  applyMigrations(db);
  const base=seedKnowledge(db,"knowledge-1","case-1","source-1");
  registerSourceVersion({
    id:"source-1",version:2,uri:"https://example.test/source-1/v2",title:"Source 1 v2",
    checksum:"sum-source-1-2",createdAt:"2026-10-31T08:35:00.000Z"
  },developer,db);
  transitionSourceState({sourceId:"source-1",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  const signal=recordImpactSignals({causeKind:"SOURCE_REVOKED",source:{id:"source-1",version:1},maxDepth:1},reviewerA,db).recorded
    .find(x=>x.targetType==="KNOWLEDGE_VERSION"&&x.targetId==="knowledge-1");
  if(!signal)throw new Error("TEST_SIGNAL_MISSING");
  return {db,base,signalId:signal.signalId};
}

function nextKnowledge(base:ReturnType<typeof knowledgeFixture>["base"]){
  return {
    ...base,title:"knowledge-1 v2",content:"remediated",version:2,
    sources:[{sourceId:"source-1",version:2,provenance:"VERIFIED" as const}],
    createdAt:"2026-10-31T08:40:00.000Z"
  };
}

function acceptedProposal(db:Database.Database,signalId:string,proposalType:string,payload:Record<string,unknown>){
  const work=materializeRemediationWork(signalId,reviewerA,db);
  claimRemediationWork(work.workId,reviewerA,db);
  const proposal=submitRemediationProposal(work.workId,{proposalType,payload,rationale:"controlled remediation"},reviewerA,db);
  decideRemediationProposal(proposal.proposalId,{decision:"ACCEPTED",note:"independent acceptance"},reviewerB,db);
  return proposal.proposalId;
}

function authorizedKnowledgeEnvelope(db:Database.Database,base:ReturnType<typeof knowledgeFixture>["base"],signalId:string){
  const proposalId=acceptedProposal(db,signalId,"KNOWLEDGE_EVOLUTION",{next:nextKnowledge(base)});
  const prepared=prepareExecutionEnvelope(proposalId,developer,db);
  const authorized=authorizeExecutionEnvelope(prepared.envelopeId,{validForSeconds:300},owner,db).envelope;
  return authorized;
}

test("authorized knowledge remediation consumes exactly once and leaves review signal open",()=>{
  const {db,base,signalId}=knowledgeFixture();
  const envelope=authorizedKnowledgeEnvelope(db,base,signalId);
  const result=consumeExecutionEnvelope(envelope.envelopeId,owner,db);
  assert.equal(result.executionPerformed,true);
  assert.equal(result.reviewSignalResolutionPerformed,false);
  assert.equal(result.envelope.status,"CONSUMED");
  assert.deepEqual(listExecutionEnvelopeHistory(envelope.envelopeId,db).map(x=>x.status),["PREPARED","AUTHORIZED","CONSUMED"]);
  const current=db.prepare("SELECT version,title FROM knowledge_objects WHERE id='knowledge-1'").get();
  assert.deepEqual(current,{version:2,title:"knowledge-1 v2"});
  assert.deepEqual(listKnowledgeVersions("knowledge-1",db).map(x=>x.version),[1,2]);
  const signal=db.prepare("SELECT status FROM review_signals WHERE signal_id=? ORDER BY version DESC LIMIT 1").get(signalId) as {status:string};
  assert.equal(signal.status,"OPEN");
  assert.throws(()=>consumeExecutionEnvelope(envelope.envelopeId,owner,db),/EXECUTION_ENVELOPE_ALREADY_CONSUMED/);
  assert.deepEqual(listKnowledgeVersions("knowledge-1",db).map(x=>x.version),[1,2]);
  db.close();
});

test("execution is owner-only even after an owner authorization",()=>{
  const {db,base,signalId}=knowledgeFixture();
  const envelope=authorizedKnowledgeEnvelope(db,base,signalId);
  assert.throws(()=>consumeExecutionEnvelope(envelope.envelopeId,developer,db),/AUTHORIZATION_DENIED/);
  assert.equal((db.prepare("SELECT version FROM knowledge_objects WHERE id='knowledge-1'").get() as {version:number}).version,1);
  assert.equal(listExecutionEnvelopeHistory(envelope.envelopeId,db).at(-1)?.status,"AUTHORIZED");
  db.close();
});

test("expired authorization fails closed without mutation",()=>{
  const {db,base,signalId}=knowledgeFixture();
  const proposalId=acceptedProposal(db,signalId,"KNOWLEDGE_EVOLUTION",{next:nextKnowledge(base)});
  const prepared=prepareExecutionEnvelope(proposalId,developer,db);
  const authorized=authorizeExecutionEnvelope(prepared.envelopeId,{validForSeconds:60},owner,db).envelope;
  const afterExpiry=new Date(Date.parse(authorized.expiresAt!)+1);
  assert.throws(()=>consumeExecutionEnvelope(authorized.envelopeId,owner,db,afterExpiry),/EXECUTION_AUTHORIZATION_EXPIRED/);
  assert.equal((db.prepare("SELECT version FROM knowledge_objects WHERE id='knowledge-1'").get() as {version:number}).version,1);
  assert.equal(listExecutionEnvelopeHistory(authorized.envelopeId,db).at(-1)?.status,"AUTHORIZED");
  db.close();
});

test("target drift after authorization invalidates consume",()=>{
  const {db,base,signalId}=knowledgeFixture();
  const envelope=authorizedKnowledgeEnvelope(db,base,signalId);
  evolveKnowledge(nextKnowledge(base),owner,db);
  assert.throws(()=>consumeExecutionEnvelope(envelope.envelopeId,owner,db),/EXECUTION_TARGET_STALE/);
  assert.equal(listExecutionEnvelopeHistory(envelope.envelopeId,db).at(-1)?.status,"AUTHORIZED");
  assert.deepEqual(listKnowledgeVersions("knowledge-1",db).map(x=>x.version),[1,2]);
  db.close();
});

test("late consume-audit failure rolls back mutation and CONSUMED record atomically",()=>{
  const {db,base,signalId}=knowledgeFixture();
  const envelope=authorizedKnowledgeEnvelope(db,base,signalId);
  db.exec(`
    CREATE TRIGGER fail_execution_consume_audit
    BEFORE INSERT ON audit_events
    WHEN NEW.action='REMEDIATION_EXECUTION_CONSUME'
    BEGIN SELECT RAISE(ABORT,'FORCED_CONSUME_AUDIT_FAILURE'); END;
  `);
  assert.throws(()=>consumeExecutionEnvelope(envelope.envelopeId,owner,db),/FORCED_CONSUME_AUDIT_FAILURE/);
  assert.equal((db.prepare("SELECT version FROM knowledge_objects WHERE id='knowledge-1'").get() as {version:number}).version,1);
  assert.deepEqual(listKnowledgeVersions("knowledge-1",db).map(x=>x.version),[1]);
  assert.equal(listExecutionEnvelopeHistory(envelope.envelopeId,db).at(-1)?.status,"AUTHORIZED");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='KNOWLEDGE_EVOLVE'").get() as {count:number}).count,0);
  db.close();
});

test("relation revocation dispatches through the same one-time consume gate",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  seedKnowledge(db,"A","case-a","source-a");
  seedKnowledge(db,"B","case-b","source-b");
  createKnowledgeRelation({
    relationId:"rel-ab",source:{knowledgeId:"A",version:1},target:{knowledgeId:"B",version:1},
    relationType:"supports",provenance:"VERIFIED",evidenceRefs:["source-a"]
  },owner,db);
  transitionSourceState({sourceId:"source-a",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  const signal=recordImpactSignals({causeKind:"SOURCE_REVOKED",source:{id:"source-a",version:1},maxDepth:1},reviewerA,db).recorded
    .find(x=>x.targetType==="RELATION"&&x.targetId==="rel-ab");
  if(!signal)throw new Error("RELATION_SIGNAL_MISSING");
  const proposalId=acceptedProposal(db,signal.signalId,"RELATION_REVOKE",{
    provenance:"REVOKED",evidenceRefs:["source-a","review-final"],status:"REVOKED"
  });
  const prepared=prepareExecutionEnvelope(proposalId,developer,db);
  authorizeExecutionEnvelope(prepared.envelopeId,{validForSeconds:300},owner,db);
  const result=consumeExecutionEnvelope(prepared.envelopeId,owner,db);
  assert.equal(result.envelope.status,"CONSUMED");
  assert.deepEqual(listKnowledgeRelationHistory("rel-ab",db).map(x=>[x.version,x.status]),[[1,"ACTIVE"],[2,"REVOKED"]]);
  assert.throws(()=>consumeExecutionEnvelope(prepared.envelopeId,owner,db),/EXECUTION_ENVELOPE_ALREADY_CONSUMED/);
  db.close();
});

test("consume audit records frozen proposal and payload hash provenance",()=>{
  const {db,base,signalId}=knowledgeFixture();
  const envelope=authorizedKnowledgeEnvelope(db,base,signalId);
  consumeExecutionEnvelope(envelope.envelopeId,owner,db);
  const row=db.prepare("SELECT object_version AS version,provenance_refs_json AS refs FROM audit_events WHERE action='REMEDIATION_EXECUTION_CONSUME'").get() as {version:number;refs:string};
  assert.equal(row.version,3);
  const refs=JSON.parse(row.refs) as string[];
  assert.ok(refs.includes(`${envelope.proposalId}@${envelope.proposalVersion}`));
  assert.ok(refs.includes(envelope.payloadHash));
  db.close();
});
