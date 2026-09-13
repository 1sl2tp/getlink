import { normalizeCustomerText } from "./normalize.ts";
import { STORE_ALIAS_PROMOTION_CUSTOMERS } from "./matcher.ts";

export type LearningEvidence={
  customerAccountId:string;
  conversationId:string;
  sessionId?:string|null;
  sourceMessageId?:string|null;
  rawPhrase:string;
  productCode:string;
};

function clean(value:unknown){return String(value??"").replace(/\s+/g," ").trim();}

export async function recordConfirmation(db:any,evidence:LearningEvidence){
  const aliasNormalized=normalizeCustomerText(evidence.rawPhrase);
  if(!aliasNormalized||!clean(evidence.productCode))return null;
  const {data:existing,error:readError}=await db.from("getlink_ai_product_aliases")
    .select("id,product_code,confirm_count,correction_count,confidence")
    .eq("scope","customer")
    .eq("customer_account_id",evidence.customerAccountId)
    .eq("alias_normalized",aliasNormalized)
    .maybeSingle();
  if(readError)throw readError;
  if(existing?.id){
    if(String(existing.product_code)!==String(evidence.productCode)){
      return recordCorrection(db,{...evidence,priorProductCode:String(existing.product_code),correctionSource:"customer_confirmation"});
    }
    const confirmCount=(Number(existing.confirm_count)||0)+1;
    const confidence=Math.min(1,Math.max(Number(existing.confidence)||0.5,0.7)+0.05);
    const {data,error}=await db.from("getlink_ai_product_aliases")
      .update({confirm_count:confirmCount,confidence,last_used_at:new Date().toISOString(),updated_at:new Date().toISOString()})
      .eq("id",existing.id)
      .select("*")
      .single();
    if(error)throw error;
    return data;
  }
  const {data,error}=await db.from("getlink_ai_product_aliases").insert({
    scope:"customer",
    customer_account_id:evidence.customerAccountId,
    product_code:evidence.productCode,
    alias_display:clean(evidence.rawPhrase),
    alias_normalized:aliasNormalized,
    confidence:0.75,
    confirm_count:1,
    correction_count:0,
    last_used_at:new Date().toISOString(),
  }).select("*").single();
  if(error)throw error;
  return data;
}

export async function recordCorrection(
  db:any,
  evidence:LearningEvidence&{priorProductCode?:string|null;correctionSource:"customer_confirmation"|"admin_edit"|"clarification"},
){
  const aliasNormalized=normalizeCustomerText(evidence.rawPhrase);
  if(!aliasNormalized||!clean(evidence.productCode))return null;
  const now=new Date().toISOString();
  const {error:auditError}=await db.from("getlink_ai_corrections").insert({
    customer_account_id:evidence.customerAccountId,
    conversation_id:evidence.conversationId,
    session_id:evidence.sessionId||null,
    source_message_id:evidence.sourceMessageId||null,
    raw_customer_phrase:clean(evidence.rawPhrase),
    prior_product_code:evidence.priorProductCode||null,
    corrected_product_code:evidence.productCode,
    correction_source:evidence.correctionSource,
  });
  if(auditError)throw auditError;

  const {data:existing,error:readError}=await db.from("getlink_ai_product_aliases")
    .select("id,correction_count")
    .eq("scope","customer")
    .eq("customer_account_id",evidence.customerAccountId)
    .eq("alias_normalized",aliasNormalized)
    .maybeSingle();
  if(readError)throw readError;
  if(existing?.id){
    const {data,error}=await db.from("getlink_ai_product_aliases").update({
      product_code:evidence.productCode,
      alias_display:clean(evidence.rawPhrase),
      confidence:0.98,
      confirm_count:1,
      correction_count:(Number(existing.correction_count)||0)+1,
      last_used_at:now,
      updated_at:now,
    }).eq("id",existing.id).select("*").single();
    if(error)throw error;
    return data;
  }
  const {data,error}=await db.from("getlink_ai_product_aliases").insert({
    scope:"customer",customer_account_id:evidence.customerAccountId,product_code:evidence.productCode,
    alias_display:clean(evidence.rawPhrase),alias_normalized:aliasNormalized,confidence:0.98,
    confirm_count:1,correction_count:1,last_used_at:now,
  }).select("*").single();
  if(error)throw error;
  return data;
}

export async function promoteEligibleStoreAliases(db:any):Promise<number>{
  const {data,error}=await db.rpc("getlink_ai_promote_aliases");
  if(error)throw error;
  return Math.max(0,Number(data)||0);
}

export function aliasPromotionThreshold(){return STORE_ALIAS_PROMOTION_CUSTOMERS;}
