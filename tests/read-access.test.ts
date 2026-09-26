import test from "node:test";
import assert from "node:assert/strict";
import { database } from "../src/lib/sqlite";
import { createUser,createSession,revokeSession,SESSION_COOKIE } from "../src/lib/identity";
import { GET as cases } from "../src/app/api/cases/route";
import { GET as knowledge } from "../src/app/api/knowledge/route";

test("case and knowledge routes enforce authenticated read access",async()=>{
  const previous={mode:process.env.PALACO_AUTH_MODE,path:process.env.BLUEBOOK_DB_PATH};
  process.env.PALACO_AUTH_MODE="session";
  process.env.BLUEBOOK_DB_PATH=":memory:";
  const db=database();
  try{
    db.prepare("INSERT INTO cases VALUES(?,?,?,?,?)").run("private-case","Private case","Private objective","ACTIVE","2026-09-26T00:00:00.000Z");
    db.prepare("INSERT INTO knowledge_objects VALUES(?,?,?,?,?,?,?)").run("private-knowledge","private-case","Private knowledge","Private content","DRAFT",1,"2026-09-26T00:00:00.000Z");
    const user=createUser({username:"reader",password:"test-password-long-enough",role:"USER"},db);
    const mentor=createUser({username:"mentor",password:"test-password-long-enough",role:"MENTOR"},db);
    const disabledUser=createUser({username:"disabled",password:"test-password-long-enough",role:"USER"},db);
    const disabled=createSession(disabledUser.id,db);
    db.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(disabledUser.id);
    const valid=createSession(user.id,db),denied=createSession(mentor.id,db),revoked=createSession(user.id,db),expired=createSession(user.id,db);
    revokeSession(revoked.token,db);
    db.prepare("UPDATE sessions SET expires_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z",expired.sessionId);

    for(const [handler,url,expectedId] of [
      [cases,"http://localhost/api/cases","private-case"],
      [knowledge,"http://localhost/api/knowledge?caseId=private-case","private-knowledge"]
    ] as const){
      for(const token of [undefined,"invalid-token",revoked.token,expired.token,disabled.token]){
        const headers:Record<string,string>={"x-palaco-role":"OWNER","x-palaco-actor-id":"spoofed"};
        if(token)headers.cookie=`${SESSION_COOKIE}=${token}`;
        const response=await handler(new Request(url,{headers}));
        assert.equal(response.status,401);
        assert.match(response.headers.get("cache-control")??"",/no-store/);
        assert.deepEqual(await response.json(),{error:"AUTHENTICATION_REQUIRED"});
      }
      const forbidden=await handler(new Request(url,{headers:{cookie:`${SESSION_COOKIE}=${denied.token}`}}));
      assert.equal(forbidden.status,403);
      assert.deepEqual(await forbidden.json(),{error:"AUTHORIZATION_DENIED"});
      const allowed=await handler(new Request(url,{headers:{cookie:`${SESSION_COOKIE}=${valid.token}`}}));
      assert.equal(allowed.status,200);
      assert.equal(allowed.headers.get("cache-control"),"private, no-store");
      assert.equal((await allowed.json())[0].id,expectedId);
      delete process.env.PALACO_AUTH_MODE;
      assert.equal((await handler(new Request(url))).status,401);
      process.env.PALACO_AUTH_MODE="session";
    }
  }finally{
    db.close();
    if(previous.mode===undefined)delete process.env.PALACO_AUTH_MODE;else process.env.PALACO_AUTH_MODE=previous.mode;
    if(previous.path===undefined)delete process.env.BLUEBOOK_DB_PATH;else process.env.BLUEBOOK_DB_PATH=previous.path;
  }
});
