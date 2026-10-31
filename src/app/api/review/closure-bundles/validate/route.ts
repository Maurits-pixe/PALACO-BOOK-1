import {NextResponse} from "next/server";
import {requireActor} from "@/lib/actor";
import {requireAuthorization} from "@/lib/authorization";
import {validatePortableClosureBundle} from "@/lib/portable-closure-bundle";

export async function POST(req:Request){
  try{
    const actor=requireActor(req);
    requireAuthorization(actor.role,"CLOSURE_BUNDLE_VALIDATE");
    return NextResponse.json(validatePortableClosureBundle(await req.json()),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    const message=error instanceof Error?error.message:"INVALID_REQUEST";
    const status=message==="AUTHENTICATION_REQUIRED"||message==="IDENTITY_NOT_CONFIGURED"?401:message==="AUTHORIZATION_DENIED"?403:400;
    return NextResponse.json({error:message},{status});
  }
}
