export type KnowledgeStatus="CONCEPT"|"IN_REVIEW"|"VERIFIED"|"PUBLISHED"|"ARCHIVED"|"REVOKED";
export type ProvenanceState="UNKNOWN"|"PARTIAL"|"TRACEABLE"|"VERIFIED"|"REVOKED";
export interface KnowledgeObject{id:string;title:string;type:string;summary:string;version:string;status:KnowledgeStatus;provenance:ProvenanceState;sourceRefs:string[];relationIds:string[];updatedAt:string}

function semverTuple(version:string):[number,number,number]|null{
  const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if(!match)return null;
  return [Number(match[1]),Number(match[2]),Number(match[3])];
}

export function isVersionAfter(current:string,next:string):boolean{
  const a=semverTuple(current),b=semverTuple(next);
  if(!a||!b)return false;
  for(let i=0;i<3;i++){if(b[i]>a[i])return true;if(b[i]<a[i])return false}
  return false;
}

export function canReplacePublished(current:KnowledgeObject,next:KnowledgeObject):boolean{
  if(current.id!==next.id)return false;
  if(current.status!=="PUBLISHED")return true;
  return isVersionAfter(current.version,next.version);
}
