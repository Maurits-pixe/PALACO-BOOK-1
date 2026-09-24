import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow=fs.readFileSync(".github/workflows/live-provider-conformance.yml","utf8");
const runner=fs.readFileSync("scripts/live-provider-conformance.ts","utf8");

test("live provider workflow is manual-only and bounded",()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/^\s*push:/m);
  assert.doesNotMatch(workflow,/^\s*pull_request:/m);
  assert.match(workflow,/timeout-minutes:\s*5/);
  assert.match(workflow,/environment:\s*live-provider-conformance/);
  assert.match(workflow,/permissions:\s*\n\s*contents:\s*read/);
});

test("live workflow requires server-side provider secret and never injects synthetic real data",()=>{
  assert.match(workflow,/secrets\.PALACO_MENTOR_API_KEY/);
  assert.match(workflow,/vars\.PALACO_MENTOR_ENDPOINT/);
  assert.match(workflow,/vars\.PALACO_MENTOR_MODEL/);
  assert.match(runner,/SYNTHETIC_ALPHA/);
  assert.match(runner,/No real user, patient, health, or sensitive data is present/);
});

test("persisted live report is metadata-only",()=>{
  const reportBlock=runner.slice(runner.indexOf("const report={"),runner.indexOf("writeReport(report);"));
  assert.match(reportBlock,/testRunId/);
  assert.match(reportBlock,/modelBinding/);
  assert.match(reportBlock,/inputHash/);
  assert.match(reportBlock,/outputHash/);
  assert.match(reportBlock,/durationMs/);
  assert.match(reportBlock,/safetyOutcome/);
  assert.match(reportBlock,/contractValidation/);
  assert.doesNotMatch(reportBlock,/question/);
  assert.doesNotMatch(reportBlock,/output:/);
  assert.doesNotMatch(reportBlock,/apiKey/);
});
