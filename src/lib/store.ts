import type { AuditEvent,KnowledgeObject } from "./domain";
export type CaseRecord={id:string;title:string;objective:string;status:"DRAFT"|"ACTIVE"|"REVIEW"|"CLOSED"|"ARCHIVED";createdAt:string};
type State={cases:Map<string,CaseRecord>;knowledge:Map<string,KnowledgeObject>;audit:AuditEvent[]};
const g=globalThis as typeof globalThis&{__bluebook?:State};
const state:State=g.__bluebook??={cases:new Map<string,CaseRecord>(),knowledge:new Map<string,KnowledgeObject>(),audit:[] as AuditEvent[]};g.__bluebook=state;
export const store={createCase(v:CaseRecord){state.cases.set(v.id,v);return v},listCases(){return [...state.cases.values()]},createKnowledge(v:KnowledgeObject){state.knowledge.set(v.id,v);return v},listKnowledge(caseId:string){return [...state.knowledge.values()].filter(x=>x.caseId===caseId)},appendAudit(v:AuditEvent){state.audit.push(Object.freeze({...v}));return v},audit(){return [...state.audit]}};
