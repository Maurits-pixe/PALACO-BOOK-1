import {createHash} from "node:crypto";
import type Database from "better-sqlite3";
import {z} from "zod";
import {database} from "./sqlite";
import {requireAuthorization} from "./authorization";
import type {ActorContext} from "./actor";
import {getClosureReceipt} from "./closure-receipt";

export const portableBundleFormat="veldgids.portable-closure-bundle.v1" as const;

const forbiddenKeys=new Set([
  "authorizationContext","authentication","role","roles","permission","permissions",
  "token","accessToken","refreshToken","cookie","cookies","password","secret","secrets",
  "headers","session","sessionId"
]);

function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  const object=value as Record<string,unknown>;
  return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}
function sha256(value:unknown){return createHash("sha256").update(typeof value==="string"?value:canonicalJson(value)).digest("hex");}

function assertNoForbiddenMaterial(value:unknown,path="$"){
  if(value===null||typeof value!=="object")return;
  if(Array.isArray(value)){
    value.forEach((item,index)=>assertNoForbiddenMaterial(item,`${path}[${index}]`));
    return;
  }
  for(const [key,item] of Object.entries(value as Record<string,unknown>)){
    if(forbiddenKeys.has(key))throw new Error(`PORTABLE_BUNDLE_FORBIDDEN_FIELD:${path}.${key}`);
    assertNoForbiddenMaterial(item,`${path}.${key}`);
  }
}

function sanitizeReceiptSnapshot(snapshot:Record<string,unknown>){
  const source=structuredClone(snapshot) as any;
  const audits=(Array.isArray(source.audits)?source.audits:[]).map((audit:any)=>({
    eventId:audit.eventId,
    actor:audit.actor,
    action:audit.action,
    objectId:audit.objectId,
    objectVersion:audit.objectVersion,
    timestamp:audit.timestamp,
    outcome:audit.outcome,
    provenanceRefs:Array.isArray(audit.provenanceRefs)?[...audit.provenanceRefs]:[]
  }));
  return {
    schemaVersion:source.schemaVersion,
    signal:source.signal,
    work:source.work,
    proposal:source.proposal,
    envelope:source.envelope,
    verification:source.verification,
    audits
  };
}

const auditSchema=z.object({
  eventId:z.string().min(1),
  actor:z.string().min(1),
  action:z.string().min(1),
  objectId:z.string().min(1),
  objectVersion:z.number().int().positive(),
  timestamp:z.string().min(1),
  outcome:z.literal("ALLOWED"),
  provenanceRefs:z.array(z.string())
}).strict();

const snapshotSchema=z.object({
  schemaVersion:z.literal("veldgids.closure-receipt.v1"),
  signal:z.object({
    signalId:z.string().min(1),version:z.number().int().positive(),status:z.literal("RESOLVED"),
    targetType:z.enum(["KNOWLEDGE_VERSION","RELATION"]),targetId:z.string().min(1),targetVersion:z.number().int().positive(),
    supersedesVersion:z.number().int().positive()
  }).passthrough(),
  work:z.object({
    workId:z.string().min(1),version:z.literal(4),status:z.literal("DECIDED"),
    signalId:z.string().min(1),targetType:z.enum(["KNOWLEDGE_VERSION","RELATION"]),
    targetId:z.string().min(1),targetVersion:z.number().int().positive()
  }).passthrough(),
  proposal:z.object({
    proposalId:z.string().min(1),version:z.literal(2),status:z.literal("ACCEPTED"),
    workId:z.string().min(1),proposalType:z.enum(["KNOWLEDGE_EVOLUTION","RELATION_EVOLUTION","RELATION_REVOKE"]),
    targetType:z.enum(["KNOWLEDGE_VERSION","RELATION"]),targetId:z.string().min(1),
    baseVersion:z.number().int().positive(),payloadHash:z.string().regex(/^[a-f0-9]{64}$/)
  }).passthrough(),
  envelope:z.object({
    envelopeId:z.string().min(1),version:z.literal(3),status:z.literal("CONSUMED"),
    proposalId:z.string().min(1),proposalVersion:z.literal(2),
    operationType:z.enum(["KNOWLEDGE_EVOLUTION","RELATION_EVOLUTION","RELATION_REVOKE"]),
    targetType:z.enum(["KNOWLEDGE_VERSION","RELATION"]),targetId:z.string().min(1),
    baseVersion:z.number().int().positive(),payloadHash:z.string().regex(/^[a-f0-9]{64}$/)
  }).passthrough(),
  verification:z.object({
    verificationId:z.string().min(1),version:z.literal(2),status:z.literal("CLOSED"),verdict:z.literal("MATCH"),
    envelopeId:z.string().min(1),envelopeVersion:z.literal(3),signalId:z.string().min(1),
    targetType:z.enum(["KNOWLEDGE_VERSION","RELATION"]),targetId:z.string().min(1),
    expectedVersion:z.number().int().positive(),observedVersion:z.number().int().positive(),
    expectedHash:z.string().regex(/^[a-f0-9]{64}$/),observedHash:z.string().regex(/^[a-f0-9]{64}$/),
    supersedesVersion:z.literal(1)
  }).passthrough(),
  audits:z.array(auditSchema).length(12)
}).strict();

