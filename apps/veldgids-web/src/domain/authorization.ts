export type Role="OWNER"|"DEVELOPER"|"EDITOR"|"REVIEWER"|"MENTOR"|"USER";
export type Decision="ALLOW"|"DENY";
export type GrantStatus="ACTIVE"|"REVOKED"|"EXPIRED";

export interface ExternalAuthorizationGrant{
  grantId:string;
  actorId:string;
  action:string;
  resource:string;
  issuedAt:string;
  validUntil:string;
  status:GrantStatus;
  policyVersion:string;
}

export interface AuthorizationContext{
  actorId:string;
  role:Role;
  action:string;
  resource:string;
  trustedTime:string;
  externalGrant?:ExternalAuthorizationGrant;
}

function isBoundActiveGrant(ctx:AuthorizationContext):boolean{
  const grant=ctx.externalGrant;
  if(!grant||grant.status!=="ACTIVE")return false;
  if(grant.actorId!==ctx.actorId||grant.action!==ctx.action||grant.resource!==ctx.resource)return false;
  const now=Date.parse(ctx.trustedTime);
  const validUntil=Date.parse(grant.validUntil);
  const issuedAt=Date.parse(grant.issuedAt);
  if(!Number.isFinite(now)||!Number.isFinite(validUntil)||!Number.isFinite(issuedAt))return false;
  return issuedAt<=now&&now<=validUntil;
}

export function authorize(ctx:AuthorizationContext):Decision{
  if(ctx.action.startsWith("external:")&&!isBoundActiveGrant(ctx))return "DENY";
  if(ctx.role==="OWNER")return "ALLOW";
  if(ctx.action==="read")return "ALLOW";
  return "DENY";
}
