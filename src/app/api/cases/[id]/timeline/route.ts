import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { buildCaseTimeline } from "@/lib/timeline";

export async function GET(req:Request,context:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    const {id}=await context.params;
    const timeline=buildCaseTimeline(id,actor);
    if(!timeline)return NextResponse.json({error:"CASE_NOT_FOUND"},{status:404});
    return NextResponse.json(timeline);
  }catch(error){
    const message=error instanceof Error?error.message:"INVALID_REQUEST";
    return NextResponse.json({error:message},{status:403});
  }
}
