import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { requireAuthorization } from "@/lib/authorization";
import { listRemediationQueue,materializeRemediationWork } from "@/lib/remediation";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="REVIEW_SIGNAL_NOT_FOUND")return 404;
  if(message==="REVIEW_SIGNAL_RESOLVED")return 409;
  return 400;
}

export async function GET(req:Request){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"REMEDIATION_QUEUE_READ");
    return NextResponse.json(listRemediationQueue(),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}

export async function POST(req:Request){
  try{
    const actor=requireActor(req);
    const payload=await req.json();
    if(typeof payload?.signalId!=="string"||payload.signalId.length===0)return NextResponse.json({error:"REVIEW_SIGNAL_ID_REQUIRED"},{status:400});
    return NextResponse.json(materializeRemediationWork(payload.signalId,actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
