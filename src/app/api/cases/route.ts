import { NextResponse } from "next/server";
import { createCase } from "@/lib/mutations";
import { sqliteStore as store } from "@/lib/store-sqlite";
import { requireActor } from "@/lib/actor";

export async function GET(){return NextResponse.json(store.listCases());}
export async function POST(req:Request){try{const actor=requireActor(req);return NextResponse.json(createCase(await req.json(),actor),{status:201});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"INVALID_REQUEST"},{status:403});}}
