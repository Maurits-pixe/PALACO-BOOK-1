import { NextResponse } from "next/server";
import { readSessionCookie,revokeSession,SESSION_COOKIE } from "@/lib/identity";

export async function POST(req:Request){
  const token=readSessionCookie(req);
  if(token)revokeSession(token);
  const response=NextResponse.json({ok:true});
  response.cookies.set(SESSION_COOKIE,"",{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:0});
  return response;
}
