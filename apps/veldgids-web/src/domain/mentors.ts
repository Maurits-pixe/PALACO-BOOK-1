export type MentorClass="PERMANENT"|"FREELANCE";
export interface MentorSlot{id:string;kind:MentorClass;domain:string;modelBinding?:{provider:string;modelId:string;effectiveAt:string;evaluationStatus:string}}
const permanent=["Psychology","Neuroscience","Philosophy","Communication","Relationships","Learning & Education","Health & Lifestyle","Ethics","Creativity","Strategy","Leadership","Science","History & Culture","Spirituality & Meaning","Innovation & Technology","Synthesis & Integration"];
const freelance=["Frontier Psychology","Frontier Neuroscience","Frontier Clinical Evidence","Frontier Research","Frontier AI & Cognition","Frontier Behavioral Science","Frontier Ethics & Safety","Frontier Synthesis / Red Team"];
export const mentorRegistry:MentorSlot[]=[...permanent.map((domain,i)=>({id:`M${String(i+1).padStart(2,"0")}`,kind:"PERMANENT" as const,domain})),...freelance.map((domain,i)=>({id:`F${String(i+1).padStart(2,"0")}`,kind:"FREELANCE" as const,domain}))];