const bundleSchema=z.object({
  format:z.literal(portableBundleFormat),
  bundleId:z.string().min(1),
  receipt:z.object({
    receiptId:z.string().min(1),
    originChainHash:z.string().regex(/^[a-f0-9]{64}$/),
    verificationId:z.string().min(1),
    verificationVersion:z.number().int().positive(),
    targetType:z.enum(["KNOWLEDGE_VERSION","RELATION"]),
    targetId:z.string().min(1),
    targetVersion:z.number().int().positive(),
    sealedAt:z.string().min(1),
    sealerActor:z.string().min(1)
  }).strict(),
  capabilities:z.object({
    authority:z.literal("NONE"),
    executable:z.literal(false),
    mutable:z.literal(false),
    containsCredentials:z.literal(false)
  }).strict(),
  snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),
  bundleHash:z.string().regex(/^[a-f0-9]{64}$/),
  snapshot:snapshotSchema
}).strict();

export type PortableClosureBundle=z.infer<typeof bundleSchema>;

function expectedMutationAction(operationType:string){
  if(operationType==="KNOWLEDGE_EVOLUTION")return "KNOWLEDGE_EVOLVE";
  return operationType==="RELATION_REVOKE"?"KNOWLEDGE_RELATION_REVOKE":"KNOWLEDGE_RELATION_EVOLVE";
}

function causalErrors(snapshot:z.infer<typeof snapshotSchema>):string[]{
  const errors:string[]=[];
  const {signal,work,proposal,envelope,verification,audits}=snapshot;

  if(work.signalId!==signal.signalId)errors.push("WORK_SIGNAL_LINK");
  if(work.targetType!==signal.targetType||work.targetId!==signal.targetId||work.targetVersion!==signal.targetVersion)errors.push("WORK_TARGET_LINK");
  if(proposal.workId!==work.workId)errors.push("PROPOSAL_WORK_LINK");
  if(proposal.targetType!==signal.targetType||proposal.targetId!==signal.targetId||proposal.baseVersion!==signal.targetVersion)errors.push("PROPOSAL_TARGET_LINK");
  if(envelope.proposalId!==proposal.proposalId||envelope.proposalVersion!==proposal.version)errors.push("ENVELOPE_PROPOSAL_LINK");
  if(envelope.targetType!==proposal.targetType||envelope.targetId!==proposal.targetId||envelope.baseVersion!==proposal.baseVersion)errors.push("ENVELOPE_TARGET_LINK");
  if(envelope.payloadHash!==proposal.payloadHash)errors.push("PAYLOAD_HASH_LINK");
  if(verification.envelopeId!==envelope.envelopeId||verification.envelopeVersion!==envelope.version)errors.push("VERIFICATION_ENVELOPE_LINK");
  if(verification.signalId!==signal.signalId)errors.push("VERIFICATION_SIGNAL_LINK");
  if(verification.targetType!==signal.targetType||verification.targetId!==signal.targetId)errors.push("VERIFICATION_TARGET_LINK");
  if(verification.expectedVersion!==proposal.baseVersion+1||verification.observedVersion!==verification.expectedVersion)errors.push("VERIFICATION_VERSION_LINK");
  if(verification.expectedHash!==verification.observedHash)errors.push("VERIFICATION_HASH_LINK");

  const expected=[
    ["REMEDIATION_WORK_CREATE",work.workId,1],
    ["REMEDIATION_WORK_CLAIM",work.workId,2],
    ["REMEDIATION_PROPOSE",proposal.proposalId,1],
    ["REMEDIATION_DECIDE_ACCEPT",proposal.proposalId,2],
    ["REMEDIATION_EXECUTION_PREPARE",envelope.envelopeId,1],
    ["REMEDIATION_EXECUTION_AUTHORIZE",envelope.envelopeId,2],
    [expectedMutationAction(envelope.operationType),envelope.targetId,verification.expectedVersion],
    ["REMEDIATION_EXECUTION_CONSUME",envelope.envelopeId,3],
    ["REMEDIATION_VERIFY_MATCH",verification.verificationId,1],
    ["IMPACT_SIGNAL_ACKNOWLEDGE",signal.signalId,signal.supersedesVersion],
    ["REMEDIATION_VERIFICATION_CLOSE",verification.verificationId,2],
    ["IMPACT_SIGNAL_RESOLVE",signal.signalId,signal.version]
  ] as const;
  expected.forEach(([action,objectId,objectVersion],index)=>{
    const audit=audits[index];
    if(!audit||audit.action!==action||audit.objectId!==objectId||audit.objectVersion!==objectVersion||audit.outcome!=="ALLOWED"){
      errors.push(`AUDIT_${index+1}_MISMATCH`);
    }
  });
  return errors;
}

