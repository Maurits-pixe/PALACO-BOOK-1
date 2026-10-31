import assert from "node:assert/strict";
import {test} from "node:test";
import Database from "better-sqlite3";
import {applyMigrations} from "../src/lib/sqlite";
import {createCaseKnowledgeTransaction} from "../src/lib/transaction";
import {createKnowledgeRelation} from "../src/lib/knowledge-graph";
import {analyzeImpact,listOpenReviewSignals,recordImpactSignals} from "../src/lib/impact-analysis";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
const reviewer:ActorContext={actorId:"reviewer-1",role:"REVIEWER",authentication:"TEST"};

function seed(db:Database.Database,id:string,sourceId:string){
  const createdAt="2026-10-31T06:00:00.000Z";
  const knowledge={id,caseId:`case-${id}`,title:id,content:`content ${id}`,status:"PUBLISHED" as const,version:1,sources:[{sourceId,version:1,provenance:"VERIFIED" as const}],createdAt};
  createCaseKnowledgeTransaction({
    case:{id:knowledge.caseId,title:`Case ${id}`,objective:"Impact test",status:"ACTIVE",createdAt},
    knowledge,
    source:{id:sourceId,uri:`https://example.test/${sourceId}`,title:sourceId,version:1,checksum:`sum-${sourceId}`,createdAt},
    provenance:{id:`prov-${id}`,status:"VERIFIED",createdAt}
  },owner,db);
  return knowledge;
}

function fixture(){
  const db=new Database(":memory:");
  applyMigrations(db);
  const a=seed(db,"A","source-a");
  const b=seed(db,"B","source-b");
  const c=seed(db,"C","source-c");
  const d=seed(db,"D","source-d");
  createKnowledgeRelation({relationId:"r-ab",source:{knowledgeId:"A",version:1},target:{knowledgeId:"B",version:1},relationType:"supports",provenance:"VERIFIED",evidenceRefs:["source-a"]},owner,db);
  createKnowledgeRelation({relationId:"r-cb",source:{knowledgeId:"C",version:1},target:{knowledgeId:"B",version:1},relationType:"derived_from",provenance:"VERIFIED",evidenceRefs:["source-b"]},owner,db);
  createKnowledgeRelation({relationId:"r-cd",source:{knowledgeId:"C",version:1},target:{knowledgeId:"D",version:1},relationType:"contradicts",provenance:"TRACEABLE",evidenceRefs:["source-c","source-d"]},owner,db);
  return {db,a,b,c,d};
}

function find(report:ReturnType<typeof analyzeImpact>,type:string,id:string,kind:string){
  return report.candidates.find(x=>x.targetType===type&&x.targetId===id&&x.impactKind===kind);
}

test("impact analysis propagates dependencies but keeps contextual edges non-recursive",()=>{
  const {db}=fixture();
  const report=analyzeImpact({causeKind:"SOURCE_REVOKED",source:{id:"source-a",version:1},maxDepth:6},owner,db);
  assert.equal(report.automaticStateChanges,false);
  assert.ok(find(report,"KNOWLEDGE_VERSION","A","DIRECT_SOURCE"));
  assert.ok(find(report,"KNOWLEDGE_VERSION","B","GRAPH_PROPAGATION"));
  assert.ok(find(report,"KNOWLEDGE_VERSION","C","GRAPH_PROPAGATION"));
  assert.ok(find(report,"RELATION","r-ab","GRAPH_PROPAGATION"));
  assert.ok(find(report,"RELATION","r-cb","GRAPH_PROPAGATION"));
  assert.ok(find(report,"RELATION","r-cd","CONTEXT_REVIEW"));
  assert.ok(find(report,"KNOWLEDGE_VERSION","D","CONTEXT_REVIEW"));
  const dPropagation=find(report,"KNOWLEDGE_VERSION","D","GRAPH_PROPAGATION");
  assert.equal(dPropagation,undefined);
  const statuses=db.prepare("SELECT id,status FROM knowledge_objects ORDER BY id").all() as Array<{id:string;status:string}>;
  assert.ok(statuses.every(x=>x.status==="PUBLISHED"));
  db.close();
});

test("dependency traversal is bounded and cycle-safe",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  seed(db,"A","source-a");
  seed(db,"B","source-b");
  createKnowledgeRelation({relationId:"r-ab",source:{knowledgeId:"A",version:1},target:{knowledgeId:"B",version:1},relationType:"supports",provenance:"VERIFIED",evidenceRefs:["e1"]},owner,db);
  createKnowledgeRelation({relationId:"r-ba",source:{knowledgeId:"B",version:1},target:{knowledgeId:"A",version:1},relationType:"supports",provenance:"VERIFIED",evidenceRefs:["e2"]},owner,db);
  const report=analyzeImpact({causeKind:"SOURCE_CHANGED",source:{id:"source-a",version:1},maxDepth:12},owner,db);
  const graphKnowledge=report.candidates.filter(x=>x.targetType==="KNOWLEDGE_VERSION"&&x.impactKind==="GRAPH_PROPAGATION");
  assert.equal(graphKnowledge.filter(x=>x.targetId==="B").length,1);
  assert.ok(report.candidates.length<10);
  db.close();
});

test("preview has no side effects; recording is authorized, append-only and idempotent",()=>{
  const {db}=fixture();
  const input={causeKind:"SOURCE_CHANGED" as const,source:{id:"source-a",version:1},maxDepth:3};
  const preview=analyzeImpact(input,reviewer,db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM review_signals").get().count,0);
  const first=recordImpactSignals(input,reviewer,db);
  assert.equal(first.recorded.length,preview.candidates.length);
  const second=recordImpactSignals(input,reviewer,db);
  assert.equal(second.recorded.length,0);
  assert.equal(listOpenReviewSignals(db).length,preview.candidates.length);
  assert.throws(()=>db.prepare("UPDATE review_signals SET status='RESOLVED'").run(),/REVIEW_SIGNAL_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM review_signals").run(),/REVIEW_SIGNAL_APPEND_ONLY/);
  const auditCount=(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='IMPACT_SIGNAL_CREATE'").get() as {count:number}).count;
  assert.equal(auditCount,preview.candidates.length);
  db.close();
});

test("editor may preview but cannot record; user cannot run impact analysis",()=>{
  const {db}=fixture();
  const input={causeKind:"SOURCE_REVOKED" as const,source:{id:"source-a",version:1},maxDepth:2};
  const editor:ActorContext={actorId:"editor-1",role:"EDITOR",authentication:"TEST"};
  const user:ActorContext={actorId:"user-1",role:"USER",authentication:"TEST"};
  assert.ok(analyzeImpact(input,editor,db).candidates.length>0);
  assert.throws(()=>recordImpactSignals(input,editor,db),/AUTHORIZATION_DENIED/);
  assert.throws(()=>analyzeImpact(input,user,db),/AUTHORIZATION_DENIED/);
  db.close();
});

test("unknown source versions fail closed",()=>{
  const {db}=fixture();
  assert.throws(()=>analyzeImpact({causeKind:"SOURCE_REVOKED",source:{id:"missing",version:1}},owner,db),/SOURCE_VERSION_NOT_FOUND/);
  db.close();
});
