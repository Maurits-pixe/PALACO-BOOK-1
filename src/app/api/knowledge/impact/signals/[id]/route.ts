import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { requireAuthorization } from "@/lib/authorization";
import { listReviewSignalHistory,transitionReviewSignal } from "@/lib/impact-analysis";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="REVIEW_SIGNAL_NOT_FOUND")return 404;
  if(message==="REVIEW_SIGNAL_RESOLVED_TERMINAL"||message==="REVIEW_SIGNAL_TRANSITION_DENIED")return 409;
  return 400;
}

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"IMPACT_ANALYZE");
    const {id}=await params;
    return NextResponse.json(listReviewSignalHistory(id),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    const {id}=await params;
    const payload=await req.json();
    const status=payload?.status;
    if(status!=="ACKNOWLEDGED"&&status!=="RESOLVED")return NextResponse.json({error:"REVIEW_SIGNAL_STATUS_INVALID"},{status:400});
    return NextResponse.json(transitionReviewSignal(id,status,actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
