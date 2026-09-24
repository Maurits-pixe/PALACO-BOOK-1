import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/lib/sqlite";
import { createCaseKnowledgeTransaction } from "../src/lib/transaction";
import { buildCaseTimeline } from "../src/lib/timeline";
import { requireActor, type ActorContext } from "../src/lib/actor";

function count(db:Database.Database,table:string){return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n;}\n\nconst actor:ActorContext={actorId:"user-1",role:"OWNER",authentication:"TEST"};
const input={
  case:{id:"case-1",title:"Case 1",objective:"Verify one atomic slice",status:"ACTIVE",createdAt:"2026-09-24T08:10:00.000Z"},
  knowledge:{id:"knowledge-1",caseId:"case-1",title:"Knowledge 1",content:"Verified content",status:"VERIFIED",version:1,sources:[{sourceId:"source-1",version:1,provenance:"VERIFIED"}],createdAt:"2026-09-24T08:11:00.000Z"},
  source:{id:"source-1",uri:"urn:test:source-1",title:"Source 1",version:1,checksum:"sha256:test",createdAt:"2026-09-24T08:10:30.000Z"},
  provenance:{id:"prov-1",status:"VERIFIED",createdAt:"2026-09-24T08:11:30.000Z"}
} as const;

test("empty database migrates and one atomic vertical slice reconstructs fully",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  const result=createCaseKnowledgeTransaction(input,actor,db);
  assert.deepEqual(result,{caseId:"case-1",knowledgeId:"knowledge-1",sourceId:"source-1",provenanceId:"prov-1"});
  const timeline=buildCaseTimeline("case-1",actor,db);
  assert.ok(timeline);
  assert.equal(timeline.case.id,"case-1");
  assert.equal(timeline.knowledge.length,1);
  assert.equal(timeline.sources.length,1);
  assert.equal(timeline.provenance.length,1);
  assert.equal(timeline.provenance[0].status,"VERIFIED");
  assert.equal(timeline.timeline.length,4);
  assert.deepEqual(timeline.timeline.map(x=>x.actor),["user-1","user-1","user-1","user-1"]);
  assert.ok(timeline.timeline.every(x=>x.provenanceRefs.length<=1));
});

test("mid-transaction source conflict rolls back case knowledge provenance and audit",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO sources(id,version,uri,title,checksum,created_at) VALUES(?,?,?,?,?,?)").run("source-1",1,"urn:existing","Existing","sha256:existing","2026-09-24T08:00:00.000Z");
  assert.throws(()=>createCaseKnowledgeTransaction(input,actor,db));
  assert.equal(count(db,"cases"),0);
  assert.equal(count(db,"knowledge_objects"),0);
  assert.equal(count(db,"provenance_records"),0);
  assert.equal(count(db,"audit_events"),0);
});

test("audit rows are immutable at database boundary",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  createCaseKnowledgeTransaction(input,actor,db);
  assert.throws(()=>db.prepare("UPDATE audit_events SET action='MUTATED'").run(),/AUDIT_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM audit_events").run(),/AUDIT_APPEND_ONLY/);
});

test("actor adapter fails closed unless an authentication mode is explicitly configured",()=>{
  const previous=process.env.PALACO_AUTH_MODE;
  delete process.env.PALACO_AUTH_MODE;
  const request=new Request("http://localhost",{headers:{"x-palaco-actor-id":"spoof","x-palaco-role":"OWNER","x-palaco-authenticated":"true"}});
  assert.throws(()=>requireActor(request),/IDENTITY_NOT_CONFIGURED/);
  if(previous===undefined)delete process.env.PALACO_AUTH_MODE;else process.env.PALACO_AUTH_MODE=previous;
});
