import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const script=path.resolve("scripts/evaluate-live-provider-result.ts");
const head="a".repeat(40);
const hashA="b".repeat(64);
const hashB="c".repeat(64);

function execute(report:Record<string,unknown>){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"palaco-conformance-"));
  const reportPath=path.join(dir,"report.json");
  const verdictPath=path.join(dir,"verdict.json");
  fs.writeFileSync(reportPath,JSON.stringify(report),"utf8");
  const result=spawnSync("npx",["tsx",script],{
    cwd:process.cwd(),
    encoding:"utf8",
    env:{
      ...process.env,
      LIVE_CONFORMANCE_REPORT:reportPath,
      LIVE_CONFORMANCE_VERDICT:verdictPath,
      CONFORMANCE_EXPECTED_REF:"feature/levensader-vertical-slice",
      CONFORMANCE_EXPECTED_HEAD:head,
      PALACO_MENTOR_MODEL:"provider-model-v1"
    }
  });
  const verdict=JSON.parse(fs.readFileSync(verdictPath,"utf8"));
  fs.rmSync(dir,{recursive:true,force:true});
  return {result,verdict};
}

function passingReport(){
  return {
    testRunId:"12345",
    targetRef:"feature/levensader-vertical-slice",
    targetHead:head,
    modelBinding:"provider-model-v1",
    status:"PASS",
    inputHash:hashA,
    outputHash:hashB,
    durationMs:321,
    safetyOutcome:"PASS",
    contractValidation:"PASS",
    auditEventCount:4,
    advisory:true,
    humanDecisionRequired:true,
    provenanceVerified:true,
    remoteObservationVerified:true,
    failureCode:null
  };
}

test("formal evaluator verifies only complete synthetic fixture evidence",()=>{
  const {result,verdict}=execute(passingReport());
  assert.equal(result.status,0,result.stderr);
  assert.equal(verdict.status,"VERIFIED");
  assert.equal(verdict.releaseStatus,"LIVE PROVIDER CONTRACT: VERIFIED FOR SYNTHETIC FIXTURES");
  assert.equal(verdict.failureClass,null);
  assert.equal(verdict.evidence.targetHead,head);
  assert.equal(verdict.evidence.modelBinding,"provider-model-v1");
});

test("provider 5xx is classified as NETWORK_PROVIDER",()=>{
  const report={...passingReport(),status:"FAIL",contractValidation:"FAIL",outputHash:null,failureCode:"MENTOR_REMOTE_HTTP_503"};
  const {result,verdict}=execute(report);
  assert.notEqual(result.status,0);
  assert.equal(verdict.status,"FAILED");
  assert.equal(verdict.failureClass,"NETWORK_PROVIDER");
  assert.equal(verdict.failureCode,"MENTOR_REMOTE_HTTP_503");
});

test("target head mismatch is classified as CONFIGURATION",()=>{
  const report={...passingReport(),targetHead:"d".repeat(40)};
  const {result,verdict}=execute(report);
  assert.notEqual(result.status,0);
  assert.equal(verdict.failureClass,"CONFIGURATION");
  assert.equal(verdict.failureCode,"TARGET_HEAD_MISMATCH");
});

test("provenance failure is classified as PROVENANCE",()=>{
  const report={...passingReport(),provenanceVerified:false};
  const {result,verdict}=execute(report);
  assert.notEqual(result.status,0);
  assert.equal(verdict.failureClass,"PROVENANCE");
  assert.equal(verdict.failureCode,"MENTOR_PROVENANCE_REQUIRED");
});

test("audit failure is classified as AUDIT_INTEGRITY",()=>{
  const report={...passingReport(),auditEventCount:0};
  const {result,verdict}=execute(report);
  assert.notEqual(result.status,0);
  assert.equal(verdict.failureClass,"AUDIT_INTEGRITY");
  assert.equal(verdict.failureCode,"MENTOR_AUDIT_INCOMPLETE");
});

test("blocked safety outcome is classified as SAFETY",()=>{
  const report={...passingReport(),safetyOutcome:"BLOCKED"};
  const {result,verdict}=execute(report);
  assert.notEqual(result.status,0);
  assert.equal(verdict.failureClass,"SAFETY");
  assert.equal(verdict.failureCode,"MENTOR_SAFETY_INVALID");
});

test("binding mismatch is classified as BINDING",()=>{
  const report={...passingReport(),modelBinding:"unexpected-model"};
  const {result,verdict}=execute(report);
  assert.notEqual(result.status,0);
  assert.equal(verdict.failureClass,"BINDING");
  assert.equal(verdict.failureCode,"MENTOR_BINDING_MISMATCH");
});


test("explicit preflight configuration failure outranks derived binding checks",()=>{
  const report={
    ...passingReport(),
    modelBinding:"",
    status:"FAIL",
    contractValidation:"FAIL",
    inputHash:null,
    outputHash:null,
    auditEventCount:0,
    advisory:false,
    humanDecisionRequired:false,
    provenanceVerified:false,
    remoteObservationVerified:false,
    safetyOutcome:"UNKNOWN",
    failureCode:"CONFORMANCE_CONFIGURATION_MISSING"
  };
  const {result,verdict}=execute(report);
  assert.notEqual(result.status,0);
  assert.equal(verdict.status,"FAILED");
  assert.equal(verdict.failureClass,"CONFIGURATION");
  assert.equal(verdict.failureCode,"CONFORMANCE_CONFIGURATION_MISSING");
});

test("target integrity mismatch still outranks an explicit report failure",()=>{
  const report={
    ...passingReport(),
    targetHead:"d".repeat(40),
    modelBinding:"",
    status:"FAIL",
    contractValidation:"FAIL",
    inputHash:null,
    outputHash:null,
    failureCode:"CONFORMANCE_CONFIGURATION_MISSING"
  };
  const {result,verdict}=execute(report);
  assert.notEqual(result.status,0);
  assert.equal(verdict.failureClass,"CONFIGURATION");
  assert.equal(verdict.failureCode,"TARGET_HEAD_MISMATCH");
});
