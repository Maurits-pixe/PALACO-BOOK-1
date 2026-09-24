export type Role="OWNER"|"DEVELOPER"|"EDITOR"|"REVIEWER"|"MENTOR"|"USER";
export type Action="CASE_CREATE"|"KNOWLEDGE_CREATE"|"KNOWLEDGE_PUBLISH"|"AUDIT_READ";
const grants:Record<Role,readonly Action[]>={OWNER:["CASE_CREATE","KNOWLEDGE_CREATE","KNOWLEDGE_PUBLISH","AUDIT_READ"],DEVELOPER:["CASE_CREATE","KNOWLEDGE_CREATE","AUDIT_READ"],EDITOR:["CASE_CREATE","KNOWLEDGE_CREATE"],REVIEWER:["KNOWLEDGE_PUBLISH","AUDIT_READ"],MENTOR:[],USER:["CASE_CREATE","KNOWLEDGE_CREATE"]};
export function authorize(role:Role,action:Action){return grants[role]?.includes(action)===true;}
export function requireAuthorization(role:Role,action:Action){if(!authorize(role,action))throw new Error("AUTHORIZATION_DENIED");}
