import {createHash,createPublicKey,randomUUID} from "node:crypto";
import type Database from "better-sqlite3";
import {database} from "./sqlite";
import {requireAuthorization} from "./authorization";
import type {ActorContext} from "./actor";
import type {AuditEvent} from "./domain";

export type TrustRootStatus="REGISTERED"|"TRUSTED"|"RETIRED"|"REVOKED";

export type TrustRootKey={
  keyId:string;
  algorithm:"Ed25519";
  publicKeyPem:string;
  publicKeyFingerprint:string;
  registeredAt:string;
  actor:string;
};

export type TrustRootEvent={
  epoch:number;
  keyId:string;
  version:number;
  status:TrustRootStatus;
  effectiveAt:string;
  invalidFrom:string|null;
  reason:string|null;
  recordedAt:string;
  actor:string;
  supersedesVersion:number|null;
};

type ClockInput=Date|string;

function iso(value:ClockInput){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))throw new Error("TRUST_ROOT_TIME_INVALID");
  return date.toISOString();
}

function fingerprint(publicKeyPem:string){
  const key=createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=="ed25519")throw new Error("TRUST_ROOT_KEY_NOT_ED25519");
  const der=key.export({type:"spki",format:"der"});
  return createHash("sha256").update(der).digest("hex");
}

