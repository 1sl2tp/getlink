import { parseFastCommand } from "./rules.ts";
import { parseWithModel, type ModelCredentials } from "./llm.ts";
import { resolveProduct } from "./matcher.ts";
import { buildCommercialFacts, marketComparison } from "./commerce.ts";
import { processTurn } from "./session.ts";
import { createSessionRepository } from "./repository.ts";
import { composeReply } from "./reply.ts";
import { enqueueReply, flushReply } from "./chat.ts";
import { recordConfirmation, promoteEligibleStoreAliases } from "./learning.ts";
import type { ClaimedInboxRow, OrderAgentMode } from "./runtime.ts";

function clean(value:unknown){return String(value??"").replace(/\s+/g," ").trim();}
function errorCode(error:unknown){return error instanceof Error?error.message:String(error||"unknown_error");}

async function commercialFactsWithMarket(db:any,productCode:string,quantity:number){
  const facts=await buildCommercialFacts(db,productCode,quantity);
  const {data:hint,error:hError}=await db.from("getlink_ai_product_hints")
    .select("market_reference_source,market_reference_key,equivalence_key")
    .eq("product_code",productCode).maybeSingle();
  if(hError)throw hError;
  if(!hint?.market_reference_key||!hint?.equivalence_key||facts.unitPriceVnd<=0)return facts;

  const {data:reference,error:rError}=await db.from("getlink_link_comparison")
    .select("regular_pack_price,promo_pack_price,promotion_active,updated_at")
    .eq("link_url",hint.market_reference_key).maybeSingle();
  if(rError)throw rError;
  if(!reference)return facts;
  const referencePrice=reference.promotion_active&&Number(reference.promo_pack_price)>0
    ?Number(reference.promo_pack_price)
    :Number(reference.regular_pack_price);
  const comparison=marketComparison(
    {productCode,priceVnd:facts.unitPriceVnd,equivalenceKey:String(hint.equivalence_key)},
    {priceVnd:referencePrice,equivalenceKey:String(hint.equivalence_key),checkedAt:reference.updated_at},
  );
  return comparison?{...facts,marketComparison:comparison,marketSource:hint.market_reference_source||null}:facts;
}

function claimedTurn(rows:ClaimedInboxRow[]){
  const first=rows[0];
  return {
    turnKey:String(first.turn_key),
    conversationId:String(first.conversation_id),
    customerAccountId:String(first.customer_account_id),
    messages:rows.map(row=>({id:String(row.message_id),body:String(row.message_body),createdAt:String(row.message_created_at)})),
  };
}

async function audit(repo:any,mode:OrderAgentMode,rows:ClaimedInboxRow[],extra:Record<string,unknown>={}){
  if(!rows.length)return;
  const first=rows[0];
  await repo.auditTurn({
    turn_key:first.turn_key,
    conversation_id:first.conversation_id,
    customer_account_id:first.customer_account_id,
    source_message_ids:rows.map(row=>row.message_id),
    mode,
    ...extra,
  });
}

export async function processShadowRows(
  db:any,
  rows:ClaimedInboxRow[],
  modelCredentials?:Partial<ModelCredentials>|null,
):Promise<void>{
  if(!rows.length)return;
  const repo=createSessionRepository(db);
  let lastParsed:any=null;
  let selectedProductCode:string|null=null;
  let resolutionSource:string|null=null;
  let failure:string|null=null;
  try{
    for(const row of rows){
      let parsed=parseFastCommand(row.message_body);
      if(!parsed)parsed=await parseWithModel({customerText:row.message_body},fetch,modelCredentials);
      lastParsed=parsed;
      if(parsed&&["add_item","change_qty","remove_item","price_query"].includes(parsed.intent)&&parsed.raw_product_text){
        const resolution=await resolveProduct(db,row.customer_account_id,parsed.raw_product_text);
        if(resolution){selectedProductCode=resolution.productCode;resolutionSource=resolution.source;}
      }
    }
    await audit(repo,"shadow",rows,{
      parsed_intent:lastParsed,
      selected_product_code:selectedProductCode,
      resolution_source:resolutionSource,
      result_kind:lastParsed?.intent||"ignore",
    });
    await repo.markRowsProcessed(rows);
  }catch(error){
    failure=errorCode(error);
    await audit(repo,"shadow",rows,{parsed_intent:lastParsed,error_code:failure,result_kind:"error"});
    await repo.markRowsFailed(rows,failure);
  }
}

