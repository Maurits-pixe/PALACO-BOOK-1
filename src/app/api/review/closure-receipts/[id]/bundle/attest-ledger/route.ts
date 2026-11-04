import {NextResponse} from "next/server";
import {requireActor} from "@/lib/actor";
import {portableAttestationSigningConfigFromEnv} from "@/lib/portable-bundle-attestation";
import {createLedgerBoundPortableBundleAttestation} from "@/lib/ledger-bound-attestation";

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req); const {id}=await params;
    return NextResponse.json(createLedgerBoundPortableBundleAttestation(id,actor,portableAttestationSigningConfigFromEnv()),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    const message=error instanceof Error?error.message:"INVALID_REQUEST";
    const status=message==="AUTHORIZATION_DENIED"?403:message==="BUNDLE_SIGNER_NOT_CONFIGURED"?503:409;
    return NextResponse.json({error:message},{status});
  }
}
