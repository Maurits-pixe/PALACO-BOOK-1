import {NextResponse} from "next/server";
import {requireActor} from "@/lib/actor";
import {requireAuthorization} from "@/lib/authorization";
import {closeVerifiedRemediation,listPostExecutionVerificationHistory} from "@/lib/post-execution-verification";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="VERIFICATION_NOT_FOUND"||message==="EXECUTION_ENVELOPE_NOT_FOUND"||message==="REVIEW_SIGNAL_NOT_FOUND")return 404;
  if(message==="VERIFICATION_CLOSED_TERMINAL"||message==="VERIFICATION_MATCH_REQUIRED"||message==="CLOSURE_EXECUTOR_SEPARATION_REQUIRED"||message==="VERIFICATION_SIGNAL_DRIFT"||message==="REVIEW_SIGNAL_ACK_REQUIRED"||message==="REVIEW_SIGNAL_RESOLVED_TERMINAL")return 409;
  return 400;
}

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"REMEDIATION_VERIFY");
    const {id}=await params;
    return NextResponse.json(listPostExecutionVerificationHistory(id),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    const {id}=await params;
    const payload=await req.json();
    return NextResponse.json(closeVerifiedRemediation(id,String(payload?.note??""),actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
