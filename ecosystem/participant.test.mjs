import test from 'node:test';
import assert from 'node:assert/strict';
import {REPOSITORY,exportDocument,readDocument} from './participant.mjs';
test('participant preserves its source and cannot export another repository identity',async()=>{
 const ref={repository:REPOSITORY,commitSha:'b'.repeat(40),path:'README.md'};
 const doc={documentId:'participant-fixture',title:'Fixture',content:'Synthetic participant fixture.',status:'draft'};
 const data=await readDocument(await exportDocument(doc,ref));
 assert.equal(data.reference.repository,REPOSITORY);assert.deepEqual(data.document,doc);
 assert.equal(data.boundary.sourceVerified,false);
 await assert.rejects(exportDocument(doc,{...ref,repository:'attacker/project'}));
});

import {knowledgeDraft} from './participant.mjs';
test('knowledge import needs local case context and never promotes source verification',async()=>{
 const bytes=await exportDocument({documentId:'knowledge-fixture',title:'Title',content:'Synthetic knowledge.',status:'specificatie'},
 {repository:REPOSITORY,commitSha:'b'.repeat(40),path:'README.md'});
 await assert.rejects(knowledgeDraft(bytes),/LOCAL_CASE_CONTEXT_REQUIRED/);
 const result=await knowledgeDraft(bytes,{caseId:'local-case',createdAt:'2026-10-19T00:00:00.000Z'});
 assert.equal(result.knowledge.status,'CONCEPT');assert.equal(result.knowledge.sources[0].provenance,'UNKNOWN');
 assert.equal(result.knowledge.caseId,'local-case');assert.equal(result.sourceMetadata.verified,false);
 assert.equal(result.sourceMetadata.status,'specificatie');assert.ok(Object.isFrozen(result.knowledge.sources));
});
