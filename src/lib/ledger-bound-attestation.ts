import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify
} from "node:crypto";
import type Database from "better-sqlite3";
import {z} from "zod";
import {database} from "./sqlite";
import {requireAuthorization} from "./authorization";
import type {ActorContext} from "./actor";
import {
  exportPortableClosureBundle,
  validatePortableClosureBundle,
  type PortableClosureBundle
} from "./portable-closure-bundle";
import {
  compromiseRevocationAffecting,
  currentTrustEpoch,
  signingTrustState,
  trustStateAt
} from "./trust-root-ledger";
import type {PortableAttestationSigningConfig} from "./portable-bundle-attestation";

export const ledgerBoundAttestationFormat="veldgids.portable-closure-attestation.v2" as const;

const schema=z.object({
  format:z.literal(ledgerBoundAttestationFormat),
  algorithm:z.literal("Ed25519"),
  keyId:z.string().min(1),
  publicKeyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  signedAt:z.string().datetime(),
  trustEpoch:z.number().int().positive(),
  trustKeyVersion:z.number().int().positive(),
  trustKeyEventEpoch:z.number().int().positive(),
  bundleId:z.string().min(1),
  bundleHash:z.string().regex(/^[a-f0-9]{64}$/),
  snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),
  receiptId:z.string().min(1),
  originChainHash:z.string().regex(/^[a-f0-9]{64}$/),
  signature:z.string().min(1)
}).strict();

export type LedgerBoundPortableClosureAttestation=z.infer<typeof schema>;

function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  const object=value as Record<string,unknown>;
  return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function fingerprint(publicKeyPem:string){
  const key=createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=="ed25519")throw new Error("ATTESTATION_KEY_NOT_ED25519");
  return createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex");
}

function payload(attestation:LedgerBoundPortableClosureAttestation){
  const {signature,...rest}=attestation;
  return rest;
}

function signPayload(
  bundle:PortableClosureBundle,
  input:{
    keyId:string;publicKeyFingerprint:string;signedAt:string;
    trustEpoch:number;trustKeyVersion:number;trustKeyEventEpoch:number;
  }
){
  return {
    format:ledgerBoundAttestationFormat,
    algorithm:"Ed25519" as const,
    ...input,
    bundleId:bundle.bundleId,
    bundleHash:bundle.bundleHash,
    snapshotHash:bundle.snapshotHash,
    receiptId:bundle.receipt.receiptId,
    originChainHash:bundle.receipt.originChainHash
  };
}

export function createLedgerBoundPortableBundleAttestation(
  receiptId:string,
  actor:ActorContext,
  config:PortableAttestationSigningConfig,
  db:Database.Database=database(),
  signedAt:Date=new Date()
){
  requireAuthorization(actor.role,"CLOSURE_BUNDLE_SIGN");
  const bundle=exportPortableClosureBundle(receiptId,actor,db);
  if(validatePortableClosureBundle(bundle).verdict!=="VALID")throw new Error("PORTABLE_BUNDLE_INVALID_FOR_SIGNING");

  const privateKey=createPrivateKey(config.privateKeyPem);
  if(privateKey.asymmetricKeyType!=="ed25519")throw new Error("ATTESTATION_KEY_NOT_ED25519");
  const publicKeyPem=createPublicKey(privateKey).export({type:"spki",format:"pem"}).toString();
  const derivedFingerprint=fingerprint(publicKeyPem);
  const state=signingTrustState(config.keyId,signedAt,db);
  if(state.key.publicKeyFingerprint!==derivedFingerprint)throw new Error("SIGNING_KEY_DOES_NOT_MATCH_TRUST_ROOT");

  const signedAtIso=signedAt.toISOString();
  const unsigned=signPayload(bundle,{
    keyId:state.key.keyId,
    publicKeyFingerprint:state.key.publicKeyFingerprint,
    signedAt:signedAtIso,
    trustEpoch:state.trustEpoch,
    trustKeyVersion:state.event.version,
    trustKeyEventEpoch:state.event.epoch
  });
  const signature=cryptoSign(null,Buffer.from(canonicalJson(unsigned)),privateKey).toString("base64");
  const attestation=schema.parse({...unsigned,signature});
  return {
    bundle,
    attestation,
    mutationPerformed:false as const,
    authorityEmbeddedInBundle:false as const
  };
}

