import { NextResponse } from "next/server";
import { requireAuthorization } from "@/lib/authorization";
import { requireActor } from "@/lib/actor";
import { sqliteStore } from "@/lib/store-sqlite";

export async function GET(req:Request,context:{params:Promise<{id:string}>}){try{const actor=requireActor(req);requireAuthorization(actor.role,"AUDIT_READ");const {id}=await context.params;const trace=sqliteStore.traceCase(id);if(!trace)return NextResponse.json({error:"CASE_NOT_FOUND"},{status:404});return NextResponse.json(trace);}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"AUTHORIZATION_DENIED"},{status:403});}}
