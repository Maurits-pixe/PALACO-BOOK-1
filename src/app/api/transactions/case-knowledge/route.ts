import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { createCaseKnowledgeTransaction } from "@/lib/transaction";

export async function POST(req:Request){
  try{
    const actor=requireActor(req);
    const result=createCaseKnowledgeTransaction(await req.json(),actor);
    return NextResponse.json(result,{status:201});
  }catch(error){
    const message=error instanceof Error?error.message:"INVALID_REQUEST";
    const status=/AUTH|IDENTITY/.test(message)?403:400;
    return NextResponse.json({error:message},{status});
  }
}
