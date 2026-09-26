import { NextResponse } from "next/server";
import { createCase } from "@/lib/mutations";
import { sqliteStore as store } from "@/lib/store-sqlite";
import { requireActor } from "@/lib/actor";
import { requireAuthorization } from "@/lib/authorization";
import { readAccessError } from "@/lib/read-access";

export async function GET(req:Request){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"CASE_READ");
    return NextResponse.json(store.listCases(),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return readAccessError(error);}
}
export async function POST(req:Request){try{const actor=requireActor(req);return NextResponse.json(createCase(await req.json(),actor),{status:201});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"INVALID_REQUEST"},{status:403});}}