export function verifyLedgerBoundPortableBundleAttestation(
  bundleInput:unknown,
  attestationInput:unknown,
  actor:ActorContext,
  db:Database.Database=database()
){
  requireAuthorization(actor.role,"TRUST_ROOT_READ");
  const errors:string[]=[];
  const bundleValidation=validatePortableClosureBundle(bundleInput);
  if(bundleValidation.verdict!=="VALID")errors.push("PORTABLE_BUNDLE_INVALID");
  const parsed=schema.safeParse(attestationInput);
  if(!parsed.success){
    return {
      verdict:"INVALID" as const,
      errors:[...errors,"ATTESTATION_SCHEMA_INVALID"],
      checks:{
        bundleValid:bundleValidation.verdict==="VALID",
        fieldsMatch:false,epochExists:false,historicalTrust:false,
        keyVersion:false,keyFingerprint:false,signature:false,compromiseClear:false
      },
      historicalTrustVerified:false as const,
      currentCompromiseClear:false as const,
      originAttestationVerified:false as const,
      mutationPerformed:false as const,
      authorityGranted:false as const,
      substantiveTruthVerified:false as const
    };
  }

  const attestation=parsed.data;
  const bundle=bundleValidation.verdict==="VALID"?bundleInput as PortableClosureBundle:null;
  const fieldsMatch=Boolean(bundle)&&
    attestation.bundleId===bundle!.bundleId&&
    attestation.bundleHash===bundle!.bundleHash&&
    attestation.snapshotHash===bundle!.snapshotHash&&
    attestation.receiptId===bundle!.receipt.receiptId&&
    attestation.originChainHash===bundle!.receipt.originChainHash;
  if(!fieldsMatch)errors.push("ATTESTATION_BUNDLE_LINK_MISMATCH");

  const epochExists=attestation.trustEpoch<=currentTrustEpoch(db);
  if(!epochExists)errors.push("ATTESTATION_TRUST_EPOCH_UNKNOWN");

  const state=epochExists?trustStateAt(attestation.keyId,attestation.signedAt,attestation.trustEpoch,db):null;
  const historicalTrust=Boolean(state)&&state!.event.status==="TRUSTED";
  if(!historicalTrust)errors.push("ATTESTATION_KEY_NOT_HISTORICALLY_TRUSTED");

  const keyVersion=historicalTrust&&
    state!.event.version===attestation.trustKeyVersion&&
    state!.event.epoch===attestation.trustKeyEventEpoch;
  if(!keyVersion)errors.push("ATTESTATION_TRUST_EVENT_MISMATCH");

  const keyFingerprint=historicalTrust&&state!.key.publicKeyFingerprint===attestation.publicKeyFingerprint;
  if(!keyFingerprint)errors.push("ATTESTATION_KEY_FINGERPRINT_MISMATCH");

  let signature=false;
  if(historicalTrust){
    try{
      const publicKey=createPublicKey(state!.key.publicKeyPem);
      signature=cryptoVerify(
        null,
        Buffer.from(canonicalJson(payload(attestation))),
        publicKey,
        Buffer.from(attestation.signature,"base64")
      );
    }catch{
      signature=false;
    }
  }
  if(!signature)errors.push("ATTESTATION_SIGNATURE_INVALID");

  const compromise=epochExists
    ?compromiseRevocationAffecting(attestation.keyId,attestation.signedAt,0,db)
    :null;
  const compromiseClear=!compromise;
  if(!compromiseClear)errors.push("ATTESTATION_COMPROMISE_REVOCATION");

  const valid=bundleValidation.verdict==="VALID"&&fieldsMatch&&epochExists&&
    historicalTrust&&keyVersion&&keyFingerprint&&signature&&compromiseClear;

  return {
    verdict:valid?"VALID" as const:"INVALID" as const,
    errors,
    keyId:attestation.keyId,
    trustEpoch:attestation.trustEpoch,
    trustKeyVersion:attestation.trustKeyVersion,
    trustKeyEventEpoch:attestation.trustKeyEventEpoch,
    checks:{
      bundleValid:bundleValidation.verdict==="VALID",
      fieldsMatch,epochExists,historicalTrust,keyVersion,keyFingerprint,signature,compromiseClear
    },
    historicalTrustVerified:historicalTrust&&keyVersion,
    currentCompromiseClear:compromiseClear,
    originAttestationVerified:valid,
    mutationPerformed:false as const,
    authorityGranted:false as const,
    substantiveTruthVerified:false as const
  };
}
