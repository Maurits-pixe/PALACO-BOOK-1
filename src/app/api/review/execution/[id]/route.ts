import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { requireAuthorization } from "@/lib/authorization";
import { authorizeExecutionEnvelope,cancelExecutionEnvelope,listExecutionEnvelopeHistory } from "@/lib/execution-envelope";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="EXECUTION_ENVELOPE_NOT_FOUND")return 404;
  if(message==="EXECUTION_ENVELOPE_NOT_PREPARED"||message==="EXECUTION_ENVELOPE_TERMINAL"||message==="EXECUTION_PROPOSAL_CHANGED"||message==="REVIEW_SIGNAL_RESOLVED"||message==="EXECUTION_TARGET_STALE"||message==="EXECUTION_PAYLOAD_HASH_MISMATCH")return 409;
  return 400;
}

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"REMEDIATION_EXECUTION_READ");
    const {id}=await params;
    return NextResponse.json(listExecutionEnvelopeHistory(id),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    const {id}=await params;
    const payload=await req.json();
    if(payload?.action==="AUTHORIZE")return NextResponse.json(authorizeExecutionEnvelope(id,{validForSeconds:payload.validForSeconds},actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
    if(payload?.action==="CANCEL")return NextResponse.json(cancelExecutionEnvelope(id,actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
    return NextResponse.json({error:"EXECUTION_ACTION_REQUIRED"},{status:400});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
