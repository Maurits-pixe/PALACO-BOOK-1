import { NextResponse } from "next/server";
import { authorize,type Role } from "@/lib/authorization";
import { sqliteStore } from "@/lib/store-sqlite";

export async function GET(req:Request,context:{params:Promise<{id:string}>}){const role=(req.headers.get("x-palaco-role")??"USER") as Role;if(!authorize(role,"AUDIT_READ"))return NextResponse.json({error:"AUTHORIZATION_DENIED"},{status:403});const {id}=await context.params;const trace=sqliteStore.traceCase(id);if(!trace)return NextResponse.json({error:"CASE_NOT_FOUND"},{status:404});return NextResponse.json(trace);}
