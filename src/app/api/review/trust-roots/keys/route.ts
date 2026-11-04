import {NextResponse} from "next/server";
import {requireActor} from "@/lib/actor";
import {registerTrustRootKey} from "@/lib/trust-root-ledger";

export async function POST(req:Request){
  try{
    const actor=requireActor(req);
    const body=await req.json();
    return NextResponse.json(registerTrustRootKey({keyId:String(body?.keyId??""),publicKeyPem:String(body?.publicKeyPem??"")},actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    const message=error instanceof Error?error.message:"INVALID_REQUEST";
    const status=message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED"?401:message==="AUTHORIZATION_DENIED"?403:409;
    return NextResponse.json({error:message},{status});
  }
}
