import assert from "node:assert/strict";
import {test} from "node:test";
import Database from "better-sqlite3";
import {applyMigrations} from "../src/lib/sqlite";
import {createCaseKnowledgeTransaction} from "../src/lib/transaction";
import {evolveKnowledge} from "../src/lib/knowledge-history";
import {createKnowledgeRelation,evolveKnowledgeRelation,listKnowledgeRelationHistory,listKnowledgeRelations} from "../src/lib/knowledge-graph";
import type {ActorContext} from "../src/lib/actor";

const owner:ActorContext={actorId:"owner-1",role:"OWNER",authentication:"TEST"};

function seed(db:Database.Database,id:string,caseId:string,sourceId:string,title:string){
  const createdAt="2026-10-31T05:00:00.000Z";
  const knowledge={id,caseId,title,content:`${title} content`,status:"PUBLISHED" as const,version:1,sources:[{sourceId,version:1,provenance:"VERIFIED" as const}],createdAt};
  createCaseKnowledgeTransaction({
    case:{id:caseId,title:`${title} case`,objective:"Graph test",status:"ACTIVE",createdAt},
    knowledge,
    source:{id:sourceId,uri:`https://example.test/${sourceId}`,title:`${title} source`,version:1,checksum:`checksum-${sourceId}`,createdAt},
    provenance:{id:`prov-${sourceId}`,status:"VERIFIED",createdAt}
  },owner,db);
  return knowledge;
}

function fixture(){
  const db=new Database(":memory:");
  applyMigrations(db);
  const a=seed(db,"knowledge-a","case-a","source-a","A");
  const b=seed(db,"knowledge-b","case-b","source-b","B");
  return {db,a,b};
}

test("relation binds exact knowledge versions and remains stable when current state evolves",()=>{
  const {db,a,b}=fixture();
  createKnowledgeRelation({relationId:"rel-1",source:{knowledgeId:a.id,version:1},target:{knowledgeId:b.id,version:1},relationType:"supports",provenance:"VERIFIED",evidenceRefs:["source-a"]},owner,db);
  evolveKnowledge({...a,version:2,title:"A v2",createdAt:"2026-10-31T05:10:00.000Z"},owner,db);
  const [edge]=listKnowledgeRelations(a.id,db);
  assert.equal(edge?.source.version,1);
  assert.equal(edge?.target.version,1);
  assert.equal(edge?.relationType,"supports");
  db.close();
});

test("relation evolution is append-only and revocation is terminal",()=>{
  const {db,a,b}=fixture();
  createKnowledgeRelation({relationId:"rel-1",source:{knowledgeId:a.id,version:1},target:{knowledgeId:b.id,version:1},relationType:"contradicts",provenance:"TRACEABLE",evidenceRefs:["source-a","source-b"]},owner,db);
  evolveKnowledgeRelation({relationId:"rel-1",provenance:"REVOKED",evidenceRefs:["review-1"],status:"REVOKED"},owner,db);
  const history=listKnowledgeRelationHistory("rel-1",db);
  assert.deepEqual(history.map(x=>[x.version,x.status]),[[1,"ACTIVE"],[2,"REVOKED"]]);
  assert.equal(history[1]?.supersedesVersion,1);
  assert.throws(()=>evolveKnowledgeRelation({relationId:"rel-1",provenance:"VERIFIED",evidenceRefs:["review-2"],status:"ACTIVE"},owner,db),/RELATION_REVOKED_TERMINAL/);
  db.close();
});

test("relations reject missing versions, self-relations and unauthorized users",()=>{
  const {db,a,b}=fixture();
  assert.throws(()=>createKnowledgeRelation({relationId:"missing",source:{knowledgeId:a.id,version:99},target:{knowledgeId:b.id,version:1},relationType:"related_to",provenance:"PARTIAL",evidenceRefs:["e1"]},owner,db),/KNOWLEDGE_VERSION_NOT_FOUND/);
  assert.throws(()=>createKnowledgeRelation({relationId:"self",source:{knowledgeId:a.id,version:1},target:{knowledgeId:a.id,version:1},relationType:"related_to",provenance:"PARTIAL",evidenceRefs:["e1"]},owner,db),/SELF_RELATION_DENIED/);
  const user:ActorContext={actorId:"user-1",role:"USER",authentication:"TEST"};
  assert.throws(()=>createKnowledgeRelation({relationId:"denied",source:{knowledgeId:a.id,version:1},target:{knowledgeId:b.id,version:1},relationType:"supports",provenance:"VERIFIED",evidenceRefs:["e1"]},user,db),/AUTHORIZATION_DENIED/);
  db.close();
});

test("relation history cannot be updated or deleted",()=>{
  const {db,a,b}=fixture();
  createKnowledgeRelation({relationId:"rel-1",source:{knowledgeId:a.id,version:1},target:{knowledgeId:b.id,version:1},relationType:"explains",provenance:"VERIFIED",evidenceRefs:["e1"]},owner,db);
  assert.throws(()=>db.prepare("UPDATE knowledge_relations SET relation_type='related_to' WHERE relation_id='rel-1'").run(),/KNOWLEDGE_RELATION_APPEND_ONLY/);
  assert.throws(()=>db.prepare("DELETE FROM knowledge_relations WHERE relation_id='rel-1'").run(),/KNOWLEDGE_RELATION_APPEND_ONLY/);
  db.close();
});
