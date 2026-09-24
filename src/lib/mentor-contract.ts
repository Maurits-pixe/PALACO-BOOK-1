import { z } from "zod";

export const claimLabel=z.enum(["FACT","INFERENCE","HYPOTHESIS","UNKNOWN"]);
export const claimStance=z.enum(["SUPPORT","CHALLENGE","NEUTRAL"]);
export const dataClassification=z.literal("SYNTHETIC_ALPHA");

export const mentorClaimSchema=z.object({
  claimKey:z.string().min(1),
  text:z.string().min(1),
  label:claimLabel,
  stance:claimStance,
  evidenceRefs:z.array(z.string()).default([])
});

export const mentorProviderOutputSchema=z.object({
  claims:z.array(mentorClaimSchema),
  uncertainties:z.array(z.string()).default([]),
  limitations:z.array(z.string()).default([]),
  recommendationsOrOptions:z.array(z.string()).default([]),
  safetyFlags:z.array(z.string()).default([]),
  dissentSignals:z.array(z.string()).default([])
});

export type MentorProviderOutput=z.infer<typeof mentorProviderOutputSchema>;

export type MentorInput={
  correlationId:string;
  question:string;
  caseId:string;
  dataClassification:"SYNTHETIC_ALPHA";
  contextHash:string;
  inputRefs:string[];
  provenanceRefs:string[];
  evidenceRefs:string[];
  knowledge:Array<{id:string;title:string;content:string;version:number;sourceIds:string[]}>;
};

export type MentorDescriptor={
  mentorId:string;
  adapterKind:"REMOTE"|"MOCK";
  modelBinding:string;
  capabilityBinding:string[];
  promptVersion:string;
};

export type MentorObservation={
  observationId:string;
  auditId:string;
  correlationId:string;
  mentorId:string;
  adapterKind:"REMOTE"|"MOCK";
  modelBinding:string;
  capabilityBinding:string[];
  promptVersion:string;
  inputRefs:string[];
  provenanceRefs:string[];
  inputHash:string;
  outputHash:string;
  output:MentorProviderOutput;
  uncertainties:string[];
  safetyFlags:string[];
  dissentSignals:string[];
  createdAt:string;
};

export interface MentorAdapter{
  descriptor:MentorDescriptor;
  analyze(input:MentorInput):Promise<MentorObservation>;
}
