import type { AuditEvent,KnowledgeObject } from "./domain";
import type { CaseRecord } from "./store";

export type SourceRecord={id:string;uri:string;title:string;version:number;checksum:string;createdAt:string};
export type ProvenanceRecord={id:string;knowledgeId:string;sourceId:string;sourceVersion:number;status:"UNKNOWN"|"PARTIAL"|"TRACEABLE"|"VERIFIED"|"REVOKED";createdAt:string};

export interface CaseRepository{insert(value:CaseRecord):void;get(id:string):CaseRecord|undefined;}
export interface KnowledgeRepository{insert(value:KnowledgeObject):void;listByCase(caseId:string):KnowledgeObject[];}
export interface SourceRepository{insert(value:SourceRecord):void;get(id:string,version:number):SourceRecord|undefined;}
export interface ProvenanceRepository{insert(value:ProvenanceRecord):void;listByKnowledge(knowledgeId:string):ProvenanceRecord[];}
export interface AuditRepository{append(value:AuditEvent):void;listForObjects(ids:string[]):AuditEvent[];}
