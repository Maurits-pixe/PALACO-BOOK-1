import fs from "node:fs";

type Report={
  testRunId?:string;
  targetRef?:string;
  targetHead?:string;
  modelBinding?:string;
  status?:string;
  inputHash?:string|null;
  outputHash?:string|null;
  durationMs?:number;
  safetyOutcome?:string;
  contractValidation?:string;
  auditEventCount?:number;
  advisory?:boolean;
  humanDecisionRequired?:boolean;
  provenanceVerified?:boolean;
  remoteObservationVerified?:boolean;
  failureCode?:string|null;
};

const path=process.env.LIVE_CONFORMANCE_REPORT??"live-provider-conformance-report.json";
const verdictPath=process.env.LIVE_CONFORMANCE_VERDICT??"live-provider-conformance-verdict.json";
const expectedRef=process.env.CONFORMANCE_EXPECTED_REF??"feature/levensader-vertical-slice";
const expectedHead=process.env.CONFORMANCE_EXPECTED_HEAD;
const expectedModel=process.env.PALACO_MENTOR_MODEL;

function classify(code:string|undefined|null){
  if(!code)return "UNKNOWN";
  if(/CONFIGURATION|NOT_CONFIGURED|DISABLED|HTTPS_REQUIRED|TARGET_(REF|HEAD)_MISMATCH/.test(code))return "CONFIGURATION";
  if(/TIMEOUT|HTTP_5|PROVIDER|NETWORK/.test(code))return "NETWORK_PROVIDER";
  if(/CONTRACT_INVALID|RESPONSE|JSON|SCHEMA/.test(code))return "RESPONSE_SCHEMA";
  if(/PROVENANCE/.test(code))return "PROVENANCE";
  if(/SAFETY|PROMPT_INJECTION|BLOCKED/.test(code))return "SAFETY";
  if(/AUDIT/.test(code))return "AUDIT_INTEGRITY";
  if(/BINDING|MODEL|CAPABILITY|PROMPT_VERSION/.test(code))return "BINDING";
  if(/REPLAY|DUPLICATE/.test(code))return "REPLAY";
  return "UNKNOWN";
}

function sha(value:unknown){return typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);}

let report:Report;
try{report=JSON.parse(fs.readFileSync(path,"utf8")) as Report;}
catch{report={failureCode:"CONFORMANCE_REPORT_MISSING"};}

const failures:string[]=[];
if(report.targetRef!==expectedRef)failures.push("TARGET_REF_MISMATCH");
if(!expectedHead||report.targetHead!==expectedHead)failures.push("TARGET_HEAD_MISMATCH");

if(report.status!=="PASS"){
  failures.push(report.failureCode??"LIVE_PROVIDER_CONFORMANCE_FAILED");
}else{
  if(report.failureCode)failures.push(report.failureCode);
  if(!expectedModel||report.modelBinding!==expectedModel)failures.push("MENTOR_BINDING_MISMATCH");
  if(report.contractValidation!=="PASS")failures.push("MENTOR_PROVIDER_CONTRACT_INVALID");
  if(!sha(report.inputHash))failures.push("MENTOR_INPUT_HASH_INVALID");
  if(!sha(report.outputHash))failures.push("MENTOR_OUTPUT_HASH_INVALID");
  if(typeof report.durationMs!=="number"||report.durationMs<0)failures.push("CONFORMANCE_TIMING_INVALID");
  if(!["PASS","ESCALATE"].includes(report.safetyOutcome??""))failures.push("MENTOR_SAFETY_INVALID");
  if((report.auditEventCount??0)<2)failures.push("MENTOR_AUDIT_INCOMPLETE");
  if(report.advisory!==true)failures.push("MENTOR_ADVISORY_STATUS_REQUIRED");
  if(report.humanDecisionRequired!==true)failures.push("MENTOR_HUMAN_DECISION_REQUIRED");
  if(report.provenanceVerified!==true)failures.push("MENTOR_PROVENANCE_REQUIRED");
  if(report.remoteObservationVerified!==true)failures.push("MENTOR_REMOTE_OBSERVATION_MISSING");
}

const primary=failures[0]??null;
const verdict={
  status:failures.length===0?"VERIFIED":"FAILED",
  releaseStatus:failures.length===0
    ?"LIVE PROVIDER CONTRACT: VERIFIED FOR SYNTHETIC FIXTURES"
    :"LIVE PROVIDER CONTRACT: FAILED FOR SYNTHETIC FIXTURES",
  failureClass:failures.length===0?null:classify(primary),
  failureCode:primary,
  evidence:{
    testRunId:report.testRunId??null,
    targetRef:report.targetRef??null,
    targetHead:report.targetHead??null,
    modelBinding:report.modelBinding??null,
    inputHash:report.inputHash??null,
    outputHash:report.outputHash??null,
    durationMs:report.durationMs??null,
    safetyOutcome:report.safetyOutcome??null,
    contractValidation:report.contractValidation??null,
    auditEventCount:report.auditEventCount??null
  }
};
fs.writeFileSync(verdictPath,JSON.stringify(verdict,null,2)+"\n","utf8");
console.log("LIVE_PROVIDER_RESULT="+verdict.status);
if(failures.length>0){
  console.error("LIVE_PROVIDER_FAILURE_CLASS="+verdict.failureClass);
  console.error("LIVE_PROVIDER_FAILURE_CODE="+primary);
  process.exitCode=1;
}
