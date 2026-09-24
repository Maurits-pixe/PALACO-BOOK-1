import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/lib/sqlite";
import { createUser,authenticate,createSession,resolveSession,revokeSession,SESSION_COOKIE } from "../src/lib/identity";
import { requireActor } from "../src/lib/actor";

test("identity migration stores password and session material as hashes",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  const user=createUser({username:"Owner",password:"a-strong-password-123",role:"OWNER"},db);
  const raw=db.prepare("SELECT username,password_salt AS salt,password_hash AS hash FROM users WHERE id=?").get(user.id) as {username:string;salt:string;hash:string};
  assert.equal(raw.username,"owner");
  assert.notEqual(raw.hash,"a-strong-password-123");
  assert.ok(raw.salt.length>=32);
  assert.equal(authenticate("OWNER","a-strong-password-123",db).id,user.id);

  const session=createSession(user.id,db);
  const stored=db.prepare("SELECT token_hash AS tokenHash FROM sessions WHERE id=?").get(session.sessionId) as {tokenHash:string};
  assert.notEqual(stored.tokenHash,session.token);
  assert.equal(resolveSession(session.token,db).user.id,user.id);
});

test("first-party session resolves an authenticated actor and ignores spoofed role headers",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  const user=createUser({username:"owner",password:"a-strong-password-123",role:"OWNER"},db);
  const session=createSession(user.id,db);
  const previous=process.env.PALACO_AUTH_MODE;
  process.env.PALACO_AUTH_MODE="session";
  const request=new Request("http://localhost",{headers:{
    cookie:`${SESSION_COOKIE}=${encodeURIComponent(session.token)}`,
    "x-palaco-role":"USER",
    "x-palaco-actor-id":"spoof"
  }});
  assert.deepEqual(requireActor(request,db),{actorId:user.id,role:"OWNER",authentication:"SESSION"});
  if(previous===undefined)delete process.env.PALACO_AUTH_MODE;else process.env.PALACO_AUTH_MODE=previous;
});

test("revoked and expired sessions cannot authenticate",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  const user=createUser({username:"owner",password:"a-strong-password-123",role:"OWNER"},db);

  const revoked=createSession(user.id,db);
  revokeSession(revoked.token,db);
  assert.throws(()=>resolveSession(revoked.token,db),/AUTHENTICATION_REQUIRED/);

  const expired=createSession(user.id,db);
  db.prepare("UPDATE sessions SET expires_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z",expired.sessionId);
  assert.throws(()=>resolveSession(expired.token,db),/AUTHENTICATION_REQUIRED/);
});

test("wrong passwords fail without revealing whether credentials are valid",()=>{
  const db=new Database(":memory:");
  applyMigrations(db);
  createUser({username:"owner",password:"a-strong-password-123",role:"OWNER"},db);
  assert.throws(()=>authenticate("owner","wrong-password",db),/INVALID_CREDENTIALS/);
  assert.throws(()=>authenticate("missing","wrong-password",db),/INVALID_CREDENTIALS/);
});
