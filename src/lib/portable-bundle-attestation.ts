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

export const portableAttestationFormat="veldgids.portable-closure-attestation.v1" as const;

export type PortableAttestationSigningConfig={
  keyId:string;
  privateKeyPem:string;
};

export type PortableAttestationTrustEntry={
  publicKeyPem:string;
  status:"TRUSTED"|"UNTRUSTED"|"REVOKED";
  notBefore?:string;
  notAfter?:string;
};

export type PortableAttestationTrustStore=Record<string,PortableAttestationTrustEntry>;

const attestationSchema=z.object({
  format:z.literal(portableAttestationFormat),
  algorithm:z.literal("Ed25519"),
  keyId:z.string().min(1),
  publicKeyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  signedAt:z.string().datetime(),
  bundleId:z.string().min(1),
  bundleHash:z.string().regex(/^[a-f0-9]{64}$/),
  snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),
  receiptId:z.string().min(1),
  originChainHash:z.string().regex(/^[a-f0-9]{64}$/),
  signature:z.string().min(1)
}).strict();

export type PortableClosureAttestation=z.infer<typeof attestationSchema>;

function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  const object=value as Record<string,unknown>;
  return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function sha256(input:Buffer|string){
  return createHash("sha256").update(input).digest("hex");
}

function publicKeyFingerprint(publicKeyPemOrKey:Parameters<typeof createPublicKey>[0]){
  const key=createPublicKey(publicKeyPemOrKey);
  if(key.asymmetricKeyType!=="ed25519")throw new Error("ATTESTATION_KEY_NOT_ED25519");
  const der=key.export({type:"spki",format:"der"});
  return sha256(der);
}

function signedPayload(
  bundle:PortableClosureBundle,
  keyId:string,
  fingerprint:string,
  signedAt:string
){
  return {
    format:portableAttestationFormat,
    algorithm:"Ed25519" as const,
    keyId,
    publicKeyFingerprint:fingerprint,
    signedAt,
    bundleId:bundle.bundleId,
    bundleHash:bundle.bundleHash,
    snapshotHash:bundle.snapshotHash,
    receiptId:bundle.receipt.receiptId,
    originChainHash:bundle.receipt.originChainHash
  };
}

function attestationPayload(attestation:PortableClosureAttestation){
  const {signature,...payload}=attestation;
  return payload;
}

export function signPortableClosureBundle(
  bundle:PortableClosureBundle,
  config:PortableAttestationSigningConfig,
  signedAt:Date=new Date()
):PortableClosureAttestation{
  const bundleValidation=validatePortableClosureBundle(bundle);
  if(bundleValidation.verdict!=="VALID")throw new Error("PORTABLE_BUNDLE_INVALID_FOR_SIGNING");
  if(!config.keyId.trim())throw new Error("ATTESTATION_KEY_ID_REQUIRED");

  const privateKey=createPrivateKey(config.privateKeyPem);
  if(privateKey.asymmetricKeyType!=="ed25519")throw new Error("ATTESTATION_KEY_NOT_ED25519");
  const publicKey=createPublicKey(privateKey);
  const fingerprint=publicKeyFingerprint(publicKey);
  const signedAtIso=signedAt.toISOString();
  const payload=signedPayload(bundle,config.keyId.trim(),fingerprint,signedAtIso);
  const signature=cryptoSign(null,Buffer.from(canonicalJson(payload)),privateKey).toString("base64");
  return attestationSchema.parse({...payload,signature});
}

export function createPortableBundleAttestation(
  receiptId:string,
  actor:ActorContext,
  config:PortableAttestationSigningConfig,
  db:Database.Database=database(),
  signedAt:Date=new Date()
){
  requireAuthorization(actor.role,"CLOSURE_BUNDLE_SIGN");
  const bundle=exportPortableClosureBundle(receiptId,actor,db);
  const attestation=signPortableClosureBundle(bundle,config,signedAt);
  return {
    bundle,
    attestation,
    mutationPerformed:false as const,
    authorityEmbeddedInBundle:false as const
  };
}

