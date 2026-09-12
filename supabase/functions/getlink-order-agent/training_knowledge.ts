import { normalizeCustomerText } from "./normalize.ts";
import type { TrainingKnowledgeRule } from "./training_llm.ts";

const clean=(value:unknown)=>String(value??"").replace(/\s+/g," ").trim();
const normalize=(value:unknown)=>normalizeCustomerText(value);

export async function loadKnowledgeRules(db:any,customerAccountId:string):Promise<TrainingKnowledgeRule[]>{
  const result=await db.from("getlink_ai_knowledge_rules")
    .select("rule_type,rule_text")
    .eq("customer_account_id",customerAccountId)
    .eq("is_active",true)
    .order("updated_at",{ascending:false})
    .limit(120);
  if(result.error)throw result.error;
  return (result.data||[]).map((row:any)=>({
    ruleType:clean(row.rule_type),
    ruleText:clean(row.rule_text),
  })).filter((row:TrainingKnowledgeRule)=>row.ruleType&&row.ruleText);
}

export async function saveKnowledgeRules(
  db:any,
  input:{customerAccountId:string;sourceMessageId:string;rules:TrainingKnowledgeRule[]},
):Promise<number>{
  const seen=new Set<string>();
  const rows=[] as any[];
  for(const rule of input.rules||[]){
    const ruleText=clean(rule.ruleText);
    const ruleType=clean(rule.ruleType).toLowerCase();
    const ruleNormalized=normalize(ruleText);
    if(!ruleText||!ruleType||!ruleNormalized||seen.has(ruleNormalized))continue;
    seen.add(ruleNormalized);
    rows.push({
      customer_account_id:input.customerAccountId,
      rule_type:ruleType,
      rule_text:ruleText,
      rule_normalized:ruleNormalized,
      source_message_id:input.sourceMessageId,
      is_active:true,
      updated_at:new Date().toISOString(),
    });
  }
  if(!rows.length)return 0;
  const result=await db.from("getlink_ai_knowledge_rules").upsert(rows,{onConflict:"customer_account_id,rule_normalized"});
  if(result.error)throw result.error;
  return rows.length;
}
