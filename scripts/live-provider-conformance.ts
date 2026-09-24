import Database from "better-sqlite3";
import fs from "node:fs";
import { createHash,randomUUID } from "node:crypto";
import { applyMigrations } from "../src/lib/sqlite";
import { createCaseKnowledgeTransaction } from "../src/lib/transaction";
import { configuredMentorAdapters } from "../src/lib/mentor-adapters";
import { runMentorCouncil,inspectMentorRun } from "../src/lib/mentor-engine";
import type { ActorContext } from "../src/lib/actor";

function sha256(value:string){return createHash("sha256").update(value).digest("hex");}
function required(name:string){const value=process.env[name];if(!value)throw new Error("CONFORMANCE_CONFIGURATION_MISSING");return value;}
function writeReport(report:Record<string,unknown>){
  const path=process.env.LIVE_CONFORMANCE_REPORT??"live-provider-conformance-report.json";
  fs.writeFileSync(path,JSON.stringify(report,null,2)+"\n","utf8");
}
function safeFailure(error:unknown){
  if(error instanceof Error){
    if(error.name==="ZodError")return "MENTOR_PROVIDER_CONTRACT_INVALID";
    if(/^(MENTOR|CONFORMANCE)_[A-Z0-9_]+$/.test(error.message))return error.message;
  }
  return "LIVE_PROVIDER_CONFORMANCE_FAILED";
}

const started=Date.now();
const reportBase={testRunId:process.env.GITHUB_RUN_ID??randomUUID(),targetRef:process.env.CONFORMANCE_TARGET_REF??"UNKNOWN",targetHead:process.env.CONFORMANCE_TARGET_SHA??"UNKNOWN"};
let modelBinding="UNAVAILABLE";
let inputHash="";
let outputHash="";
let safetyOutcome="UNKNOWN";
let auditEventCount=0;
let advisory=false;
let humanDecisionRequired=false;
let provenanceVerified=false;
let remoteObservationVerified=false;

