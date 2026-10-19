import {encodeDocument,decodeDocument} from './document-exchange.mjs';
export const REPOSITORY = "Maurits-pixe/PALACO-BOOK-1";
export async function exportDocument(document, reference) {
  if (reference?.repository !== REPOSITORY) throw new Error('SOURCE_REPOSITORY_MISMATCH');
  return encodeDocument(reference, document);
}
export const readDocument = decodeDocument;

// This data adapter never writes a repository or bypasses the application's actor/role gate.
export async function knowledgeDraft(input,{caseId,createdAt}={}) {
  if(typeof caseId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(caseId)
    ||typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt))
    ||new Date(createdAt).toISOString()!==createdAt) throw new Error('LOCAL_CASE_CONTEXT_REQUIRED');
  const packet=await readDocument(input),d=packet.document;
  return Object.freeze({knowledge:Object.freeze({id:d.documentId,caseId,title:d.title,content:d.content,
    status:'CONCEPT',version:1,sources:Object.freeze([Object.freeze({sourceId:packet.origin,version:1,provenance:'UNKNOWN'})]),createdAt}),
    sourceMetadata:Object.freeze({origin:packet.origin,status:d.status,statusProvidedBy:'USER',verified:false})});
}
