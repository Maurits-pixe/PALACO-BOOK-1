import assert from "node:assert/strict";
import {test} from "node:test";
import {authorize,type ExternalAuthorizationGrant} from "./authorization";
import {mentorRegistry} from "./mentors";
import {createRoutingPlan} from "./routing";
import {canReplacePublished,type KnowledgeObject} from "./knowledge";
import {appendAudit,type AuditEvent} from "./audit";

const trustedTime="2026-10-01T09:00:00Z";
const grant:ExternalAuthorizationGrant={grantId:"g1",actorId:"u1",action:"external:publish",resource:"report",issuedAt:"2026-10-01T08:00:00Z",validUntil:"2026-10-01T10:00:00Z",status:"ACTIVE",policyVersion:"v0.1"};

test("registry has 16 permanent and 8 freelance slots",()=>{assert.equal(mentorRegistry.length,24);assert.equal(mentorRegistry.filter(m=>m.kind==="PERMANENT").length,16);assert.equal(mentorRegistry.filter(m=>m.kind==="FREELANCE").length,8)});
test("external effects require an active grant bound to actor/action/resource",()=>{assert.equal(authorize({actorId:"u1",role:"OWNER",action:"external:publish",resource:"report",trustedTime}),"DENY");assert.equal(authorize({actorId:"u1",role:"OWNER",action:"external:publish",resource:"report",trustedTime,externalGrant:grant}),"ALLOW");assert.equal(authorize({actorId:"u2",role:"OWNER",action:"external:publish",resource:"report",trustedTime,externalGrant:grant}),"DENY");assert.equal(authorize({actorId:"u1",role:"OWNER",action:"external:publish",resource:"report",trustedTime:"2026-10-01T11:00:00Z",externalGrant:grant}),"DENY");assert.equal(authorize({actorId:"u1",role:"OWNER",action:"external:publish",resource:"report",trustedTime,externalGrant:{...grant,status:"REVOKED"}}),"DENY")});
test("non-owner mutations default deny",()=>{assert.equal(authorize({actorId:"u1",role:"EDITOR",action:"write",resource:"knowledge",trustedTime}),"DENY");assert.equal(authorize({actorId:"u1",role:"USER",action:"read",resource:"knowledge",trustedTime}),"ALLOW")});
test("routing preserves human decision authority",()=>{const plan=createRoutingPlan({routeId:"r1",questionHash:"q",mentors:[mentorRegistry[0]],evidenceScope:["s1"],policyVersion:"v0.1"});assert.equal(plan.humanDecisionRequired,true);assert.deepEqual(plan.selectedMentorIds,["M01"])});
test("published knowledge requires monotone semantic version evolution",()=>{const k:KnowledgeObject={id:"k1",title:"x",type:"NOTE",summary:"",version:"1.2.3",status:"PUBLISHED",provenance:"VERIFIED",sourceRefs:[],relationIds:[],updatedAt:"2026-09-30T00:00:00Z"};assert.equal(canReplacePublished(k,{...k}),false);assert.equal(canReplacePublished(k,{...k,version:"1.2.4"}),true);assert.equal(canReplacePublished(k,{...k,version:"1.1.9"}),false);assert.equal(canReplacePublished(k,{...k,version:"banana"}),false);assert.equal(canReplacePublished(k,{...k,id:"k2",version:"2.0.0"}),false)});
test("audit append preserves previous ledger",()=>{const ledger:readonly AuditEvent[]=[];const event:AuditEvent={eventId:"e1",actor:"u1",action:"read",object:"k1",objectVersion:"1",timestamp:"2026-09-30T00:00:00Z",requestId:"r1",authorizationContext:"USER",outcome:"SUCCESS",provenanceRefs:["s1"]};const next=appendAudit(ledger,event);assert.equal(ledger.length,0);assert.equal(next.length,1);assert.equal(Object.isFrozen(next),true)});
