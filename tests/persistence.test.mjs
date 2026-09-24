import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
const sql=fs.readFileSync("db/migrations/001_initial.sql","utf8");const mutations=fs.readFileSync("src/lib/mutations.ts","utf8");
test("durable schema contains vertical-slice records",()=>{for(const table of ["cases","knowledge_objects","source_refs","audit_events"])assert.match(sql,new RegExp("CREATE TABLE IF NOT EXISTS "+table));});
test("audit history is protected at database boundary",()=>{assert.match(sql,/audit_events_no_update/);assert.match(sql,/audit_events_no_delete/);assert.match(sql,/AUDIT_APPEND_ONLY/);});
test("runtime mutations use sqlite store",()=>{assert.match(mutations,/sqliteStore as store/);});
