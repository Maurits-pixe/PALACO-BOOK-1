import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { requireAuthorization } from "@/lib/authorization";
import { listSourceStateHistory,transitionSourceState } from "@/lib/source-ledger";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="SOURCE_VERSION_NOT_FOUND"||message==="SOURCE_STATE_NOT_FOUND"||message==="REPLACEMENT_SOURCE_VERSION_NOT_FOUND")return 404;
  if(message==="SOURCE_STATE_TERMINAL"||message==="REPLACEMENT_SOURCE_VERSION_REQUIRED"||message==="REPLACEMENT_SOURCE_VERSION_INVALID"||message==="REVOKED_SOURCE_CANNOT_DECLARE_REPLACEMENT")return 409;
  return 400;
}

export async function GET(req:Request,{params}:{params:Promise<{id:string;version:string}>}){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"KNOWLEDGE_READ");
    const {id,version}=await params;
    const parsedVersion=Number(version);
    if(!Number.isInteger(parsedVersion)||parsedVersion<1)return NextResponse.json({error:"SOURCE_VERSION_INVALID"},{status:400});
    return NextResponse.json(listSourceStateHistory(id,parsedVersion),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}

export async function POST(req:Request,{params}:{params:Promise<{id:string;version:string}>}){
  try{
    const actor=requireActor(req);
    const {id,version}=await params;
    const parsedVersion=Number(version);
    if(!Number.isInteger(parsedVersion)||parsedVersion<1)return NextResponse.json({error:"SOURCE_VERSION_INVALID"},{status:400});
    const payload=await req.json();
    return NextResponse.json(transitionSourceState({...payload,sourceId:id,sourceVersion:parsedVersion},actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
