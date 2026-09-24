import { randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { database } from "./sqlite";
import type { Role } from "./authorization";

export const SESSION_COOKIE="palaco_session";
const SESSION_TTL_SECONDS=60*60*8;

function normalizeUsername(value:string){return value.trim().toLowerCase();}
function hashToken(token:string){return createHash("sha256").update(token).digest("hex");}
function hashPassword(password:string,salt:string){return scryptSync(password,salt,64).toString("hex");}

export type IdentityUser={id:string;username:string;role:Role;status:"ACTIVE"|"DISABLED";createdAt:string};
export type SessionIdentity={sessionId:string;user:IdentityUser;expiresAt:string};

export function createUser(input:{username:string;password:string;role:Role},db:Database.Database=database()):IdentityUser{
  if(input.password.length<12)throw new Error("PASSWORD_TOO_SHORT");
  const username=normalizeUsername(input.username);
  if(!username)throw new Error("USERNAME_REQUIRED");
  const id=randomUUID(),salt=randomBytes(16).toString("hex"),createdAt=new Date().toISOString();
  db.prepare("INSERT INTO users(id,username,password_salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,'ACTIVE',?)")
    .run(id,username,salt,hashPassword(input.password,salt),input.role,createdAt);
  return {id,username,role:input.role,status:"ACTIVE",createdAt};
}

export function authenticate(usernameInput:string,password:string,db:Database.Database=database()):IdentityUser{
  const row=db.prepare("SELECT id,username,password_salt AS salt,password_hash AS hash,role,status,created_at AS createdAt FROM users WHERE username=?")
    .get(normalizeUsername(usernameInput)) as {id:string;username:string;salt:string;hash:string;role:Role;status:"ACTIVE"|"DISABLED";createdAt:string}|undefined;
  if(!row||row.status!=="ACTIVE")throw new Error("INVALID_CREDENTIALS");
  const actual=Buffer.from(hashPassword(password,row.salt),"hex"),expected=Buffer.from(row.hash,"hex");
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error("INVALID_CREDENTIALS");
  return {id:row.id,username:row.username,role:row.role,status:row.status,createdAt:row.createdAt};
}

export function createSession(userId:string,db:Database.Database=database()){
  const token=randomBytes(32).toString("base64url"),id=randomUUID(),createdAt=new Date(),expiresAt=new Date(createdAt.getTime()+SESSION_TTL_SECONDS*1000);
  db.prepare("INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,NULL)")
    .run(id,userId,hashToken(token),createdAt.toISOString(),expiresAt.toISOString());
  return {token,sessionId:id,expiresAt:expiresAt.toISOString(),maxAge:SESSION_TTL_SECONDS};
}

export function resolveSession(token:string,db:Database.Database=database()):SessionIdentity{
  const now=new Date().toISOString();
  const row=db.prepare(`SELECT s.id AS sessionId,s.expires_at AS expiresAt,u.id,u.username,u.role,u.status,u.created_at AS createdAt
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='ACTIVE'`)
    .get(hashToken(token),now) as ({sessionId:string;expiresAt:string}&IdentityUser)|undefined;
  if(!row)throw new Error("AUTHENTICATION_REQUIRED");
  return {sessionId:row.sessionId,expiresAt:row.expiresAt,user:{id:row.id,username:row.username,role:row.role,status:row.status,createdAt:row.createdAt}};
}

export function revokeSession(token:string,db:Database.Database=database()){
  db.prepare("UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").run(new Date().toISOString(),hashToken(token));
}

export function readSessionCookie(req:Request){
  const cookie=req.headers.get("cookie")??"";
  for(const part of cookie.split(";")){const [name,...rest]=part.trim().split("=");if(name===SESSION_COOKIE)return decodeURIComponent(rest.join("="));}
  return null;
}

export function bootstrapOwnerFromEnv(db:Database.Database=database()){
  const username=process.env.PALACO_BOOTSTRAP_USERNAME,password=process.env.PALACO_BOOTSTRAP_PASSWORD;
  if(!username&&!password)return null;
  if(!username||!password)throw new Error("BOOTSTRAP_CREDENTIALS_INCOMPLETE");
  const exists=db.prepare("SELECT id FROM users WHERE username=?").get(normalizeUsername(username));
  return exists?null:createUser({username,password,role:"OWNER"},db);
}
