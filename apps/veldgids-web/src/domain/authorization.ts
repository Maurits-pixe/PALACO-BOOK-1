export type Role="OWNER"|"DEVELOPER"|"EDITOR"|"REVIEWER"|"MENTOR"|"USER";
export type Decision="ALLOW"|"DENY";
export interface AuthorizationContext{role:Role;action:string;resource:string;explicitExternalAuthorization?:boolean}
export function authorize(ctx:AuthorizationContext):Decision{if(ctx.action.startsWith("external:")&&!ctx.explicitExternalAuthorization)return "DENY";if(ctx.role==="OWNER")return "ALLOW";if(ctx.action==="read")return "ALLOW";return "DENY"}
