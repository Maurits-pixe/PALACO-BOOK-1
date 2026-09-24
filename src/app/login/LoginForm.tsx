"use client";
import { FormEvent,useState } from "react";

export default function LoginForm(){
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setBusy(true);setError("");
    const data=new FormData(event.currentTarget);
    const response=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:data.get("username"),password:data.get("password")})});
    const body=await response.json();
    if(!response.ok){setError(body.error??"LOGIN_FAILED");setBusy(false);return;}
    window.location.href="/";
  }
  return <form onSubmit={submit} className="card" style={{maxWidth:480}}>
    <p className="eyebrow">PALACO identity</p>
    <h1 style={{fontSize:"2.5rem"}}>Login</h1>
    <label>Gebruikersnaam<input name="username" autoComplete="username" required style={{display:"block",width:"100%",padding:12,margin:"8px 0 18px"}} /></label>
    <label>Wachtwoord<input name="password" type="password" autoComplete="current-password" required style={{display:"block",width:"100%",padding:12,margin:"8px 0 18px"}} /></label>
    <button disabled={busy} type="submit" style={{padding:"12px 18px"}}>{busy?"Bezig…":"Inloggen"}</button>
    {error?<p role="alert">{error}</p>:null}
  </form>;
}