async function learnConfirmedLines(db:any,turn:any,lines:any[]){
  for(const line of lines||[]){
    const phrase=clean(line.customerRawText);
    if(!phrase||!line.productCode)continue;
    await recordConfirmation(db,{
      customerAccountId:turn.customerAccountId,
      conversationId:turn.conversationId,
      sessionId:line.sessionId||null,
      sourceMessageId:line.sourceMessageId||null,
      rawPhrase:phrase,
      productCode:String(line.productCode),
    });
  }
  await promoteEligibleStoreAliases(db);
}

export async function processLiveRows(
  db:any,
  rows:ClaimedInboxRow[],
  mode:"pilot"|"on",
  modelCredentials?:Partial<ModelCredentials>|null,
):Promise<void>{
  if(!rows.length)return;
  const repo=createSessionRepository(db);
  const turn=claimedTurn(rows);
  let result:any=null;
  let mainOutbox:any=null;
  let followOutbox:any=null;
  try{
    result=await processTurn(repo,turn,{
      parseWithModel:(input)=>parseWithModel(input,fetch,modelCredentials),
      resolveProduct:(customerId:string,rawText:string)=>resolveProduct(db,customerId,rawText),
      commercialFacts:(productCode:string,quantity:number)=>commercialFactsWithMarket(db,productCode,quantity),
    });

    if(result.kind==="confirmation")await learnConfirmedLines(db,turn,result.lines||[]);

    if(result.kind!=="ignore"){
      const reply=composeReply(result);
      mainOutbox=await enqueueReply(db,result.sessionId,turn.turnKey,reply.replyKind,reply.body);
      if(reply.followUp){
        followOutbox=await enqueueReply(db,result.sessionId,turn.turnKey,reply.followUp.replyKind,reply.followUp.body);
      }
    }

    await audit(repo,mode,rows,{
      result_kind:result.kind,
      commercial_facts:result.facts||null,
      reply_outbox_id:mainOutbox?.id||null,
    });
    await repo.markRowsProcessed(rows);

    if(mainOutbox){
      try{await flushReply(db,mainOutbox);}catch{/* recovery sweep owns retry */}
    }
    if(followOutbox){
      try{await flushReply(db,followOutbox);}catch{/* recovery sweep owns retry */}
    }
  }catch(error){
    const code=errorCode(error);
    try{await audit(repo,mode,rows,{result_kind:result?.kind||"error",error_code:code,reply_outbox_id:mainOutbox?.id||null});}catch{/* preserve primary error */}
    await repo.markRowsFailed(rows,code);
  }
}

export async function claimTurn(db:any,conversationId:string):Promise<ClaimedInboxRow[]>{
  const {data,error}=await db.rpc("getlink_ai_claim_turn",{p_conversation_id:conversationId});
  if(error)throw error;
  return Array.isArray(data)?data as ClaimedInboxRow[]:[];
}

export async function recoverySweep(
  db:any,
  mode:OrderAgentMode,
  pilotCustomerIds:Set<string>,
  modelCredentials?:Partial<ModelCredentials>|null,
):Promise<{claimed:number;flushed:number}>{
  if(mode==="off")return {claimed:0,flushed:0};
  let claimed=0;
  let flushed=0;
  const {data:pending,error:pError}=await db.rpc("getlink_ai_pending_dispatches",{p_limit:100});
  if(pError)throw pError;
  const conversations:string[]=[...new Set<string>((pending||[])
    .map((row:any)=>String(row.conversation_id||""))
    .filter((value:string)=>value.length>0))];
  for(const conversationId of conversations){
    const rows=await claimTurn(db,conversationId);
    if(!rows.length)continue;
    claimed+=rows.length;
    const customerId=String(rows[0].customer_account_id||"");
    if(mode==="shadow")await processShadowRows(db,rows,modelCredentials);
    else if(mode==="on"||(mode==="pilot"&&pilotCustomerIds.has(customerId)))await processLiveRows(db,rows,mode as "pilot"|"on",modelCredentials);
    else{
      const repo=createSessionRepository(db);
      await repo.markRowsProcessed(rows);
    }
  }

  if(mode==="pilot"||mode==="on"){
    const {data:outbox,error:oError}=await db.from("getlink_ai_reply_outbox")
      .select("*").in("status",["pending","failed"]).order("created_at",{ascending:true}).limit(100);
    if(oError)throw oError;
    for(const row of outbox||[]){
      try{await flushReply(db,row);flushed+=1;}catch{/* next sweep retries */}
    }
  }
  return {claimed,flushed};
}