function appendAudit(db:Database.Database,event:AuditEvent){
  db.prepare("INSERT INTO audit_events(event_id,actor,action,object_id,object_version,timestamp,authorization_context,outcome,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(event.eventId,event.actor,event.action,event.object,event.objectVersion,event.timestamp,event.authorizationContext,event.outcome,JSON.stringify(event.provenanceRefs));
}

function audit(actor:ActorContext,action:string,key:TrustRootKey,event:TrustRootEvent):AuditEvent{
  return {
    eventId:randomUUID(),
    actor:actor.actorId,
    action,
    object:key.keyId,
    objectVersion:event.version,
    timestamp:event.recordedAt,
    authorizationContext:`${actor.authentication}:${actor.role}`,
    outcome:"ALLOWED",
    provenanceRefs:[key.publicKeyFingerprint,`epoch:${event.epoch}`,`status:${event.status}`]
  };
}

function mapKey(row:any):TrustRootKey{
  return {
    keyId:row.keyId,
    algorithm:row.algorithm,
    publicKeyPem:row.publicKeyPem,
    publicKeyFingerprint:row.publicKeyFingerprint,
    registeredAt:row.registeredAt,
    actor:row.actor
  };
}

function mapEvent(row:any):TrustRootEvent{
  return {
    epoch:Number(row.epoch),
    keyId:row.keyId,
    version:Number(row.version),
    status:row.status,
    effectiveAt:row.effectiveAt,
    invalidFrom:row.invalidFrom??null,
    reason:row.reason??null,
    recordedAt:row.recordedAt,
    actor:row.actor,
    supersedesVersion:row.supersedesVersion??null
  };
}

function keyById(keyId:string,db:Database.Database):TrustRootKey|undefined{
  const row=db.prepare(`
    SELECT key_id AS keyId,algorithm,public_key_pem AS publicKeyPem,
      public_key_fingerprint AS publicKeyFingerprint,registered_at AS registeredAt,actor
    FROM trust_root_keys WHERE key_id=?
  `).get(keyId);
  return row?mapKey(row):undefined;
}

function latestEvent(keyId:string,db:Database.Database):TrustRootEvent|undefined{
  const row=db.prepare(`
    SELECT epoch,key_id AS keyId,version,status,effective_at AS effectiveAt,
      invalid_from AS invalidFrom,reason,recorded_at AS recordedAt,actor,
      supersedes_version AS supersedesVersion
    FROM trust_root_key_events WHERE key_id=? ORDER BY version DESC LIMIT 1
  `).get(keyId);
  return row?mapEvent(row):undefined;
}

function insertEvent(
  db:Database.Database,
  input:{
    keyId:string;version:number;status:TrustRootStatus;effectiveAt:string;
    invalidFrom:string|null;reason:string|null;recordedAt:string;actor:string;
    supersedesVersion:number|null;
  }
):TrustRootEvent{
  const result=db.prepare(`
    INSERT INTO trust_root_key_events(
      key_id,version,status,effective_at,invalid_from,reason,recorded_at,actor,supersedes_version
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `).run(
    input.keyId,input.version,input.status,input.effectiveAt,input.invalidFrom,input.reason,
    input.recordedAt,input.actor,input.supersedesVersion
  );
  const row=db.prepare(`
    SELECT epoch,key_id AS keyId,version,status,effective_at AS effectiveAt,
      invalid_from AS invalidFrom,reason,recorded_at AS recordedAt,actor,
      supersedes_version AS supersedesVersion
    FROM trust_root_key_events WHERE epoch=?
  `).get(Number(result.lastInsertRowid));
  if(!row)throw new Error("TRUST_ROOT_EVENT_INSERT_FAILED");
  return mapEvent(row);
}

function assertTransition(current:TrustRootEvent,next:TrustRootStatus){
  const allowed:Record<TrustRootStatus,readonly TrustRootStatus[]>={
    REGISTERED:["TRUSTED","REVOKED"],
    TRUSTED:["RETIRED","REVOKED"],
    RETIRED:["REVOKED"],
    REVOKED:[]
  };
  if(!allowed[current.status].includes(next))throw new Error("TRUST_ROOT_TRANSITION_DENIED");
}

function appendTransition(
  keyId:string,
  next:Exclude<TrustRootStatus,"REGISTERED">,
  actor:ActorContext,
  input:{effectiveAt:ClockInput;reason:string;invalidFrom?:ClockInput},
  db:Database.Database,
  recordedAt:ClockInput
){
  const key=keyById(keyId,db);
  if(!key)throw new Error("TRUST_ROOT_KEY_NOT_FOUND");
  const current=latestEvent(keyId,db);
  if(!current)throw new Error("TRUST_ROOT_STATE_MISSING");
  assertTransition(current,next);

  const recorded=iso(recordedAt);
  const effective=iso(input.effectiveAt);
  if(Date.parse(effective)<Date.parse(recorded))throw new Error("TRUST_ROOT_EFFECTIVE_BACKDATE_DENIED");
  if(Date.parse(effective)<Date.parse(current.effectiveAt))throw new Error("TRUST_ROOT_TIME_REGRESSION");

  let invalidFrom:string|null=null;
  if(next==="REVOKED"){
    if(input.invalidFrom===undefined)throw new Error("TRUST_ROOT_INVALID_FROM_REQUIRED");
    invalidFrom=iso(input.invalidFrom);
    if(Date.parse(invalidFrom)>Date.parse(effective))throw new Error("TRUST_ROOT_INVALID_FROM_AFTER_REVOCATION");
  }

  const event=insertEvent(db,{
    keyId,
    version:current.version+1,
    status:next,
    effectiveAt:effective,
    invalidFrom,
    reason:input.reason.trim()||null,
    recordedAt:recorded,
    actor:actor.actorId,
    supersedesVersion:current.version
  });
  appendAudit(db,audit(
    actor,
    next==="TRUSTED"?"TRUST_ROOT_KEY_TRUST":
      next==="RETIRED"?"TRUST_ROOT_KEY_RETIRE":"TRUST_ROOT_KEY_REVOKE",
    key,event
  ));
  return {key,event};
}

export function registerTrustRootKey(
  input:{keyId:string;publicKeyPem:string},
  actor:ActorContext,
  db:Database.Database=database(),
  recordedAt:ClockInput=new Date()
){
  requireAuthorization(actor.role,"TRUST_ROOT_WRITE");
  const keyId=input.keyId.trim();
  if(!keyId)throw new Error("TRUST_ROOT_KEY_ID_REQUIRED");
  const publicKeyFingerprint=fingerprint(input.publicKeyPem);
  const at=iso(recordedAt);
  return db.transaction(()=>{
    db.prepare(`
      INSERT INTO trust_root_keys(key_id,algorithm,public_key_pem,public_key_fingerprint,registered_at,actor)
      VALUES(?,?,?,?,?,?)
    `).run(keyId,"Ed25519",input.publicKeyPem,publicKeyFingerprint,at,actor.actorId);
    const key=keyById(keyId,db);
    if(!key)throw new Error("TRUST_ROOT_KEY_INSERT_FAILED");
    const event=insertEvent(db,{
      keyId,version:1,status:"REGISTERED",effectiveAt:at,invalidFrom:null,reason:"registered",
      recordedAt:at,actor:actor.actorId,supersedesVersion:null
    });
    appendAudit(db,audit(actor,"TRUST_ROOT_KEY_REGISTER",key,event));
    return {key,event};
  })();
}

export function trustTrustRootKey(
  keyId:string,
  input:{effectiveAt?:ClockInput;reason:string},
  actor:ActorContext,
  db:Database.Database=database(),
  recordedAt:ClockInput=new Date()
){
  requireAuthorization(actor.role,"TRUST_ROOT_WRITE");
  const recorded=iso(recordedAt);
  return db.transaction(()=>appendTransition(
    keyId,"TRUSTED",actor,{effectiveAt:input.effectiveAt??recorded,reason:input.reason},db,recorded
  ))();
}

export function retireTrustRootKey(
  keyId:string,
  input:{effectiveAt?:ClockInput;reason:string},
  actor:ActorContext,
  db:Database.Database=database(),
  recordedAt:ClockInput=new Date()
){
  requireAuthorization(actor.role,"TRUST_ROOT_WRITE");
  const recorded=iso(recordedAt);
  return db.transaction(()=>appendTransition(
    keyId,"RETIRED",actor,{effectiveAt:input.effectiveAt??recorded,reason:input.reason},db,recorded
  ))();
}

export function revokeTrustRootKey(
  keyId:string,
  input:{effectiveAt?:ClockInput;invalidFrom:ClockInput;reason:string},
  actor:ActorContext,
  db:Database.Database=database(),
  recordedAt:ClockInput=new Date()
){
  requireAuthorization(actor.role,"TRUST_ROOT_WRITE");
  const recorded=iso(recordedAt);
  return db.transaction(()=>appendTransition(
    keyId,"REVOKED",actor,{
      effectiveAt:input.effectiveAt??recorded,
      invalidFrom:input.invalidFrom,
      reason:input.reason
    },db,recorded
  ))();
}

export function rotateTrustRootKey(
  input:{
    fromKeyId:string;
    toKeyId:string;
    toPublicKeyPem:string;
    effectiveAt?:ClockInput;
    reason:string;
  },
  actor:ActorContext,
  db:Database.Database=database(),
  recordedAt:ClockInput=new Date()
){
  requireAuthorization(actor.role,"TRUST_ROOT_WRITE");
  const recorded=iso(recordedAt);
  const effective=iso(input.effectiveAt??recorded);
  return db.transaction(()=>{
    const current=latestEvent(input.fromKeyId,db);
    if(!current||current.status!=="TRUSTED")throw new Error("TRUST_ROOT_ROTATION_SOURCE_NOT_TRUSTED");
    const registered=registerTrustRootKey(
      {keyId:input.toKeyId,publicKeyPem:input.toPublicKeyPem},actor,db,new Date(recorded)
    );
    const trusted=appendTransition(
      registered.key.keyId,"TRUSTED",actor,{effectiveAt:effective,reason:`rotation: ${input.reason}`},db,recorded
    );
    const retired=appendTransition(
      input.fromKeyId,"RETIRED",actor,{effectiveAt:effective,reason:`rotation: ${input.reason}`},db,recorded
    );
    return {from:{key:keyById(input.fromKeyId,db)!,event:retired.event},to:trusted};
  })();
}

export function currentTrustEpoch(db:Database.Database=database()):number{
  const row=db.prepare("SELECT COALESCE(MAX(epoch),0) AS epoch FROM trust_root_key_events").get() as {epoch:number};
  return Number(row.epoch);
}

export function getTrustRootKey(keyId:string,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"TRUST_ROOT_READ");
  const key=keyById(keyId,db);
  if(!key)throw new Error("TRUST_ROOT_KEY_NOT_FOUND");
  return {key,history:getTrustRootHistoryInternal(keyId,db)};
}

