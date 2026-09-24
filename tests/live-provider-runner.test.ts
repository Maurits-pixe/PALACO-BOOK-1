import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("live provider runner starts under tsx and fails as classified configuration when secrets are absent",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"palaco-live-runner-"));
  const report=path.join(dir,"report.json");
  const result=spawnSync("npx",["tsx","scripts/live-provider-conformance.ts"],{
    cwd:process.cwd(),
    encoding:"utf8",
    env:{
      ...process.env,
      PALACO_MENTOR_REMOTE_ENABLED:"true",
      PALACO_MENTOR_MODEL:"",
      PALACO_MENTOR_ENDPOINT:"",
      PALACO_MENTOR_API_KEY:"",
      CONFORMANCE_TARGET_REF:"feature/levensader-vertical-slice",
      CONFORMANCE_TARGET_SHA:"smoke-test-head",
      LIVE_CONFORMANCE_REPORT:report
    }
  });
  assert.notEqual(result.status,0);
  assert.doesNotMatch(result.stderr,/Top-level await is currently not supported/);
  assert.match(result.stderr,/LIVE_PROVIDER_CONFORMANCE=CONFORMANCE_CONFIGURATION_MISSING/);
  const parsed=JSON.parse(fs.readFileSync(report,"utf8"));
  assert.equal(parsed.status,"FAIL");
  assert.equal(parsed.failureCode,"CONFORMANCE_CONFIGURATION_MISSING");
  assert.equal(parsed.targetRef,"feature/levensader-vertical-slice");
  fs.rmSync(dir,{recursive:true,force:true});
});
