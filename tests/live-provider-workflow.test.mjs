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
  assert.match(runner,/const reportBase=\{testRunId:/);
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


test("live workflow delegates final status to the formal evaluator",()=>{
  assert.match(workflow,/continue-on-error:\s*true/);
  assert.match(workflow,/Evaluate formal result conditions/);
  assert.match(workflow,/npm run live:provider-result/);
  assert.match(workflow,/LIVE_CONFORMANCE_VERDICT/);
  assert.match(workflow,/live-provider-conformance-verdict\.json/);
});

test("live workflow records target ref and exact checked-out commit",()=>{
  assert.match(workflow,/Resolve target evidence/);
  assert.match(workflow,/git rev-parse HEAD/);
  assert.match(workflow,/CONFORMANCE_TARGET_REF/);
  assert.match(workflow,/CONFORMANCE_TARGET_SHA/);
  assert.match(workflow,/CONFORMANCE_EXPECTED_HEAD/);
});


test("live workflow validates provider configuration before live execution",()=>{
  assert.match(workflow,/Validate provider configuration without exposing values/);
  assert.match(workflow,/CONFORMANCE_CONFIGURATION_MISSING/);
  assert.match(workflow,/CONFORMANCE_ENDPOINT_HTTPS_REQUIRED/);
  assert.match(workflow,/steps\.provider_config\.outputs\.valid == 'true'/);
  assert.match(workflow,/secrets\.PALACO_MENTOR_API_KEY/);
  assert.doesNotMatch(workflow,/echo .*PALACO_MENTOR_API_KEY/);
});
