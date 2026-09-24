import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import { configuredMentorAdapters } from "@/lib/mentor-adapters";
import { runMentorCouncil } from "@/lib/mentor-engine";

const requestSchema=z.object({
  correlationId:z.string().min(8).max(128),
  question:z.string().min(1).max(4000),
  dataClassification:z.literal("SYNTHETIC_ALPHA")
});

export async function POST(req:Request,context:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    const {id}=await context.params;
    const body=requestSchema.parse(await req.json());
    const result=await runMentorCouncil({caseId:id,...body},actor,configuredMentorAdapters());
    return NextResponse.json(result,{status:201});
  }catch(error){
    const message=error instanceof Error?error.message:"MENTOR_RUN_FAILED";
    const status=/AUTH|IDENTITY/.test(message)?403:/CASE_NOT_FOUND/.test(message)?404:/REPLAY/.test(message)?409:400;
    return NextResponse.json({error:message},{status});
  }
}
