import { createHash,randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { database } from "./sqlite";
import { sqliteRepositories } from "./sqlite-repositories";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";
import type { MentorAdapter,MentorInput,MentorObservation } from "./mentor-contract";

function hash(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function json(value:unknown){return JSON.stringify(value);}
function now(){return new Date().toISOString();}

const injectionPatterns=[
  /ignore\s+(all|any|the)?\s*(previous|prior)\s+instructions/i,
  /reveal\s+(the\s+)?(system|developer)\s+prompt/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /override\s+(the\s+)?(system|safety|policy)/i
];

function detectPromptInjection(input:MentorInput){
  const corpus=[input.question,...input.knowledge.map(k=>k.content)].join("\n");
  return injectionPatterns.some(pattern=>pattern.test(corpus));
}

function synthesize(observations:MentorObservation[]){
  const groups=new Map<string,Array<{mentorId:string;text:string;stance:string;evidenceRefs:string[]}>>();
  for(const observation of observations){
    for(const claim of observation.output.claims){
      const list=groups.get(claim.claimKey)??[];
      list.push({mentorId:observation.mentorId,text:claim.text,stance:claim.stance,evidenceRefs:claim.evidenceRefs});
      groups.set(claim.claimKey,list);
    }
  }
  const agreedClaims:string[]=[];
  const disputedClaims:string[]=[];
  const minorityClaims:string[]=[];
  const evidenceConflicts:string[]=[];
  for(const [key,entries] of groups){
    const stances=new Set(entries.map(e=>e.stance));
    const texts=new Set(entries.map(e=>e.text.trim().toLowerCase()));
    const evidenceShapes=new Set(entries.map(e=>[...e.evidenceRefs].sort().join("|")));
    if(entries.length===observations.length&&stances.size===1&&texts.size===1)agreedClaims.push(key);
    else if(stances.size>1||texts.size>1)disputedClaims.push(key);
    else minorityClaims.push(key);
    if(evidenceShapes.size>1)evidenceConflicts.push(key);
  }
  const unresolvedQuestions=[...new Set(observations.flatMap(o=>o.uncertainties))];
  const options=[...new Set(observations.flatMap(o=>o.output.recommendationsOrOptions))];
  const dissentSignals=[...new Set(observations.flatMap(o=>o.dissentSignals))];
  return {
    agreedClaims,disputedClaims,minorityClaims,evidenceConflicts,unresolvedQuestions,
    proposedResponse:{
      status:"ADVISORY" as const,
      summary:agreedClaims.length?"Shared observations: "+agreedClaims.join(", ")+".":"No universal consensus was established.",
      dissent:[...new Set([...disputedClaims,...minorityClaims,...dissentSignals])],
      uncertainty:unresolvedQuestions,
      options,
      humanDecisionRequired:true
    }
  };
}

function insertActionAudit(db:Database.Database,input:{
  id:string;runId:string;correlationId:string;actorId:string;caseId:string;knowledgeIds:string[];eventType:string;
  mentorId?:string;modelBinding?:string;promptVersion?:string;inputHash:string;outputHash?:string;
  provenanceRefs:string[];safetyOutcome:string;timestamp:string;
}){
  db.prepare("INSERT INTO mentor_action_audit(id,run_id,correlation_id,actor_id,case_id,knowledge_ids_json,event_type,mentor_id,model_binding,prompt_version,input_hash,output_hash,provenance_refs_json,safety_outcome,timestamp) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    input.id,input.runId,input.correlationId,input.actorId,input.caseId,json(input.knowledgeIds),input.eventType,
    input.mentorId??null,input.modelBinding??null,input.promptVersion??null,input.inputHash,input.outputHash??null,
    json(input.provenanceRefs),input.safetyOutcome,input.timestamp
  );
}

export type MentorRunRequest={caseId:string;correlationId:string;question:string;dataClassification:"SYNTHETIC_ALPHA"};

export async function runMentorCouncil(request:MentorRunRequest,actor:ActorContext,adapters:readonly MentorAdapter[],db:Database.Database=database()){
  requireAuthorization(actor.role,"MENTOR_RUN");
  if(request.dataClassification!=="SYNTHETIC_ALPHA")throw new Error("MENTOR_ALPHA_SYNTHETIC_DATA_ONLY");
  if(adapters.length!==3)throw new Error("MENTOR_ALPHA_REQUIRES_THREE_ADAPTERS");
  if(db.prepare("SELECT id FROM mentor_runs WHERE correlation_id=?").get(request.correlationId))throw new Error("MENTOR_REPLAY_REQUEST");
  const repos=sqliteRepositories(db);
  const caseRecord=repos.cases.get(request.caseId);
  if(!caseRecord)throw new Error("CASE_NOT_FOUND");
  const knowledge=repos.knowledge.listByCase(request.caseId);
  if(knowledge.length===0)throw new Error("MENTOR_KNOWLEDGE_REQUIRED");
  const provenanceByKnowledge=knowledge.map(k=>({knowledgeId:k.id,records:repos.provenance.listByKnowledge(k.id)}));
  if(provenanceByKnowledge.some(x=>x.records.length===0))throw new Error("MENTOR_PROVENANCE_REQUIRED");
  const provenanceRefs=provenanceByKnowledge.flatMap(x=>x.records.map(r=>r.id));
  const evidenceRefs=[...new Set(provenanceByKnowledge.flatMap(x=>x.records.map(r=>r.sourceId)))];
  const inputRefs=[request.caseId,...knowledge.map(k=>k.id)];
  const knowledgeContext=knowledge.map(k=>({id:k.id,title:k.title,content:k.content,version:k.version,sourceIds:k.sources.map(s=>s.sourceId)}));
  const contextHash=hash({caseId:request.caseId,knowledge:knowledgeContext,provenanceRefs,evidenceRefs});
  const questionHash=hash(request.question);
  const runId=randomUUID();
  const createdAt=now();
  const mentorInput:MentorInput={correlationId:request.correlationId,question:request.question,caseId:request.caseId,dataClassification:"SYNTHETIC_ALPHA",contextHash,inputRefs,provenanceRefs,evidenceRefs,knowledge:knowledgeContext};
  const inputHash=hash(mentorInput);
  db.prepare("INSERT INTO mentor_runs(id,correlation_id,case_id,actor_id,question_hash,input_context_hash,input_refs_json,provenance_refs_json,run_status,safety_status,error_code,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    runId,request.correlationId,request.caseId,actor.actorId,questionHash,contextHash,json(inputRefs),json(provenanceRefs),"RUNNING","PENDING",null,createdAt,null
  );
  if(detectPromptInjection(mentorInput)){
    const timestamp=now();
    db.transaction(()=>{
      db.prepare("UPDATE mentor_runs SET run_status='BLOCKED',safety_status='BLOCKED',error_code=?,completed_at=? WHERE id=?").run("MENTOR_PROMPT_INJECTION_BLOCKED",timestamp,runId);
      insertActionAudit(db,{id:randomUUID(),runId,correlationId:request.correlationId,actorId:actor.actorId,caseId:request.caseId,knowledgeIds:knowledge.map(k=>k.id),eventType:"MENTOR_RUN_BLOCKED",inputHash,provenanceRefs,safetyOutcome:"BLOCKED",timestamp});
    })();
    throw new Error("MENTOR_PROMPT_INJECTION_BLOCKED");
  }
  let observations:MentorObservation[];
  try{
    observations=await Promise.all(adapters.map(adapter=>adapter.analyze(mentorInput)));
  }catch(error){
    const timestamp=now();
    const errorCode=error instanceof Error?error.message:"MENTOR_PROVIDER_FAILURE";
    db.transaction(()=>{
      db.prepare("UPDATE mentor_runs SET run_status='FAILED',safety_status='ESCALATE',error_code=?,completed_at=? WHERE id=?").run(errorCode,timestamp,runId);
      insertActionAudit(db,{id:randomUUID(),runId,correlationId:request.correlationId,actorId:actor.actorId,caseId:request.caseId,knowledgeIds:knowledge.map(k=>k.id),eventType:"MENTOR_RUN_FAILED",inputHash,provenanceRefs,safetyOutcome:"ESCALATE",timestamp});
    })();
    throw error;
  }
  try{
    for(let index=0;index<observations.length;index++){
      const observation=observations[index];
      const descriptor=adapters[index]?.descriptor;
      if(!observation||!descriptor)throw new Error("MENTOR_OBSERVATION_DESCRIPTOR_MISSING");
      if(observation.correlationId!==request.correlationId)throw new Error("MENTOR_CORRELATION_MISMATCH");
      if(observation.provenanceRefs.length===0)throw new Error("MENTOR_OBSERVATION_PROVENANCE_REQUIRED");
      if(observation.mentorId!==descriptor.mentorId)throw new Error("MENTOR_BINDING_MISMATCH");
      if(observation.modelBinding!==descriptor.modelBinding)throw new Error("MENTOR_BINDING_MISMATCH");
      if(observation.promptVersion!==descriptor.promptVersion)throw new Error("MENTOR_BINDING_MISMATCH");
      if(JSON.stringify([...observation.capabilityBinding].sort())!==JSON.stringify([...descriptor.capabilityBinding].sort()))throw new Error("MENTOR_BINDING_MISMATCH");
    }
  }catch(error){
    const timestamp=now();
    const errorCode=error instanceof Error?error.message:"MENTOR_OBSERVATION_INVALID";
    db.transaction(()=>{
      db.prepare("UPDATE mentor_runs SET run_status='FAILED',safety_status='ESCALATE',error_code=?,completed_at=? WHERE id=?").run(errorCode,timestamp,runId);
      insertActionAudit(db,{id:randomUUID(),runId,correlationId:request.correlationId,actorId:actor.actorId,caseId:request.caseId,knowledgeIds:knowledge.map(k=>k.id),eventType:"MENTOR_RUN_FAILED",inputHash,provenanceRefs,safetyOutcome:"ESCALATE",timestamp});
    })();
    throw error;
  }
  const synthesis=synthesize(observations);
  const safetyStatus=observations.some(o=>o.safetyFlags.length>0)?"ESCALATE":"PASS";
  const completedAt=now();
  const consensusId=randomUUID();
  db.transaction(()=>{
    const insertObservation=db.prepare("INSERT INTO mentor_observations(id,run_id,audit_id,correlation_id,mentor_id,adapter_kind,model_binding,capability_binding_json,prompt_version,input_hash,output_hash,input_refs_json,provenance_refs_json,output_json,uncertainties_json,safety_flags_json,dissent_signals_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for(const observation of observations){
      insertObservation.run(observation.observationId,runId,observation.auditId,observation.correlationId,observation.mentorId,observation.adapterKind,observation.modelBinding,json(observation.capabilityBinding),observation.promptVersion,observation.inputHash,observation.outputHash,json(observation.inputRefs),json(observation.provenanceRefs),json(observation.output),json(observation.uncertainties),json(observation.safetyFlags),json(observation.dissentSignals),observation.createdAt);
      insertActionAudit(db,{id:observation.auditId,runId,correlationId:request.correlationId,actorId:actor.actorId,caseId:request.caseId,knowledgeIds:knowledge.map(k=>k.id),eventType:"MENTOR_OBSERVATION",mentorId:observation.mentorId,modelBinding:observation.modelBinding,promptVersion:observation.promptVersion,inputHash:observation.inputHash,outputHash:observation.outputHash,provenanceRefs:observation.provenanceRefs,safetyOutcome:observation.safetyFlags.length?"ESCALATE":"PASS",timestamp:observation.createdAt});
    }
    db.prepare("INSERT INTO mentor_consensus(id,run_id,participating_mentors_json,agreed_claims_json,disputed_claims_json,minority_claims_json,evidence_conflicts_json,unresolved_questions_json,proposed_response_json,synthesis_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
      consensusId,runId,json(observations.map(o=>o.mentorId)),json(synthesis.agreedClaims),json(synthesis.disputedClaims),json(synthesis.minorityClaims),json(synthesis.evidenceConflicts),json(synthesis.unresolvedQuestions),json(synthesis.proposedResponse),"synthesis-v0.1",completedAt
    );
    db.prepare("UPDATE mentor_runs SET run_status='COMPLETED',safety_status=?,completed_at=? WHERE id=?").run(safetyStatus,completedAt,runId);
    insertActionAudit(db,{id:randomUUID(),runId,correlationId:request.correlationId,actorId:actor.actorId,caseId:request.caseId,knowledgeIds:knowledge.map(k=>k.id),eventType:"MENTOR_RUN_COMPLETED",inputHash,outputHash:hash({observations:observations.map(o=>o.outputHash),synthesis}),provenanceRefs,safetyOutcome:safetyStatus,timestamp:completedAt});
  })();
  return {
    runId,correlationId:request.correlationId,caseId:request.caseId,knowledgeIds:knowledge.map(k=>k.id),
    safetyReview:{status:safetyStatus,flags:[...new Set(observations.flatMap(o=>o.safetyFlags))]},
    observations,
    consensus:{id:consensusId,...synthesis},
    provenance:{inputRefs,provenanceRefs,evidenceRefs,contextHash},
    audit:{eventCount:observations.length+1,correlationId:request.correlationId}
  };
}

export function inspectMentorRun(runId:string,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"AUDIT_READ");
  const run=db.prepare("SELECT * FROM mentor_runs WHERE id=?").get(runId) as Record<string,unknown>|undefined;
  if(!run)return null;
  const observations=db.prepare("SELECT * FROM mentor_observations WHERE run_id=? ORDER BY created_at,mentor_id").all(runId);
  const consensus=db.prepare("SELECT * FROM mentor_consensus WHERE run_id=?").get(runId)??null;
  const audit=db.prepare("SELECT * FROM mentor_action_audit WHERE run_id=? ORDER BY timestamp,id").all(runId);
  return {run,observations,consensus,audit};
}