try{
  if(process.env.PALACO_MENTOR_REMOTE_ENABLED!=="true")throw new Error("CONFORMANCE_CONFIGURATION_MISSING");
  modelBinding=required("PALACO_MENTOR_MODEL");
  const endpoint=required("PALACO_MENTOR_ENDPOINT");
  if(!/^https:\/\//i.test(endpoint))throw new Error("CONFORMANCE_ENDPOINT_HTTPS_REQUIRED");
  required("PALACO_MENTOR_API_KEY");

  const db=new Database(":memory:");
  applyMigrations(db);
  const actor:ActorContext={actorId:"live-conformance-runner",role:"OWNER",authentication:"TEST"};
  const caseId="live-synthetic-case-"+randomUUID();
  const knowledgeId="live-synthetic-knowledge-"+randomUUID();
  const sourceId="live-synthetic-source-"+randomUUID();
  const provenanceId="live-synthetic-prov-"+randomUUID();
  const correlationId="live-conformance-"+randomUUID();

  createCaseKnowledgeTransaction({
    case:{
      id:caseId,
      title:"Synthetic live-provider conformance case",
      objective:"Contract-only provider conformance using synthetic non-sensitive fixtures",
      status:"ACTIVE",
      createdAt:new Date().toISOString()
    },
    knowledge:{
      id:knowledgeId,
      caseId,
      title:"Synthetic infrastructure observation",
      content:"Synthetic fixture only: option A has a modeled latency of 20 ms and option B has a modeled latency of 30 ms. No real user, patient, health, or sensitive data is present.",
      status:"VERIFIED",
      version:1,
      sources:[{sourceId,version:1,provenance:"VERIFIED"}],
      createdAt:new Date().toISOString()
    },
    source:{
      id:sourceId,
      uri:"urn:palaco:synthetic:live-provider-conformance",
      title:"Synthetic conformance source",
      version:1,
      checksum:"sha256:"+sha256("synthetic-live-provider-conformance-fixture-v1"),
      createdAt:new Date().toISOString()
    },
    provenance:{
      id:provenanceId,
      status:"VERIFIED",
      createdAt:new Date().toISOString()
    }
  },actor,db);

  const adapters=configuredMentorAdapters();
  const result=await runMentorCouncil({
    caseId,
    correlationId,
    question:"Using only the supplied synthetic fixture, identify the evidence boundary, uncertainty, and non-authoritative options.",
    dataClassification:"SYNTHETIC_ALPHA"
  },actor,adapters,db);

  const remote=result.observations.find(o=>o.adapterKind==="REMOTE");
  if(!remote)throw new Error("MENTOR_REMOTE_OBSERVATION_MISSING");
  if(remote.modelBinding!==modelBinding)throw new Error("MENTOR_BINDING_MISMATCH");
  if(remote.capabilityBinding.length===0)throw new Error("MENTOR_CAPABILITY_BINDING_MISSING");
  if(!remote.promptVersion)throw new Error("MENTOR_PROMPT_VERSION_MISSING");
  if(remote.provenanceRefs.length===0)throw new Error("MENTOR_OBSERVATION_PROVENANCE_REQUIRED");
  if(!/^[a-f0-9]{64}$/.test(remote.inputHash)||!/^[a-f0-9]{64}$/.test(remote.outputHash))throw new Error("MENTOR_HASH_INVALID");
  if(!Array.isArray(remote.safetyFlags))throw new Error("MENTOR_SAFETY_FLAGS_INVALID");
  if(result.consensus.proposedResponse.status!=="ADVISORY")throw new Error("MENTOR_ADVISORY_STATUS_REQUIRED");
  if(result.consensus.proposedResponse.humanDecisionRequired!==true)throw new Error("MENTOR_HUMAN_DECISION_REQUIRED");
  if(result.provenance.provenanceRefs.length===0)throw new Error("MENTOR_PROVENANCE_REQUIRED");

  const inspected=inspectMentorRun(result.runId,actor,db);
  if(!inspected)throw new Error("MENTOR_RUN_NOT_INSPECTABLE");
  const auditSchema=(db.prepare("PRAGMA table_info(mentor_action_audit)").all() as Array<{name:string}>).map(x=>x.name);
  if(auditSchema.includes("question")||auditSchema.includes("output_json"))throw new Error("MENTOR_AUDIT_CONTENT_LEAK");
  const auditCount=(db.prepare("SELECT COUNT(*) AS n FROM mentor_action_audit WHERE run_id=?").get(result.runId) as {n:number}).n;
  if(auditCount<2)throw new Error("MENTOR_AUDIT_INCOMPLETE");
  auditEventCount=auditCount;
  advisory=result.consensus.proposedResponse.status==="ADVISORY";
  humanDecisionRequired=result.consensus.proposedResponse.humanDecisionRequired===true;
  provenanceVerified=result.provenance.provenanceRefs.length>0;
  remoteObservationVerified=true;

  inputHash=remote.inputHash;
  outputHash=remote.outputHash;
  safetyOutcome=result.safetyReview.status;

  const report={
    ...reportBase,
    modelBinding,
    status:"PASS",
    inputHash,
    outputHash,
    durationMs:Date.now()-started,
    safetyOutcome,
    contractValidation:"PASS",
    auditEventCount,
    advisory,
    humanDecisionRequired,
    provenanceVerified,
    remoteObservationVerified,
    failureCode:null
  };
  writeReport(report);
  console.log("LIVE_PROVIDER_CONFORMANCE=PASS");
}catch(error){
  const code=safeFailure(error);
  writeReport({
    ...reportBase,
    modelBinding,
    status:"FAIL",
    inputHash:inputHash||null,
    outputHash:outputHash||null,
    durationMs:Date.now()-started,
    safetyOutcome,
    contractValidation:"FAIL",
    auditEventCount,
    advisory,
    humanDecisionRequired,
    provenanceVerified,
    remoteObservationVerified,
    failureCode:code
  });
  console.error("LIVE_PROVIDER_CONFORMANCE="+code);
  process.exitCode=1;
}
