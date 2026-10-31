import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { requireAuthorization } from "@/lib/authorization";
import { createKnowledgeRelation,listKnowledgeRelations } from "@/lib/knowledge-graph";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="KNOWLEDGE_VERSION_NOT_FOUND")return 404;
  if(message==="RELATION_EXISTS")return 409;
  return 400;
}

export async function GET(req:Request){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"KNOWLEDGE_READ");
    const knowledgeId=new URL(req.url).searchParams.get("knowledgeId");
    if(!knowledgeId)return NextResponse.json({error:"KNOWLEDGE_ID_REQUIRED"},{status:400});
    return NextResponse.json(listKnowledgeRelations(knowledgeId),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}

export async function POST(req:Request){
  try{
    const actor=requireActor(req);
    return NextResponse.json(createKnowledgeRelation(await req.json(),actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
