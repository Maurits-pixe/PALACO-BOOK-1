import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { requireAuthorization } from "@/lib/authorization";
import { analyzeImpact,listOpenReviewSignals,recordImpactSignals } from "@/lib/impact-analysis";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="SOURCE_VERSION_NOT_FOUND")return 404;
  return 400;
}

export async function GET(req:Request){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"IMPACT_ANALYZE");
    return NextResponse.json(listOpenReviewSignals(),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}

export async function POST(req:Request){
  try{
    const actor=requireActor(req);
    const payload=await req.json();
    if(typeof payload!=="object"||payload===null)return NextResponse.json({error:"INVALID_REQUEST"},{status:400});
    const {mode,...input}=payload as Record<string,unknown>;
    if(mode==="PREVIEW")return NextResponse.json(analyzeImpact(input,actor),{headers:{"Cache-Control":"private, no-store"}});
    if(mode==="RECORD")return NextResponse.json(recordImpactSignals(input,actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
    return NextResponse.json({error:"IMPACT_MODE_REQUIRED"},{status:400});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
