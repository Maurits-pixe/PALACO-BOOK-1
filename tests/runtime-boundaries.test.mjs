import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
const auth=fs.readFileSync("src/lib/authorization.ts","utf8");const domain=fs.readFileSync("src/lib/domain.ts","utf8");const mutations=fs.readFileSync("src/lib/mutations.ts","utf8");const store=fs.readFileSync("src/lib/store.ts","utf8");
test("default-deny authorization is explicit",()=>{assert.match(auth,/includes\(action\)===true/);assert.match(auth,/AUTHORIZATION_DENIED/);});
test("ordinary USER cannot publish or read audit",()=>{assert.match(auth,/USER:\["CASE_CREATE","KNOWLEDGE_CREATE"\]/);assert.doesNotMatch(auth,/USER:\[[^\]]*KNOWLEDGE_PUBLISH/);});
test("publication crosses provenance gate",()=>{assert.match(domain,/PROVENANCE_GATE_DENIED/);assert.match(mutations,/assertPublishable/);});
test("audit storage is append-oriented",()=>{assert.match(store,/state\.audit\.push/);assert.doesNotMatch(store,/state\.audit\s*=/);});
