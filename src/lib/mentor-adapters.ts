import { mentorOutputSchema,type MentorAdapter,type MentorInput,type MentorOutput } from "./mentor-contract";

export class RemoteMentorAdapter implements MentorAdapter{
  descriptor;
  constructor(private config:{mentorId:string;endpoint:string;apiKey?:string;modelBinding:string;promptVersion:string;timeoutMs?:number}){
    this.descriptor={mentorId:config.mentorId,adapterKind:"REMOTE" as const,modelBinding:config.modelBinding,promptVersion:config.promptVersion};
  }

  async analyze(input:MentorInput):Promise<MentorOutput>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),this.config.timeoutMs??15000);
    try{
      const response=await fetch(this.config.endpoint,{
        method:"POST",
        headers:{
          "content-type":"application/json",
          ...(this.config.apiKey?{authorization:`Bearer ${this.config.apiKey}`}:{})
        },
        body:JSON.stringify({
          mentor_id:this.descriptor.mentorId,
          model:this.descriptor.modelBinding,
          prompt_version:this.descriptor.promptVersion,
          input
        }),
        signal:controller.signal
      });
      if(!response.ok)throw new Error(`MENTOR_REMOTE_HTTP_${response.status}`);
      return mentorOutputSchema.parse(await response.json());
    }catch(error){
      if(error instanceof Error&&error.name==="AbortError")throw new Error("MENTOR_REMOTE_TIMEOUT");
      throw error;
    }finally{
      clearTimeout(timeout);
    }
  }
}

export class MockMentorAdapter implements MentorAdapter{
  descriptor;
  constructor(config:{mentorId:string;modelBinding:string;promptVersion:string},private output:MentorOutput){
    this.descriptor={mentorId:config.mentorId,adapterKind:"MOCK" as const,modelBinding:config.modelBinding,promptVersion:config.promptVersion};
  }
  async analyze(_input:MentorInput){return mentorOutputSchema.parse(this.output);}
}

export function configuredMentorAdapters(){
  const endpoint=process.env.PALACO_MENTOR_ENDPOINT;
  const model=process.env.PALACO_MENTOR_MODEL;
  if(!endpoint||!model)throw new Error("MENTOR_REMOTE_NOT_CONFIGURED");
  const promptVersion=process.env.PALACO_MENTOR_PROMPT_VERSION??"mentor-v0.1";
  const remote=new RemoteMentorAdapter({
    mentorId:"M12",
    endpoint,
    apiKey:process.env.PALACO_MENTOR_API_KEY,
    modelBinding:model,
    promptVersion
  });
  const ethics=new MockMentorAdapter(
    {mentorId:"M08",modelBinding:"mock:ethics-v0.1",promptVersion},
    {claims:[{claimKey:"evidence-boundary",text:"Keep source evidence distinct from AI analysis.",label:"FACT",stance:"SUPPORT",evidenceRefs:[]}],uncertainties:[],limitations:["Mock mentor for v0.1-alpha."],recommendationsOrOptions:["Preserve human review."],safetyFlags:[]}
  );
  const redTeam=new MockMentorAdapter(
    {mentorId:"F08",modelBinding:"mock:red-team-v0.1",promptVersion},
    {claims:[{claimKey:"evidence-boundary",text:"Keep source evidence distinct from AI analysis.",label:"FACT",stance:"SUPPORT",evidenceRefs:[]},{claimKey:"authority-risk",text:"AI output must not become authority by default.",label:"INFERENCE",stance:"CHALLENGE",evidenceRefs:[]}],uncertainties:["Remote mentor output may require independent verification."],limitations:["Mock mentor for v0.1-alpha."],recommendationsOrOptions:["Retain dissent explicitly."],safetyFlags:[]}
  );
  return [remote,ethics,redTeam] as const;
}
