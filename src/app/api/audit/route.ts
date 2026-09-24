import { NextResponse } from "next/server";import { authorize,type Role } from "@/lib/authorization";import { store } from "@/lib/store";
export async function GET(req:Request){const role=(req.headers.get("x-palaco-role")??"USER") as Role;if(!authorize(role,"AUDIT_READ"))return NextResponse.json({error:"AUTHORIZATION_DENIED"},{status:403});return NextResponse.json(store.audit());}
