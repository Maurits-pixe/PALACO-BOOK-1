import { NextResponse } from "next/server";
import { requireActor } from "@/lib/actor";
import { requireAuthorization } from "@/lib/authorization";
import { evolveKnowledgeRelation,listKnowledgeRelationHistory } from "@/lib/knowledge-graph";

function statusFor(error:unknown){
  const message=error instanceof Error?error.message:"INVALID_REQUEST";
  if(message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED")return 401;
  if(message==="AUTHORIZATION_DENIED")return 403;
  if(message==="RELATION_NOT_FOUND")return 404;
  if(message==="RELATION_REVOKED_TERMINAL")return 409;
  return 400;
}

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"KNOWLEDGE_READ");
    const {id}=await params;
    return NextResponse.json(listKnowledgeRelationHistory(id),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=requireActor(req);
    const {id}=await params;
    const payload=await req.json();
    if(typeof payload==="object"&&payload!==null&&"relationId" in payload&&payload.relationId!==id){
      return NextResponse.json({error:"RELATION_ID_MISMATCH"},{status:400});
    }
    return NextResponse.json(evolveKnowledgeRelation({...payload,relationId:id},actor),{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"INVALID_REQUEST"},{status:statusFor(error)});
  }
}
