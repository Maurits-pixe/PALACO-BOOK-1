import { NextResponse } from "next/server";
import { requireAuthorization } from "@/lib/authorization";
import { requireActor } from "@/lib/actor";
import { sqliteStore as store } from "@/lib/store-sqlite";

export async function GET(req:Request){try{const actor=requireActor(req);requireAuthorization(actor.role,"AUDIT_READ");return NextResponse.json(store.audit());}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"AUTHORIZATION_DENIED"},{status:403});}}
