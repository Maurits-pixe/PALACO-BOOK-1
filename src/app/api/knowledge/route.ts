import { NextResponse } from "next/server";
import { createKnowledge } from "@/lib/mutations";
import { sqliteStore as store } from "@/lib/store-sqlite";
import { requireActor } from "@/lib/actor";

export async function GET(req:Request){const caseId=new URL(req.url).searchParams.get("caseId")??"";return NextResponse.json(store.listKnowledge(caseId));}
export async function POST(req:Request){try{const actor=requireActor(req);return NextResponse.json(createKnowledge(await req.json(),actor),{status:201});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"INVALID_REQUEST"},{status:403});}}
