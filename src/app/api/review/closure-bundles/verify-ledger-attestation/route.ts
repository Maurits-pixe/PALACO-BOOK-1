import {NextResponse} from "next/server";
import {requireActor} from "@/lib/actor";
import {verifyLedgerBoundPortableBundleAttestation} from "@/lib/ledger-bound-attestation";

export async function POST(req:Request){
  try{
    const actor=requireActor(req); const body=await req.json();
    return NextResponse.json(verifyLedgerBoundPortableBundleAttestation(body?.bundle,body?.attestation,actor),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    const message=error instanceof Error?error.message:"INVALID_REQUEST";
    return NextResponse.json({error:message},{status:message==="AUTHORIZATION_DENIED"?403:400});
  }
}
