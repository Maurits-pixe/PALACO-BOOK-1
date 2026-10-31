import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { requireAuthorization } from "@/lib/authorization";
import { listRemediationWorkHistory } from "@/lib/remediation";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  return 400;
}

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"REMEDIATION_QUEUE_READ");
    const {id}=await params;
    return NextResponse.json(listRemediationWorkHistory(id),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
