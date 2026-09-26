import { NextResponse } from "next/server";

const authenticationErrors=new Set([
  "AUTHENTICATION_REQUIRED","IDENTITY_NOT_CONFIGURED",
  "IDENTITY_PROXY_NOT_CONFIGURED","INVALID_ACTOR_CONTEXT"
]);

export function readAccessError(error:unknown){
  const message=error instanceof Error?error.message:"REQUEST_FAILED";
  const status=message==="AUTHORIZATION_DENIED"?403:authenticationErrors.has(message)?401:500;
  return NextResponse.json({error:status===500?"REQUEST_FAILED":message},{status,headers:{"Cache-Control":"private, no-store"}});
}
