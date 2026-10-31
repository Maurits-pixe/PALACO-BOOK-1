import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { consumeExecutionEnvelope } from "@/lib/remediation-executor";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="EXECUTION_ENVELOPE_NOT_FOUND"||message==="KNOWLEDGE_NOT_FOUND"||message==="RELATION_NOT_FOUND"||message==="EXECUTION_SOURCE_NOT_FOUND")return 404;
  if(
    message==="EXECUTION_ENVELOPE_ALREADY_CONSUMED"||
    message==="EXECUTION_ENVELOPE_NOT_AUTHORIZED"||
    message==="EXECUTION_AUTHORIZATION_EXPIRED"||
    message==="EXECUTION_BEFORE_AUTHORIZATION"||
    message==="EXECUTION_TARGET_STALE"||
    message==="EXECUTION_PROPOSAL_CHANGED"||
    message==="EXECUTION_PAYLOAD_HASH_MISMATCH"||
    message==="EXECUTION_ENVELOPE_STATE_CHANGED"||
    message==="REVIEW_SIGNAL_RESOLVED"||
    message==="RELATION_REVOKED_TERMINAL"
  )return 409;
  return 400;
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    const {id}=await params;
    return NextResponse.json(consumeExecutionEnvelope(id,actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
