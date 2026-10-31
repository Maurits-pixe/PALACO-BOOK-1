import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { prepareExecutionEnvelope } from "@/lib/execution-envelope";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="REMEDIATION_PROPOSAL_NOT_FOUND"||message==="KNOWLEDGE_NOT_FOUND"||message==="RELATION_NOT_FOUND"||message==="EXECUTION_SOURCE_NOT_FOUND")return 404;
  if(message==="REMEDIATION_PROPOSAL_NOT_ACCEPTED"||message==="REMEDIATION_PROPOSAL_NOT_EXECUTABLE"||message==="REMEDIATION_WORK_NOT_DECIDED"||message==="REVIEW_SIGNAL_RESOLVED"||message==="EXECUTION_TARGET_STALE"||message==="EXECUTION_PAYLOAD_TARGET_MISMATCH"||message==="EXECUTION_PROPOSAL_TARGET_MISMATCH"||message==="EXECUTION_REVOKED_SOURCE_DENIED")return 409;
  return 400;
}

export async function POST(req:Request){
  try{
    const actor=requireActor(req);
    const payload=await req.json();
    if(typeof payload?.proposalId!=="string"||payload.proposalId.length===0)return NextResponse.json({error:"REMEDIATION_PROPOSAL_ID_REQUIRED"},{status:400});
    return NextResponse.json(prepareExecutionEnvelope(payload.proposalId,actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
