import {NextResponse} from "next/server";
import {requireActor} from "@/lib/actor";
import {
  createPortableBundleAttestation,
  portableAttestationSigningConfigFromEnv
} from "@/lib/portable-bundle-attestation";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="CLOSURE_RECEIPT_NOT_FOUND")return 404;
  if(message==="BUNDLE_SIGNER_NOT_CONFIGURED")return 503;
  if(message==="ATTESTATION_KEY_NOT_ED25519"||message==="PORTABLE_BUNDLE_INVALID_FOR_SIGNING")return 409;
  return 400;
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    const {id}=await params;
    const result=createPortableBundleAttestation(
      id,
      actor,
      portableAttestationSigningConfigFromEnv()
    );
    return NextResponse.json(result,{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
