import {NextResponse} from "next/server";
import {requireActor} from "@/lib/actor";
import {rotateTrustRootKey} from "@/lib/trust-root-ledger";

export async function POST(req:Request){
  try{
    const actor=requireActor(req); const body=await req.json();
    return NextResponse.json(rotateTrustRootKey({
      fromKeyId:String(body?.fromKeyId??""),toKeyId:String(body?.toKeyId??""),
      toPublicKeyPem:String(body?.toPublicKeyPem??""),effectiveAt:body?.effectiveAt,reason:String(body?.reason??"")
    },actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    const message=error instanceof Error?error.message:"INVALID_REQUEST";
    return NextResponse.json({error:message},{status:message==="AUTHORIZATION_DENIED"?403:409});
  }
}
