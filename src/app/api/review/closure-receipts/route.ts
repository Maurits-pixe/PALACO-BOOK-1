import {NextResponse} from "next/server";
import {requireActor} from "@/lib/actor";
import {createClosureReceipt} from "@/lib/closure-receipt";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="VERIFICATION_NOT_FOUND")return 404;
  if(
    message==="CLOSURE_RECEIPT_REQUIRES_CLOSED_MATCH"||
    message==="CLOSURE_CHAIN_INVALID"||
    message==="CLOSURE_CHAIN_LINK_MISMATCH"||
    message==="CLOSURE_PAYLOAD_HASH_MISMATCH"||
    message==="CLOSURE_AUDIT_EVIDENCE_MISSING"||
    message==="CLOSURE_AUDIT_OUTCOME_INVALID"||
    message==="CLOSURE_RECEIPT_CONFLICT"
  )return 409;
  return 400;
}

export async function POST(req:Request){
  try{
    const actor=requireActor(req);
    const payload=await req.json();
    if(typeof payload?.verificationId!=="string"||payload.verificationId.length===0)return NextResponse.json({error:"VERIFICATION_ID_REQUIRED"},{status:400});
    return NextResponse.json(createClosureReceipt(payload.verificationId,actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