function getTrustRootHistoryInternal(keyId:string,db:Database.Database){
  return (db.prepare(`
    SELECT epoch,key_id AS keyId,version,status,effective_at AS effectiveAt,
      invalid_from AS invalidFrom,reason,recorded_at AS recordedAt,actor,
      supersedes_version AS supersedesVersion
    FROM trust_root_key_events WHERE key_id=? ORDER BY version
  `).all(keyId) as any[]).map(mapEvent);
}

export function listTrustRootHistory(keyId:string,actor:ActorContext,db:Database.Database=database()){
  requireAuthorization(actor.role,"TRUST_ROOT_READ");
  if(!keyById(keyId,db))throw new Error("TRUST_ROOT_KEY_NOT_FOUND");
  return getTrustRootHistoryInternal(keyId,db);
}

export function trustStateAt(
  keyId:string,
  at:ClockInput,
  maxEpoch:number,
  db:Database.Database=database()
){
  const key=keyById(keyId,db);
  if(!key)return null;
  const timestamp=iso(at);
  const row=db.prepare(`
    SELECT epoch,key_id AS keyId,version,status,effective_at AS effectiveAt,
      invalid_from AS invalidFrom,reason,recorded_at AS recordedAt,actor,
      supersedes_version AS supersedesVersion
    FROM trust_root_key_events
    WHERE key_id=? AND epoch<=? AND effective_at<=?
    ORDER BY effective_at DESC,epoch DESC LIMIT 1
  `).get(keyId,maxEpoch,timestamp);
  return row?{key,event:mapEvent(row)}:null;
}

export function compromiseRevocationAffecting(
  keyId:string,
  signedAt:ClockInput,
  afterEpoch:number,
  db:Database.Database=database()
):TrustRootEvent|null{
  const timestamp=iso(signedAt);
  const row=db.prepare(`
    SELECT epoch,key_id AS keyId,version,status,effective_at AS effectiveAt,
      invalid_from AS invalidFrom,reason,recorded_at AS recordedAt,actor,
      supersedes_version AS supersedesVersion
    FROM trust_root_key_events
    WHERE key_id=? AND epoch>? AND status='REVOKED' AND invalid_from<=?
    ORDER BY epoch ASC LIMIT 1
  `).get(keyId,afterEpoch,timestamp);
  return row?mapEvent(row):null;
}

export function signingTrustState(
  keyId:string,
  signedAt:ClockInput,
  db:Database.Database=database()
){
  const epoch=currentTrustEpoch(db);
  const state=trustStateAt(keyId,signedAt,epoch,db);
  if(!state||state.event.status!=="TRUSTED")throw new Error("TRUST_ROOT_KEY_NOT_TRUSTED_AT_SIGNING");
  const compromise=compromiseRevocationAffecting(keyId,signedAt,0,db);
  if(compromise&&compromise.epoch<=epoch)throw new Error("TRUST_ROOT_KEY_COMPROMISED_AT_SIGNING");
  return {...state,trustEpoch:epoch};
}
