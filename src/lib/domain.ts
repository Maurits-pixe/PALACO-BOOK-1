import { z } from "zod";

export const provenanceState = z.enum(["UNKNOWN","PARTIAL","TRACEABLE","VERIFIED","REVOKED"]);
export const knowledgeStatus = z.enum(["CONCEPT","IN_REVIEW","VERIFIED","PUBLISHED","ARCHIVED","REVOKED"]);
export const caseStatus = z.enum(["DRAFT","ACTIVE","REVIEW","CLOSED","ARCHIVED"]);

export const sourceRefSchema=z.object({sourceId:z.string().min(1),version:z.number().int().positive(),provenance:provenanceState});
export const knowledgeObjectSchema=z.object({id:z.string().min(1),caseId:z.string().min(1),title:z.string().min(1),content:z.string().min(1),status:knowledgeStatus,version:z.number().int().positive(),sources:z.array(sourceRefSchema).min(1),createdAt:z.string().datetime()});
export const caseSchema=z.object({id:z.string().min(1),title:z.string().min(1),objective:z.string().min(1),status:caseStatus,createdAt:z.string().datetime()});
export type KnowledgeObject=z.infer<typeof knowledgeObjectSchema>;

export type AuditEvent={eventId:string;actor:string;action:string;object:string;objectVersion:number;timestamp:string;authorizationContext:string;outcome:"ALLOWED"|"DENIED";provenanceRefs:string[]};

export function assertPublishable(input: KnowledgeObject){if(input.status==="PUBLISHED"&&input.sources.some(s=>s.provenance==="UNKNOWN"||s.provenance==="REVOKED"))throw new Error("PROVENANCE_GATE_DENIED");return input;}
