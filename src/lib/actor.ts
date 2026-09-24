import type { Role } from "./authorization";

export type ActorContext={actorId:string;role:Role;authentication:"TEST"|"TRUSTED_PROXY"};
const roles=new Set<Role>(["OWNER","DEVELOPER","EDITOR","REVIEWER","MENTOR","USER"]);

export function requireActor(req:Request):ActorContext{
  if(process.env.NODE_ENV==="test"){
    const actorId=req.headers.get("x-palaco-test-actor");
    const role=req.headers.get("x-palaco-test-role") as Role|null;
    if(actorId&&role&&roles.has(role))return {actorId,role,authentication:"TEST"};
  }
  if(process.env.PALACO_AUTH_MODE!=="trusted-proxy")throw new Error("IDENTITY_NOT_CONFIGURED");
  if(req.headers.get("x-palaco-authenticated")!=="true")throw new Error("AUTHENTICATION_REQUIRED");
  const actorId=req.headers.get("x-palaco-actor-id");
  const role=req.headers.get("x-palaco-role") as Role|null;
  if(!actorId||!role||!roles.has(role))throw new Error("INVALID_ACTOR_CONTEXT");
  return {actorId,role,authentication:"TRUSTED_PROXY"};
}
