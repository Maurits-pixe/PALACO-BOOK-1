import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { registerSourceVersion } from "@/lib/source-ledger";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="SOURCE_VERSION_NOT_NEXT")return 409;
  return 400;
}

export async function POST(req:Request){
  try{
    const actor=requireActor(req);
    return NextResponse.json(registerSourceVersion(await req.json(),actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
