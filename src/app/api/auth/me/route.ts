import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";

export async function GET(req:Request){
  try{
    const actor=requireActor(req);
    return NextResponse.json({actorId:actor.actorId,role:actor.role,authentication:actor.authentication});
  }catch(error){
    const message=error instanceof Error?error.message:"AUTHENTICATION_REQUIRED";
    return NextResponse.json({error:message},{status:401});
  }
}
