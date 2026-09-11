import { normalizeCustomerText } from "./normalize.ts";
import {
  translateTrainingMessageWithModel,
  type ModelCredentials,
  type TrainingCatalogItem,
  type TrainingExample,
  type TrainingTranslation,
} from "./llm.ts";

export type TrainingMessage={
  customerAccountId:string;
  conversationId:string;
  messageId:string;
  body:string;
};

export type TrainingSavedExample={
  customerAccountId:string;
  conversationId:string;
  sourceMessageId:string;
  rawText:string;
  productName:string;
  productCode:string|null;
  quantity:number|null;
  unitHint:string|null;
  status:"auto"|"corrected";
  confidence:number;
};

export type TrainingDeps={
  loadCatalog(customerAccountId:string,body:string):Promise<TrainingCatalogItem[]>;
  loadExamples(customerAccountId:string,body:string):Promise<TrainingExample[]>;
  translate(input:{customerText:string;catalog:TrainingCatalogItem[];learnedExamples:TrainingExample[]}):Promise<TrainingTranslation>;
  saveExample(example:TrainingSavedExample):Promise<unknown>;
};

export type TrainingResult={reply:string;translation:TrainingTranslation;learned:TrainingSavedExample[]};

function clean(value:unknown):string{return String(value??"").replace(/\s+/g," ").trim();}
function qty(value:number):string{return Number.isInteger(value)?String(value):String(Math.round(value*100)/100);}
function itemReply(item:{productName:string;quantity:number;unitHint:string|null}):string{
  const unit=clean(item.unitHint);
  return `${clean(item.productName)} × ${qty(item.quantity)}${unit?` ${unit}`:""}`;
}

export async function processTrainingMessage(message:TrainingMessage,deps:TrainingDeps):Promise<TrainingResult>{
  const catalog=await deps.loadCatalog(message.customerAccountId,message.body);
  const learnedExamples=await deps.loadExamples(message.customerAccountId,message.body);
  const translation=await deps.translate({customerText:message.body,catalog,learnedExamples});
  const learned:TrainingSavedExample[]=[];

  if(translation.kind==="order"){
    for(const item of translation.items){
      const example:TrainingSavedExample={
        customerAccountId:message.customerAccountId,
        conversationId:message.conversationId,
        sourceMessageId:message.messageId,
        rawText:item.rawText,
        productName:item.productName,
        productCode:item.productCode,
        quantity:item.quantity,
        unitHint:item.unitHint,
        status:"auto",
        confidence:item.confidence,
      };
      await deps.saveExample(example);
      learned.push(example);
    }
    return {reply:translation.items.map(itemReply).join("\n"),translation,learned};
  }

  if(translation.kind==="teaching"){
    for(const teaching of translation.teachings){
      const example:TrainingSavedExample={
        customerAccountId:message.customerAccountId,
        conversationId:message.conversationId,
        sourceMessageId:message.messageId,
        rawText:teaching.rawText,
        productName:teaching.productName,
        productCode:teaching.productCode,
        quantity:null,
        unitHint:null,
        status:"corrected",
        confidence:1,
      };
      await deps.saveExample(example);
      learned.push(example);
    }
    const reply=translation.teachings.map(row=>`${clean(row.rawText)} → ${clean(row.productName)}`).join("\n");
    return {reply:reply||clean(translation.replyText),translation,learned};
  }

  return {reply:clean(translation.replyText),translation,learned};
}

export async function loadTrainingCatalog(db:any):Promise<TrainingCatalogItem[]>{
  const {data,error}=await db.from("getlink_supplier_products")
    .select("product_code,product_name,is_active,stock_status")
    .eq("is_active",true)
    .order("product_code",{ascending:true})
    .range(0,599);
  if(error)throw error;
  return (Array.isArray(data)?data:[])
    .filter((row:any)=>row?.product_code&&row?.product_name&&String(row?.stock_status||"")!=="inactive")
    .map((row:any)=>({productCode:String(row.product_code),productName:String(row.product_name)}));
}

export async function loadTrainingExamples(db:any,customerAccountId:string,conversationId:string):Promise<TrainingExample[]>{
  const {data,error}=await db.from("getlink_ai_training_examples")
    .select("raw_text,product_name,product_code,quantity,unit_hint,status,updated_at")
    .eq("customer_account_id",customerAccountId)
    .eq("conversation_id",conversationId)
    .neq("status","rejected")
    .order("updated_at",{ascending:false})
    .limit(80);
  if(error)throw error;
  return (Array.isArray(data)?data:[]).map((row:any)=>({
    rawText:String(row.raw_text||""),
    productName:String(row.product_name||""),
    productCode:row.product_code?String(row.product_code):null,
    quantity:row.quantity==null?null:Number(row.quantity),
    unitHint:row.unit_hint?String(row.unit_hint):null,
    status:String(row.status||"auto"),
  })).filter((row:TrainingExample)=>Boolean(row.rawText&&row.productName));
}

export async function saveTrainingExample(db:any,example:TrainingSavedExample):Promise<any>{
  const rawNormalized=normalizeCustomerText(example.rawText);
  if(!rawNormalized||!clean(example.productName))return null;
  const {data:existing,error:readError}=await db.from("getlink_ai_training_examples")
    .select("id,status")
    .eq("customer_account_id",example.customerAccountId)
    .eq("conversation_id",example.conversationId)
    .eq("raw_normalized",rawNormalized)
    .maybeSingle();
  if(readError)throw readError;
  if(existing?.id&&String(existing.status)==="corrected"&&example.status==="auto")return existing;
  const row={
    customer_account_id:example.customerAccountId,
    conversation_id:example.conversationId,
    source_message_id:example.sourceMessageId||null,
    raw_text:clean(example.rawText),
    raw_normalized:rawNormalized,
    product_name:clean(example.productName),
    product_code:example.productCode||null,
    quantity:example.quantity,
    unit_hint:example.unitHint||null,
    status:example.status,
    confidence:Math.max(0,Math.min(1,Number(example.confidence)||0)),
    updated_at:new Date().toISOString(),
  };
  const {data,error}=await db.from("getlink_ai_training_examples")
    .upsert(row,{onConflict:"customer_account_id,conversation_id,raw_normalized"})
    .select("*")
    .single();
  if(error)throw error;
  return data;
}

export async function processDbTrainingMessage(
  db:any,
  message:TrainingMessage,
  modelCredentials?:Partial<ModelCredentials>|null,
  fetchImpl:typeof fetch=fetch,
):Promise<TrainingResult>{
  return await processTrainingMessage(message,{
    loadCatalog:async()=>await loadTrainingCatalog(db),
    loadExamples:async()=>await loadTrainingExamples(db,message.customerAccountId,message.conversationId),
    translate:async(input)=>await translateTrainingMessageWithModel(input,fetchImpl,modelCredentials),
    saveExample:async(example)=>await saveTrainingExample(db,example),
  });
}
