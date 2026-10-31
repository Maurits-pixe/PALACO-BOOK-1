import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { requireAuthorization } from "@/lib/authorization";
import { decideRemediationProposal,listRemediationProposalHistory } from "@/lib/remediation";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="REMEDIATION_PROPOSAL_NOT_FOUND"||message==="REMEDIATION_WORK_NOT_FOUND")return 404;
  if(message==="REVIEW_SIGNAL_RESOLVED"||message==="REMEDIATION_PROPOSAL_ALREADY_DECIDED"||message==="REMEDIATION_SEPARATION_OF_DUTIES"||message==="REMEDIATION_WORK_NOT_PROPOSED")return 409;
  return 400;
}

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"REMEDIATION_QUEUE_READ");
    const {id}=await params;
    return NextResponse.json(listRemediationProposalHistory(id),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    const {id}=await params;
    return NextResponse.json(decideRemediationProposal(id,await req.json(),actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
