import { createHash,randomUUID } from "node:crypto";
import { mentorProviderOutputSchema,type MentorAdapter,type MentorDescriptor,type MentorInput,type MentorObservation,type MentorProviderOutput } from "./mentor-contract";

function hash(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}

function observation(descriptor:MentorDescriptor,input:MentorInput,output:MentorProviderOutput,deterministic=false):MentorObservation{
  const inputHash=hash({
    question:input.question,
    caseId:input.caseId,
    contextHash:input.contextHash,
    inputRefs:input.inputRefs,
    provenanceRefs:input.provenanceRefs,
    evidenceRefs:input.evidenceRefs,
    knowledge:input.knowledge
  });
  const outputHash=hash(output);
  const seed=hash({mentorId:descriptor.mentorId,correlationId:input.correlationId,inputHash,outputHash});
  return {
    observationId:deterministic?`obs-${seed.slice(0,24)}`:randomUUID(),
    auditId:deterministic?`audit-${seed.slice(24,48)}`:randomUUID(),
    correlationId:input.correlationId,
    mentorId:descriptor.mentorId,
    adapterKind:descriptor.adapterKind,
    modelBinding:descriptor.modelBinding,
    capabilityBinding:descriptor.capabilityBinding,
    promptVersion:descriptor.promptVersion,
    inputRefs:input.inputRefs,
    provenanceRefs:input.provenanceRefs,
    inputHash,
    outputHash,
    output,
    uncertainties:output.uncertainties,
    safetyFlags:output.safetyFlags,
    dissentSignals:output.dissentSignals,
    createdAt:new Date().toISOString()
  };
}

export class RemoteMentorAdapter implements MentorAdapter{
  descriptor:MentorDescriptor;
  constructor(private config:{mentorId:string;endpoint:string;apiKey:string;modelBinding:string;capabilityBinding:string[];promptVersion:string;timeoutMs?:number}){
    this.descriptor={mentorId:config.mentorId,adapterKind:"REMOTE",modelBinding:config.modelBinding,capabilityBinding:config.capabilityBinding,promptVersion:config.promptVersion};
  }

  async analyze(input:MentorInput):Promise<MentorObservation>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),this.config.timeoutMs??15000);
    try{
      const response=await fetch(this.config.endpoint,{
        method:"POST",
        headers:{
          "content-type":"application/json",
          authorization:`Bearer ${this.config.apiKey}`
        },
        body:JSON.stringify({
          mentor_id:this.descriptor.mentorId,
          model:this.descriptor.modelBinding,
          capabilities:this.descriptor.capabilityBinding,
          prompt_version:this.descriptor.promptVersion,
          correlation_id:input.correlationId,
          input
        }),
        signal:controller.signal
      });
      if(!response.ok)throw new Error(`MENTOR_REMOTE_HTTP_${response.status}`);
      const output=mentorProviderOutputSchema.parse(await response.json());
      return observation(this.descriptor,input,output,false);
    }catch(error){
      if(error instanceof Error&&error.name==="AbortError")throw new Error("MENTOR_REMOTE_TIMEOUT");
      throw error;
    }finally{
      clearTimeout(timeout);
    }
  }
}

export class MockMentorAdapter implements MentorAdapter{
  descriptor:MentorDescriptor;
  constructor(config:{mentorId:string;modelBinding:string;capabilityBinding:string[];promptVersion:string},private output:MentorProviderOutput){
    this.descriptor={mentorId:config.mentorId,adapterKind:"MOCK",modelBinding:config.modelBinding,capabilityBinding:config.capabilityBinding,promptVersion:config.promptVersion};
  }
  async analyze(input:MentorInput){
    return observation(this.descriptor,input,mentorProviderOutputSchema.parse(this.output),true);
  }
}

export function configuredMentorAdapters(){
  if(process.env.PALACO_MENTOR_REMOTE_ENABLED!=="true")throw new Error("MENTOR_REMOTE_DISABLED");
  const endpoint=process.env.PALACO_MENTOR_ENDPOINT;
  const model=process.env.PALACO_MENTOR_MODEL;
  const apiKey=process.env.PALACO_MENTOR_API_KEY;
  if(!endpoint||!model||!apiKey)throw new Error("MENTOR_REMOTE_NOT_CONFIGURED");
  const promptVersion=process.env.PALACO_MENTOR_PROMPT_VERSION??"mentor-v0.1";

  const remote=new RemoteMentorAdapter({
    mentorId:"M12",
    endpoint,
    apiKey,
    modelBinding:model,
    capabilityBinding:["evidence-analysis","source-comparison"],
    promptVersion
  });

  const evidenceMock=new MockMentorAdapter(
    {mentorId:"M08",modelBinding:"mock:evidence-v0.1",capabilityBinding:["evidence-boundary","human-oversight"],promptVersion},
    {
      claims:[{claimKey:"evidence-boundary",text:"Source evidence must remain distinct from AI analysis.",label:"FACT",stance:"SUPPORT",evidenceRefs:[]}],
      uncertainties:[],
      limitations:["Deterministic synthetic-alpha mock."],
      recommendationsOrOptions:["Preserve human review."],
      safetyFlags:[],
      dissentSignals:[]
    }
  );

  const dissentMock=new MockMentorAdapter(
    {mentorId:"F08",modelBinding:"mock:dissent-v0.1",capabilityBinding:["red-team","dissent"],promptVersion},
    {
      claims:[
        {claimKey:"evidence-boundary",text:"Source evidence must remain distinct from AI analysis.",label:"FACT",stance:"SUPPORT",evidenceRefs:[]},
        {claimKey:"authority-risk",text:"A generated synthesis should not be treated as authority.",label:"INFERENCE",stance:"CHALLENGE",evidenceRefs:[]}
      ],
      uncertainties:["Remote-provider output may require independent verification."],
      limitations:["Deterministic synthetic-alpha dissent mock."],
      recommendationsOrOptions:["Retain dissent explicitly."],
      safetyFlags:[],
      dissentSignals:["authority-risk"]
    }
  );
  return [remote,evidenceMock,dissentMock] as const;
}