function hashableBundle(bundle:Omit<PortableClosureBundle,"bundleHash">){
  return bundle;
}

export function exportPortableClosureBundle(receiptId:string,actor:ActorContext,db:Database.Database=database()):PortableClosureBundle{
  requireAuthorization(actor.role,"CLOSURE_BUNDLE_EXPORT");
  const receipt=getClosureReceipt(receiptId,actor,db);
  const snapshot=snapshotSchema.parse(sanitizeReceiptSnapshot(receipt.snapshot));
  assertNoForbiddenMaterial(snapshot);
  const snapshotHash=sha256(snapshot);
  const base={
    format:portableBundleFormat,
    bundleId:`bundle-${sha256(`${receipt.receiptId}:${receipt.chainHash}`).slice(0,32)}`,
    receipt:{
      receiptId:receipt.receiptId,
      originChainHash:receipt.chainHash,
      verificationId:receipt.verificationId,
      verificationVersion:receipt.verificationVersion,
      targetType:receipt.targetType,
      targetId:receipt.targetId,
      targetVersion:receipt.targetVersion,
      sealedAt:receipt.createdAt,
      sealerActor:receipt.actor
    },
    capabilities:{authority:"NONE" as const,executable:false as const,mutable:false as const,containsCredentials:false as const},
    snapshotHash,
    snapshot
  };
  assertNoForbiddenMaterial(base);
  const bundleHash=sha256(hashableBundle(base));
  return bundleSchema.parse({...base,bundleHash});
}

export function validatePortableClosureBundle(input:unknown){
  const errors:string[]=[];
  let bundle:PortableClosureBundle|null=null;
  try{
    bundle=bundleSchema.parse(input);
  }catch(error){
    return {
      verdict:"INVALID" as const,
      errors:["BUNDLE_SCHEMA_INVALID"],
      checks:{schema:false,noForbiddenMaterial:false,snapshotHash:false,bundleHash:false,causalChain:false,originAnchorPresent:false},
      mutationPerformed:false as const,
      substantiveTruthVerified:false as const,
      originReceiptAuthenticityVerified:false as const
    };
  }

  let noForbiddenMaterial=true;
  try{assertNoForbiddenMaterial(bundle);}catch{noForbiddenMaterial=false;errors.push("FORBIDDEN_AUTHORITY_OR_CREDENTIAL_MATERIAL");}
  const snapshotHash=sha256(bundle.snapshot)===bundle.snapshotHash;
  if(!snapshotHash)errors.push("SNAPSHOT_HASH_MISMATCH");
  const {bundleHash,...withoutHash}=bundle;
  const bundleHashMatches=sha256(hashableBundle(withoutHash))===bundleHash;
  if(!bundleHashMatches)errors.push("BUNDLE_HASH_MISMATCH");
  const causal=causalErrors(bundle.snapshot);
  errors.push(...causal);
  const originAnchorPresent=/^[a-f0-9]{64}$/.test(bundle.receipt.originChainHash);
  if(!originAnchorPresent)errors.push("ORIGIN_CHAIN_HASH_MISSING");

  const valid=noForbiddenMaterial&&snapshotHash&&bundleHashMatches&&causal.length===0&&originAnchorPresent;
  return {
    verdict:valid?"VALID" as const:"INVALID" as const,
    bundleId:bundle.bundleId,
    receiptId:bundle.receipt.receiptId,
    errors,
    checks:{
      schema:true,
      noForbiddenMaterial,
      snapshotHash,
      bundleHash:bundleHashMatches,
      causalChain:causal.length===0,
      originAnchorPresent
    },
    mutationPerformed:false as const,
    substantiveTruthVerified:false as const,
    originReceiptAuthenticityVerified:false as const
  };
}
