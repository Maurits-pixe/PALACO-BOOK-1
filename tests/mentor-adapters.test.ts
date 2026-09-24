import test from "node:test";
import assert from "node:assert/strict";
import { createServer,type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { RemoteMentorAdapter,configuredMentorAdapters } from "../src/lib/mentor-adapters";
import type { MentorInput } from "../src/lib/mentor-contract";

const input:MentorInput={
  correlationId:"corr-adapter-001",
  question:"Compare the synthetic evidence.",
  caseId:"case-synthetic",
  dataClassification:"SYNTHETIC_ALPHA",
  contextHash:"context-hash",
  inputRefs:["case-synthetic","knowledge-synthetic"],
  provenanceRefs:["prov-synthetic"],
  evidenceRefs:["source-synthetic"],
  knowledge:[{id:"knowledge-synthetic",title:"Synthetic battery note",content:"Synthetic test content only.",version:1,sourceIds:["source-synthetic"]}]
};

async function withServer(handler:RequestListener,fn:(url:string)=>Promise<void>){
  const server=createServer(handler);
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve());});
  const address=server.address() as AddressInfo;
  try{await fn("http://127.0.0.1:"+address.port);}
  finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
}

function remote(endpoint:string,timeoutMs=500){
  return new RemoteMentorAdapter({
    mentorId:"M12",
    endpoint,
    apiKey:"server-side-test-secret",
    modelBinding:"synthetic-provider-model",
    capabilityBinding:["evidence-analysis"],
    promptVersion:"mentor-v0.1",
    timeoutMs
  });
}

test("remote adapter returns a fully observable MentorObservation",async()=>{
  await withServer((_req,res)=>{
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({
      claims:[{claimKey:"common",text:"Synthetic evidence remains bounded.",label:"FACT",stance:"SUPPORT",evidenceRefs:["source-synthetic"]}],
      uncertainties:["Synthetic uncertainty."],
      limitations:["Synthetic provider response."],
      recommendationsOrOptions:["Review the evidence."],
      safetyFlags:[],
      dissentSignals:[]
    }));
  },async url=>{
    const result=await remote(url).analyze(input);
    assert.equal(result.mentorId,"M12");
    assert.equal(result.correlationId,input.correlationId);
    assert.deepEqual(result.inputRefs,input.inputRefs);
    assert.deepEqual(result.provenanceRefs,input.provenanceRefs);
    assert.equal(result.modelBinding,"synthetic-provider-model");
    assert.equal(result.promptVersion,"mentor-v0.1");
    assert.ok(result.auditId.length>10);
    assert.match(result.inputHash,/^[a-f0-9]{64}$/);
    assert.match(result.outputHash,/^[a-f0-9]{64}$/);
  });
});

test("remote adapter times out fail-closed",async()=>{
  await withServer((_req,res)=>{
    setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{"content-type":"application/json"});res.end("{}");}},100);
  },async url=>{
    await assert.rejects(()=>remote(url,10).analyze(input),/MENTOR_REMOTE_TIMEOUT/);
  });
});

test("remote adapter rejects invalid provider response",async()=>{
  await withServer((_req,res)=>{
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({unexpected:true}));
  },async url=>{
    await assert.rejects(()=>remote(url).analyze(input),/claims/);
  });
});

test("remote adapter reports provider unavailable",async()=>{
  await withServer((_req,res)=>{
    res.writeHead(503,{"content-type":"application/json"});
    res.end(JSON.stringify({error:"unavailable"}));
  },async url=>{
    await assert.rejects(()=>remote(url).analyze(input),/MENTOR_REMOTE_HTTP_503/);
  });
});

test("real-provider configuration is feature-flagged and requires a server-side secret",()=>{
  const snapshot={
    enabled:process.env.PALACO_MENTOR_REMOTE_ENABLED,
    endpoint:process.env.PALACO_MENTOR_ENDPOINT,
    model:process.env.PALACO_MENTOR_MODEL,
    key:process.env.PALACO_MENTOR_API_KEY
  };
  delete process.env.PALACO_MENTOR_REMOTE_ENABLED;
  delete process.env.PALACO_MENTOR_ENDPOINT;
  delete process.env.PALACO_MENTOR_MODEL;
  delete process.env.PALACO_MENTOR_API_KEY;
  assert.throws(()=>configuredMentorAdapters(),/MENTOR_REMOTE_DISABLED/);

  process.env.PALACO_MENTOR_REMOTE_ENABLED="true";
  process.env.PALACO_MENTOR_ENDPOINT="https://example.invalid/mentor";
  process.env.PALACO_MENTOR_MODEL="synthetic-model";
  assert.throws(()=>configuredMentorAdapters(),/MENTOR_REMOTE_NOT_CONFIGURED/);

  if(snapshot.enabled===undefined)delete process.env.PALACO_MENTOR_REMOTE_ENABLED;else process.env.PALACO_MENTOR_REMOTE_ENABLED=snapshot.enabled;
  if(snapshot.endpoint===undefined)delete process.env.PALACO_MENTOR_ENDPOINT;else process.env.PALACO_MENTOR_ENDPOINT=snapshot.endpoint;
  if(snapshot.model===undefined)delete process.env.PALACO_MENTOR_MODEL;else process.env.PALACO_MENTOR_MODEL=snapshot.model;
  if(snapshot.key===undefined)delete process.env.PALACO_MENTOR_API_KEY;else process.env.PALACO_MENTOR_API_KEY=snapshot.key;
});
