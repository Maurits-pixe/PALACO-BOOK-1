import {describe,expect,it} from "vitest";
import {authorize} from "./authorization";
import {mentorRegistry} from "./mentors";
import {createRoutingPlan} from "./routing";
import {canReplacePublished,type KnowledgeObject} from "./knowledge";
import {appendAudit,type AuditEvent} from "./audit";

describe("constitutional runtime contracts",()=>{
 it("registers exactly 16 permanent and 8 freelance mentor slots",()=>{expect(mentorRegistry).toHaveLength(24);expect(mentorRegistry.filter(m=>m.kind==="PERMANENT")).toHaveLength(16);expect(mentorRegistry.filter(m=>m.kind==="FREELANCE")).toHaveLength(8)});
 it("denies external side effects without explicit authorization",()=>{expect(authorize({role:"OWNER",action:"external:publish",resource:"report"})).toBe("DENY");expect(authorize({role:"OWNER",action:"external:publish",resource:"report",explicitExternalAuthorization:true})).toBe("ALLOW")});
 it("defaults non-owner mutations to deny",()=>{expect(authorize({role:"EDITOR",action:"write",resource:"knowledge"})).toBe("DENY");expect(authorize({role:"USER",action:"read",resource:"knowledge"})).toBe("ALLOW")});
 it("keeps human decision authority explicit in routing",()=>{const plan=createRoutingPlan({routeId:"r1",questionHash:"q",mentors:[mentorRegistry[0]],evidenceScope:["s1"],policyVersion:"v0.1"});expect(plan.humanDecisionRequired).toBe(true);expect(plan.selectedMentorIds).toEqual(["M01"])});
 it("requires a version change before replacing published knowledge",()=>{const k:KnowledgeObject={id:"k1",title:"x",type:"NOTE",summary:"",version:"1.0.0",status:"PUBLISHED",provenance:"VERIFIED",sourceRefs:[],relationIds:[],updatedAt:"2026-09-30T00:00:00Z"};expect(canReplacePublished(k,{...k})).toBe(false);expect(canReplacePublished(k,{...k,version:"1.0.1"})).toBe(true)});
 it("appends audit evidence without mutating the previous ledger",()=>{const ledger:readonly AuditEvent[]=[];const event:AuditEvent={eventId:"e1",actor:"u1",action:"read",object:"k1",objectVersion:"1",timestamp:"2026-09-30T00:00:00Z",requestId:"r1",authorizationContext:"USER",outcome:"SUCCESS",provenanceRefs:["s1"]};const next=appendAudit(ledger,event);expect(ledger).toHaveLength(0);expect(next).toHaveLength(1);expect(Object.isFrozen(next)).toBe(true)});
});
