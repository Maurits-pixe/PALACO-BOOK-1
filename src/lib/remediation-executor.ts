import type Database from "better-sqlite3";
import { database } from "./sqlite";
import { requireAuthorization } from "./authorization";
import type { ActorContext } from "./actor";
import { evolveKnowledge } from "./knowledge-history";
import { evolveKnowledgeRelation } from "./knowledge-graph";
import {
  appendConsumedExecutionEnvelope,
  assertExecutionEnvelopeConsumable
} from "./execution-envelope";

export function consumeExecutionEnvelope(
  envelopeId:string,
  actor:ActorContext,
  db:Database.Database=database(),
  at:Date=new Date()
){
  requireAuthorization(actor.role,"REMEDIATION_EXECUTE");

  return db.transaction(()=>{
    const envelope=assertExecutionEnvelopeConsumable(envelopeId,at,db);

    const mutation=envelope.operationType==="KNOWLEDGE_EVOLUTION"
      ? evolveKnowledge((envelope.payload as {next:unknown}).next,actor,db)
      : evolveKnowledgeRelation({relationId:envelope.targetId,...envelope.payload},actor,db);

    const consumed=appendConsumedExecutionEnvelope(envelope,actor,at,db);

    return {
      envelope:consumed,
      mutation,
      executionPerformed:true as const,
      reviewSignalResolutionPerformed:false as const
    };
  })();
}
