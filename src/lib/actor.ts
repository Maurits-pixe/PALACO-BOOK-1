import type Database from "better-sqlite3";
import type { Role } from "./authorization";
import { database } from "./sqlite";
import { readSessionCookie,resolveSession } from "./identity";

export type ActorContext={actorId:string;role:Role;authentication:"TEST"|"SESSION"|"TRUSTED_PROXY"};
const roles=new Set<Role>(["OWNER","DEVELOPER","EDITOR","REVIEWER","MENTOR","USER"]);

export function requireActor(req:Request,db:Database.Database=database()):ActorContext{
  if(process.env.NODE_ENV==="test"){
    const actorId=req.headers.get("x-palaco-test-actor");
    const role=req.headers.get("x-palaco-test-role") as Role|null;
    if(actorId&&role&&roles.has(role))return {actorId,role,authentication:"TEST"};
  }

  const mode=process.env.PALACO_AUTH_MODE;
  if(mode==="session"){
    const token=readSessionCookie(req);
    if(!token)throw new Error("AUTHENTICATION_REQUIRED");
    const session=resolveSession(token,db);
    return {actorId:session.user.id,role:session.user.role,authentication:"SESSION"};
  }

  if(mode==="trusted-proxy"){
    const expectedToken=process.env.PALACO_TRUSTED_PROXY_TOKEN;
    if(!expectedToken)throw new Error("IDENTITY_PROXY_NOT_CONFIGURED");
    if(req.headers.get("x-palaco-proxy-token")!==expectedToken)throw new Error("AUTHENTICATION_REQUIRED");
    if(req.headers.get("x-palaco-authenticated")!=="true")throw new Error("AUTHENTICATION_REQUIRED");
    const actorId=req.headers.get("x-palaco-actor-id");
    const role=req.headers.get("x-palaco-role") as Role|null;
    if(!actorId||!role||!roles.has(role))throw new Error("INVALID_ACTOR_CONTEXT");
    return {actorId,role,authentication:"TRUSTED_PROXY"};
  }

  throw new Error("IDENTITY_NOT_CONFIGURED");
}
