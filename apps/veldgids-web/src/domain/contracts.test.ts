import assert from "node:assert/strict";
import {test} from "node:test";
import {authorize} from "./authorization";
import {mentorRegistry} from "./mentors";
import {createRoutingPlan} from "./routing";
import {canReplacePublished,type KnowledgeObject} from "./knowledge";
import {appendAudit,type AuditEvent} from "./audit";

test("registry has 16 permanent and 8 freelance slots",()=>{assert.equal(mentorRegistry.length,24);assert.equal(mentorRegistry.filter(m=>m.kind==="PERMANENT").length,16);assert.equal(mentorRegistry.filter(m=>m.kind==="FREELANCE").length,8)});
test("external effects require explicit authorization",()=>{assert.equal(authorize({role:"OWNER",action:"external:publish",resource:"report"}),"DENY");assert.equal(authorize({role:"OWNER",action:"external:publish",resource:"report",explicitExternalAuthorization:true}),"ALLOW")});
test("non-owner mutations default deny",()=>{assert.equal(authorize({role:"EDITOR",action:"write",resource:"knowledge"}),"DENY");assert.equal(authorize({role:"USER",action:"read",resource:"knowledge"}),"ALLOW")});
test("routing preserves human decision authority",()=>{const plan=createRoutingPlan({routeId:"r1",questionHash:"q",mentors:[mentorRegistry[0]],evidenceScope:["s1"],policyVersion:"v0.1"});assert.equal(plan.humanDecisionRequired,true);assert.deepEqual(plan.selectedMentorIds,["M01"])});
test("published knowledge requires version evolution",()=>{const k:KnowledgeObject={id:"k1",title:"x",type:"NOTE",summary:"",version:"1.0.0",status:"PUBLISHED",provenance:"VERIFIED",sourceRefs:[],relationIds:[],updatedAt:"2026-09-30T00:00:00Z"};assert.equal(canReplacePublished(k,{...k}),false);assert.equal(canReplacePublished(k,{...k,version:"1.0.1"}),true)});
test("audit append preserves previous ledger",()=>{const ledger:readonly AuditEvent[]=[];const event:AuditEvent={eventId:"e1",actor:"u1",action:"read",object:"k1",objectVersion:"1",timestamp:"2026-09-30T00:00:00Z",requestId:"r1",authorizationContext:"USER",outcome:"SUCCESS",provenanceRefs:["s1"]};const next=appendAudit(ledger,event);assert.equal(ledger.length,0);assert.equal(next.length,1);assert.equal(Object.isFrozen(next),true)});
