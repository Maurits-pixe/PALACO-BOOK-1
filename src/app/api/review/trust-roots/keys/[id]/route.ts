import {NextResponse} from "next/server";
import {requireActor} from "@/lib/actor";
import {getTrustRootKey,retireTrustRootKey,revokeTrustRootKey,trustTrustRootKey} from "@/lib/trust-root-ledger";

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req); const {id}=await params;
    return NextResponse.json(getTrustRootKey(id,actor),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    const message=error instanceof Error?error.message:"INVALID_REQUEST";
    return NextResponse.json({error:message},{status:message==="AUTHORIZATION_DENIED"?403:message==="TRUST_ROOT_KEY_NOT_FOUND"?404:400});
  }
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req); const {id}=await params; const body=await req.json();
    const common={effectiveAt:body?.effectiveAt,reason:String(body?.reason??"")};
    const result=body?.status==="TRUSTED"?trustTrustRootKey(id,common,actor):
      body?.status==="RETIRED"?retireTrustRootKey(id,common,actor):
      body?.status==="REVOKED"?revokeTrustRootKey(id,{...common,invalidFrom:body?.invalidFrom},actor):
      (()=>{throw new Error("TRUST_ROOT_STATUS_INVALID")})();
    return NextResponse.json(result,{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    const message=error instanceof Error?error.message:"INVALID_REQUEST";
    const status=message==="AUTHORIZATION_DENIED"?403:message==="TRUST_ROOT_KEY_NOT_FOUND"?404:409;
    return NextResponse.json({error:message},{status});
  }
}
