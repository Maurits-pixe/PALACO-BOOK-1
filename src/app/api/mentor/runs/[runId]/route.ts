import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { inspectMentorRun } from "@/lib/mentor-engine";

export async function GET(req:Request,context:{params:Promise<{runId:string}>}){
  try{
    const actor=requireActor(req);
    const {runId}=await context.params;
    const result=inspectMentorRun(runId,actor);
    if(!result)return NextResponse.json({error:"MENTOR_RUN_NOT_FOUND"},{status:404});
    return NextResponse.json(result);
  }catch(error){
    const message=error instanceof Error?error.message:"AUTHORIZATION_DENIED";
    return NextResponse.json({error:message},{status:403});
  }
}
