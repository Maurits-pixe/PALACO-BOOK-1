import assert from "node:assert/strict";
import {test} from "node:test";
import Database from "better-sqlite3";
import {applyMigrations} from "../src/lib/sqlite";
import {createCaseKnowledgeTransaction} from "../src/lib/transaction";
import {evolveKnowledge,listKnowledgeVersions} from "../src/lib/knowledge-history";
import type {ActorContext} from "../src/lib/actor";

function fixture(){
  const db=new Database(":memory:");
  applyMigrations(db);
  const actor:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
  const base={
    case:{id:"case-1",title:"Case",objective:"Traceable knowledge",status:"ACTIVE" as const,createdAt:"2026-10-01T08:00:00.000Z"},
    source:{id:"source-1",uri:"https://example.test/source",title:"Source",version:1,checksum:"abc",createdAt:"2026-10-01T08:00:00.000Z"},
    provenance:{id:"prov-1",status:"VERIFIED" as const,createdAt:"2026-10-01T08:00:00.000Z"},
    knowledge:{id:"knowledge-1",caseId:"case-1",title:"Initial",content:"v1",status:"PUBLISHED" as const,version:1,sources:[{sourceId:"source-1",version:1,provenance:"VERIFIED" as const}],createdAt:"2026-10-01T08:00:00.000Z"}
  };
  createCaseKnowledgeTransaction(base,actor,db);
  return {db,actor,base};
}

test("knowledge evolution preserves append-only version history",()=>{
  const {db,actor,base}=fixture();
  evolveKnowledge({...base.knowledge,title:"Second",content:"v2",version:2,createdAt:"2026-10-01T09:00:00.000Z"},actor,db);
  const versions=listKnowledgeVersions("knowledge-1",db);
  assert.deepEqual(versions.map(v=>v.version),[1,2]);
  assert.equal(versions[0]?.content,"v1");
  assert.equal(versions[1]?.content,"v2");
  assert.equal(versions[1]?.supersedesVersion,1);
  const audit=db.prepare("SELECT action,object_version AS version FROM audit_events WHERE object_id=? ORDER BY timestamp").all("knowledge-1") as Array<{action:string;version:number}>;
  assert.deepEqual(audit.map(x=>[x.action,x.version]),[["KNOWLEDGE_CREATE",1],["KNOWLEDGE_EVOLVE",2]]);
  db.close();
});

test("knowledge evolution rejects gaps, stale versions and case drift",()=>{
  const {db,actor,base}=fixture();
  assert.throws(()=>evolveKnowledge({...base.knowledge,version:3},actor,db),/KNOWLEDGE_VERSION_NOT_NEXT/);
  assert.throws(()=>evolveKnowledge({...base.knowledge,version:1},actor,db),/KNOWLEDGE_VERSION_NOT_NEXT/);
  assert.throws(()=>evolveKnowledge({...base.knowledge,caseId:"case-2",version:2},actor,db),/KNOWLEDGE_CASE_IMMUTABLE/);
  assert.deepEqual(listKnowledgeVersions("knowledge-1",db).map(v=>v.version),[1]);
  db.close();
});

test("history tables reject mutation and deletion",()=>{
  const {db}=fixture();
  assert.throws(()=>db.prepare("UPDATE knowledge_versions SET title='tampered' WHERE knowledge_id='knowledge-1' AND version=1").run(),/KNOWLEDGE_HISTORY_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM knowledge_versions WHERE knowledge_id='knowledge-1' AND version=1").run(),/KNOWLEDGE_HISTORY_APPEND_ONLY/);
  db.close();
});

test("USER cannot evolve an existing knowledge object",()=>{
  const {db,base}=fixture();
  const user:ActorContext={actorId:"user-1",role:"USER",authentication:"TEST"};
  assert.throws(()=>evolveKnowledge({...base.knowledge,version:2},user,db),/AUTHORIZATION_DENIED/);
  assert.deepEqual(listKnowledgeVersions("knowledge-1",db).map(v=>v.version),[1]);
  db.close();
});