export function verifyPortableBundleAttestation(
  bundleInput:unknown,
  attestationInput:unknown,
  trustStore:PortableAttestationTrustStore
){
  const errors:string[]=[];
  const bundleValidation=validatePortableClosureBundle(bundleInput);
  if(bundleValidation.verdict!=="VALID")errors.push("PORTABLE_BUNDLE_INVALID");

  let bundle:PortableClosureBundle|null=null;
  if(bundleValidation.verdict==="VALID")bundle=bundleInput as PortableClosureBundle;

  const parsed=attestationSchema.safeParse(attestationInput);
  if(!parsed.success){
    return {
      verdict:"INVALID" as const,
      errors:[...errors,"ATTESTATION_SCHEMA_INVALID"],
      checks:{
        bundleValid:bundleValidation.verdict==="VALID",
        fieldsMatch:false,
        trustRootPresent:false,
        keyFingerprint:false,
        signature:false,
        temporalValidity:false,
        trustedKey:false
      },
      originAttestationVerified:false as const,
      mutationPerformed:false as const,
      authorityGranted:false as const,
      substantiveTruthVerified:false as const
    };
  }

  const attestation=parsed.data;
  const fieldsMatch=Boolean(bundle)&&
    attestation.bundleId===bundle!.bundleId&&
    attestation.bundleHash===bundle!.bundleHash&&
    attestation.snapshotHash===bundle!.snapshotHash&&
    attestation.receiptId===bundle!.receipt.receiptId&&
    attestation.originChainHash===bundle!.receipt.originChainHash;
  if(!fieldsMatch)errors.push("ATTESTATION_BUNDLE_LINK_MISMATCH");

  const trust=trustStore[attestation.keyId];
  const trustRootPresent=Boolean(trust);
  if(!trustRootPresent)errors.push("ATTESTATION_TRUST_ROOT_MISSING");

  let keyFingerprint=false;
  let signature=false;
  let temporalValidity=false;
  let trustedKey=false;

  if(trust){
    trustedKey=trust.status==="TRUSTED";
    if(trust.status==="REVOKED")errors.push("ATTESTATION_KEY_REVOKED");
    else if(trust.status!=="TRUSTED")errors.push("ATTESTATION_KEY_UNTRUSTED");

    try{
      const publicKey=createPublicKey(trust.publicKeyPem);
      if(publicKey.asymmetricKeyType!=="ed25519")throw new Error("ATTESTATION_KEY_NOT_ED25519");
      keyFingerprint=publicKeyFingerprint(publicKey)===attestation.publicKeyFingerprint;
      if(!keyFingerprint)errors.push("ATTESTATION_KEY_FINGERPRINT_MISMATCH");
      signature=cryptoVerify(
        null,
        Buffer.from(canonicalJson(attestationPayload(attestation))),
        publicKey,
        Buffer.from(attestation.signature,"base64")
      );
      if(!signature)errors.push("ATTESTATION_SIGNATURE_INVALID");
    }catch(error){
      if(!errors.includes("ATTESTATION_KEY_FINGERPRINT_MISMATCH"))errors.push(
        error instanceof Error&&error.message==="ATTESTATION_KEY_NOT_ED25519"
          ?"ATTESTATION_KEY_NOT_ED25519"
          :"ATTESTATION_PUBLIC_KEY_INVALID"
      );
    }

    const signedAt=Date.parse(attestation.signedAt);
    const notBefore=trust.notBefore?Date.parse(trust.notBefore):Number.NEGATIVE_INFINITY;
    const notAfter=trust.notAfter?Date.parse(trust.notAfter):Number.POSITIVE_INFINITY;
    temporalValidity=Number.isFinite(signedAt)&&
      (trust.notBefore===undefined||Number.isFinite(notBefore))&&
      (trust.notAfter===undefined||Number.isFinite(notAfter))&&
      signedAt>=notBefore&&signedAt<=notAfter;
    if(!temporalValidity)errors.push("ATTESTATION_TIME_OUTSIDE_TRUST_WINDOW");
  }

  const valid=bundleValidation.verdict==="VALID"&&fieldsMatch&&trustRootPresent&&
    keyFingerprint&&signature&&temporalValidity&&trustedKey;

  return {
    verdict:valid?"VALID" as const:"INVALID" as const,
    errors,
    keyId:attestation.keyId,
    publicKeyFingerprint:attestation.publicKeyFingerprint,
    checks:{
      bundleValid:bundleValidation.verdict==="VALID",
      fieldsMatch,
      trustRootPresent,
      keyFingerprint,
      signature,
      temporalValidity,
      trustedKey
    },
    originAttestationVerified:valid,
    mutationPerformed:false as const,
    authorityGranted:false as const,
    substantiveTruthVerified:false as const
  };
}

export function portableAttestationSigningConfigFromEnv(
  env:Record<string,string|undefined>=process.env
):PortableAttestationSigningConfig{
  const keyId=env.VELDGIDS_BUNDLE_SIGNING_KEY_ID?.trim();
  const raw=env.VELDGIDS_BUNDLE_SIGNING_PRIVATE_KEY_PEM;
  if(!keyId||!raw)throw new Error("BUNDLE_SIGNER_NOT_CONFIGURED");
  return {keyId,privateKeyPem:raw.replace(/\\n/g,"\n")};
}
