export type KnowledgeStatus="CONCEPT"|"IN_REVIEW"|"VERIFIED"|"PUBLISHED"|"ARCHIVED"|"REVOKED";
export type ProvenanceState="UNKNOWN"|"PARTIAL"|"TRACEABLE"|"VERIFIED"|"REVOKED";
export interface KnowledgeObject{id:string;title:string;type:string;summary:string;version:string;status:KnowledgeStatus;provenance:ProvenanceState;sourceRefs:string[];relationIds:string[];updatedAt:string}
export const canReplacePublished=(current:KnowledgeObject,next:KnowledgeObject)=>current.status!=="PUBLISHED"||current.version!==next.version;
