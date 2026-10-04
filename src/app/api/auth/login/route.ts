import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate,bootstrapOwnerFromEnv,createSession,SESSION_COOKIE } from "@/lib/identity";

const loginSchema=z.object({username:z.string().min(1),password:z.string().min(1)});

export async function POST(req:Request){
  try{
    bootstrapOwnerFromEnv();
    const {username,password}=loginSchema.parse(await req.json());
    const user=authenticate(username,password);
    const session=createSession(user.id);
    const response=NextResponse.json({user:{id:user.id,username:user.username,role:user.role}});
    response.cookies.set(SESSION_COOKIE,session.token,{
      httpOnly:true,
      sameSite:"lax",
      secure:process.env.NODE_ENV==="production",
      path:"/",
      maxAge:session.maxAge
    });
    return response;
  }catch(error){
    const message=error instanceof Error?error.message:"LOGIN_FAILED";
    const status=/INVALID_CREDENTIALS/.test(message)?401:400;
    return NextResponse.json({error:message},{status});
  }
}
