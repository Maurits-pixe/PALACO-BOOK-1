import {NextResponse} from "next/server";
import {requireActor} from "@/lib/actor";
import {recordPostExecutionVerification} from "@/lib/post-execution-verification";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="EXECUTION_ENVELOPE_NOT_FOUND"||message==="REMEDIATION_PROPOSAL_NOT_FOUND"||message==="REMEDIATION_WORK_NOT_FOUND"||message==="REVIEW_SIGNAL_NOT_FOUND")return 404;
  if(message==="EXECUTION_NOT_CONSUMED"||message==="VERIFICATION_EXECUTOR_SEPARATION_REQUIRED"||message==="REVIEW_SIGNAL_RESOLVED_TERMINAL"||message==="VERIFICATION_CLOSED_TERMINAL")return 409;
  return 400;
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    const {id}=await params;
    return NextResponse.json(recordPostExecutionVerification(id,actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
