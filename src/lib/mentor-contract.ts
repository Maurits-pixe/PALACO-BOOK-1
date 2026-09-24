import { z } from "zod";

export const claimLabel=z.enum(["FACT","INFERENCE","HYPOTHESIS","UNKNOWN"]);
export const claimStance=z.enum(["SUPPORT","CHALLENGE","NEUTRAL"]);

export const mentorClaimSchema=z.object({
  claimKey:z.string().min(1),
  text:z.string().min(1),
  label:claimLabel,
  stance:claimStance,
  evidenceRefs:z.array(z.string()).default([])
});

export const mentorOutputSchema=z.object({
  claims:z.array(mentorClaimSchema),
  uncertainties:z.array(z.string()).default([]),
  limitations:z.array(z.string()).default([]),
  recommendationsOrOptions:z.array(z.string()).default([]),
  safetyFlags:z.array(z.string()).default([])
});

export type MentorOutput=z.infer<typeof mentorOutputSchema>;

export type MentorInput={
  question:string;
  caseId:string;
  contextHash:string;
  evidenceRefs:string[];
  knowledge:Array<{id:string;title:string;content:string;version:number;sourceIds:string[]}>;
};

export type MentorDescriptor={
  mentorId:string;
  adapterKind:"REMOTE"|"MOCK";
  modelBinding:string;
  promptVersion:string;
};

export interface MentorAdapter{
  descriptor:MentorDescriptor;
  analyze(input:MentorInput):Promise<MentorOutput>;
}
