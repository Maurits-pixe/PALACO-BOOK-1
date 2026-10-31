import assert from "node:assert/strict";
import {test} from "node:test";
import Database from "better-sqlite3";
import {applyMigrations} from "../src/lib/sqlite";
import {getLatestSourceState,listSourceStateHistory,registerSourceVersion,transitionSourceState} from "../src/lib/source-ledger";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};
const developer:ActorContext={actorId:"dev-1",role:"DEVELOPER",authentication:"TEST"};

function source(version:number){
  return {id:"source-x",version,uri:`https://example.test/source-x/v${version}`,title:`Source X v${version}`,checksum:`checksum-${version}`,createdAt:`2026-10-31T0${version}:00:00.000Z`};
}

test("source versions are monotone and receive an automatic ACTIVE state",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  registerSourceVersion(source(1),owner,db);
  assert.equal(getLatestSourceState("source-x",1,db)?.status,"ACTIVE");
  assert.equal(getLatestSourceState("source-x",1,db)?.actor,"DATABASE_TRIGGER");
  assert.throws(()=>registerSourceVersion(source(3),owner,db),/SOURCE_VERSION_NOT_NEXT/);
  registerSourceVersion(source(2),developer,db);
  assert.equal(getLatestSourceState("source-x",2,db)?.status,"ACTIVE");
  db.close();
});

test("superseding a source is terminal and returns an explicit SOURCE_CHANGED impact cause",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  registerSourceVersion(source(1),owner,db);
  registerSourceVersion(source(2),owner,db);
  const result=transitionSourceState({sourceId:"source-x",sourceVersion:1,status:"SUPERSEDED",replacementSourceVersion:2,reason:"new edition"},owner,db);
  assert.equal(result.state.status,"SUPERSEDED");
  assert.equal(result.state.replacementSourceVersion,2);
  assert.equal(result.impactCause.causeKind,"SOURCE_CHANGED");
  assert.equal(result.automaticImpact,false);
  assert.deepEqual(listSourceStateHistory("source-x",1,db).map(x=>x.status),["ACTIVE","SUPERSEDED"]);
  assert.throws(()=>transitionSourceState({sourceId:"source-x",sourceVersion:1,status:"REVOKED",reason:"late revoke"},owner,db),/SOURCE_STATE_TERMINAL/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM review_signals").get() as {count:number}).count,0);
  db.close();
});

test("revocation is terminal, append-only and cannot declare a replacement",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  registerSourceVersion(source(1),owner,db);
  assert.throws(()=>transitionSourceState({sourceId:"source-x",sourceVersion:1,status:"REVOKED",replacementSourceVersion:2,reason:"bad"},owner,db),/REVOKED_SOURCE_CANNOT_DECLARE_REPLACEMENT/);
  const result=transitionSourceState({sourceId:"source-x",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  assert.equal(result.impactCause.causeKind,"SOURCE_REVOKED");
  assert.equal(getLatestSourceState("source-x",1,db)?.status,"REVOKED");
  assert.throws(()=>db.prepare("UPDATE source_states SET status='ACTIVE'").run(),/SOURCE_STATE_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM source_states").run(),/SOURCE_STATE_APPEND_ONLY/);
  db.close();
});

test("source terminal state authority is owner-only in this slice",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  registerSourceVersion(source(1),developer,db);
  assert.throws(()=>transitionSourceState({sourceId:"source-x",sourceVersion:1,status:"REVOKED",reason:"developer attempt"},developer,db),/AUTHORIZATION_DENIED/);
  assert.equal(getLatestSourceState("source-x",1,db)?.status,"ACTIVE");
  db.close();
});

test("source transitions are audited separately from impact recording",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  registerSourceVersion(source(1),owner,db);
  transitionSourceState({sourceId:"source-x",sourceVersion:1,status:"REVOKED",reason:"withdrawn"},owner,db);
  const actions=(db.prepare("SELECT action FROM audit_events ORDER BY timestamp,event_id").all() as Array<{action:string}>).map(x=>x.action);
  assert.ok(actions.includes("SOURCE_REGISTER"));
  assert.ok(actions.includes("SOURCE_REVOKE"));
  assert.ok(!actions.includes("IMPACT_SIGNAL_CREATE"));
  db.close();
});
