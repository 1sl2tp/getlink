import { normalizeCustomerText } from "./normalize.ts";
import {
  translateTrainingMessageWithModel,
  type ModelCredentials,
  type TrainingCatalogItem,
  type TrainingExample,
  type TrainingTranslation,
} from "./llm.ts";

export type TrainingMessage={customerAccountId:string;conversationId:string;messageId:string;body:string;};

export type TrainingSavedExample={
  customerAccountId:string;conversationId:string;sourceMessageId:string;rawText:string;
  productName:string;productCode:string|null;quantity:number|null;unitHint:string|null;
  status:"auto"|"corrected";confidence:number;
};

export type TrainingPendingConfirmation={
  rawText:string;productName:string;productCode:string;quantity:number;unitHint:string|null;
};

export type TrainingDeps={
  loadCatalog(customerAccountId:string,body:string):Promise<TrainingCatalogItem[]>;
  loadExamples(customerAccountId:string,body:string):Promise<TrainingExample[]>;
  translate(input:{customerText:string;catalog:TrainingCatalogItem[];learnedExamples:TrainingExample[]}):Promise<TrainingTranslation>;
  saveExample(example:TrainingSavedExample):Promise<unknown>;
};

export type TrainingResult={
  reply:string;translation:TrainingTranslation;learned:TrainingSavedExample[];
  pendingConfirmation:TrainingPendingConfirmation|null;
};

function clean(value:unknown):string{return String(value??"").replace(/\s+/g," ").trim();}
function qty(value:number):string{return Number.isInteger(value)?String(value):String(Math.round(value*100)/100);}
function itemReply(item:{productName:string;quantity:number;unitHint:string|null}):string{
  const unit=clean(item.unitHint);
  return `${clean(item.productName)} × ${qty(item.quantity)}${unit?` ${unit}`:""}`;
}
function exactKey(value:unknown):string{return normalizeCustomerText(value).replace(/\s+/g," ").trim();}
function compactKey(value:unknown):string{return exactKey(value).replace(/[^a-z0-9]+/g,"");}

function levenshtein(a:string,b:string):number{
  if(a===b)return 0;
  if(!a.length)return b.length;
  if(!b.length)return a.length;
  const prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let left=i;let diagonal=prev[0];prev[0]=i;
    for(let j=1;j<=b.length;j++){
      const above=prev[j];
      const next=Math.min(above+1,left+1,diagonal+(a[i-1]===b[j-1]?0:1));
      diagonal=above;prev[j]=next;left=next;
    }
  }
  return prev[b.length];
}

function exactCatalogProduct(catalog:TrainingCatalogItem[],name:string):TrainingCatalogItem|null{
  const key=exactKey(name);
  if(!key)return null;
  const matches=catalog.filter(row=>exactKey(row.productName)===key);
  return matches.length===1?matches[0]:null;
}

function similarCatalogProduct(catalog:TrainingCatalogItem[],name:string):TrainingCatalogItem|null{
  const q=compactKey(name);
  if(q.length<4)return null;
  const scored=catalog.map(row=>{
    const key=compactKey(row.productName);
    const distance=levenshtein(q,key);
    const ratio=distance/Math.max(q.length,key.length,1);
    return {row,distance,ratio};
  }).filter(x=>x.distance<=1||x.ratio<=0.18)
    .sort((a,b)=>a.ratio-b.ratio||a.distance-b.distance||a.row.productName.localeCompare(b.row.productName,"vi"));
  if(!scored.length)return null;
  if(scored.length>1&&Math.abs(scored[1].ratio-scored[0].ratio)<0.05)return null;
  return scored[0].row;
}

function savedExample(message:TrainingMessage,item:{rawText:string;productName:string;productCode:string|null;quantity:number|null;unitHint:string|null;confidence:number},status:"auto"|"corrected"):TrainingSavedExample{
  return {
    customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,
    rawText:item.rawText,productName:item.productName,productCode:item.productCode,quantity:item.quantity,unitHint:item.unitHint,
    status,confidence:status==="corrected"?1:item.confidence,
  };
}

export async function processTrainingMessage(message:TrainingMessage,deps:TrainingDeps):Promise<TrainingResult>{
  const learnedExamples=await deps.loadExamples(message.customerAccountId,message.body);
  const translation=await deps.translate({customerText:message.body,catalog:[],learnedExamples});
  const learned:TrainingSavedExample[]=[];
  let pendingConfirmation:TrainingPendingConfirmation|null=null;

  if(translation.kind==="conversation")return {reply:clean(translation.replyText),translation,learned,pendingConfirmation};

  const catalog=await deps.loadCatalog(message.customerAccountId,message.body);

  if(translation.kind==="order"){
    const replies:string[]=[];
    for(const item of translation.items){
      const exact=exactCatalogProduct(catalog,item.productName);
      if(exact){
        const canonical={...item,productName:exact.productName,productCode:exact.productCode};
        const example=savedExample(message,canonical,"auto");
        await deps.saveExample(example);learned.push(example);replies.push(itemReply(canonical));
        continue;
      }

      const similar=similarCatalogProduct(catalog,item.productName);
      if(similar&&!pendingConfirmation){
        pendingConfirmation={rawText:item.rawText,productName:similar.productName,productCode:similar.productCode,quantity:item.quantity,unitHint:item.unitHint};
        replies.push(`Có phải ${itemReply(pendingConfirmation)} không?\n1. Đúng\n2. Sai / bỏ qua`);
        continue;
      }

      const example=savedExample(message,{...item,productCode:null},"auto");
      await deps.saveExample(example);learned.push(example);replies.push(itemReply(item));
    }
    return {reply:replies.join("\n"),translation,learned,pendingConfirmation};
  }

  for(const teaching of translation.teachings){
    const exact=exactCatalogProduct(catalog,teaching.productName);
    const canonical={rawText:teaching.rawText,productName:exact?.productName||teaching.productName,productCode:exact?.productCode||null,quantity:null,unitHint:null,confidence:1};
    const example=savedExample(message,canonical,"corrected");
    await deps.saveExample(example);learned.push(example);
  }
  const reply=learned.map(row=>`${clean(row.rawText)} → ${clean(row.productName)}`).join("\n")||clean(translation.replyText);
  return {reply,translation,learned,pendingConfirmation};
}

export async function loadTrainingCatalog(db:any):Promise<TrainingCatalogItem[]>{
  const {data,error}=await db.from("getlink_supplier_products")
    .select("product_code,product_name,is_active,stock_status").eq("is_active",true).order("product_code",{ascending:true}).range(0,599);
  if(error)throw error;
  return (Array.isArray(data)?data:[])
    .filter((row:any)=>row?.product_code&&row?.product_name&&String(row?.stock_status||"")!=="inactive")
    .map((row:any)=>({productCode:String(row.product_code),productName:String(row.product_name)}));
}

export async function loadTrainingExamples(db:any,customerAccountId:string,conversationId:string):Promise<TrainingExample[]>{
  const {data,error}=await db.from("getlink_ai_training_examples")
    .select("raw_text,product_name,product_code,quantity,unit_hint,status,updated_at")
    .eq("customer_account_id",customerAccountId).eq("conversation_id",conversationId)
    .neq("status","rejected").order("updated_at",{ascending:false}).limit(80);
  if(error)throw error;
  return (Array.isArray(data)?data:[]).map((row:any)=>({
    rawText:String(row.raw_text||""),productName:String(row.product_name||""),productCode:row.product_code?String(row.product_code):null,
    quantity:row.quantity==null?null:Number(row.quantity),unitHint:row.unit_hint?String(row.unit_hint):null,status:String(row.status||"auto"),
  })).filter((row:TrainingExample)=>Boolean(row.rawText&&row.productName));
}

export async function saveTrainingExample(db:any,example:TrainingSavedExample):Promise<any>{
  const rawNormalized=normalizeCustomerText(example.rawText);
  if(!rawNormalized||!clean(example.productName))return null;
  const {data:existing,error:readError}=await db.from("getlink_ai_training_examples")
    .select("id,status").eq("customer_account_id",example.customerAccountId)
    .eq("conversation_id",example.conversationId).eq("raw_normalized",rawNormalized).maybeSingle();
  if(readError)throw readError;
  if(existing?.id&&String(existing.status)==="corrected"&&example.status==="auto")return existing;
  const row={
    customer_account_id:example.customerAccountId,conversation_id:example.conversationId,source_message_id:example.sourceMessageId||null,
    raw_text:clean(example.rawText),raw_normalized:rawNormalized,product_name:clean(example.productName),product_code:example.productCode||null,
    quantity:example.quantity,unit_hint:example.unitHint||null,status:example.status,
    confidence:Math.max(0,Math.min(1,Number(example.confidence)||0)),updated_at:new Date().toISOString(),
  };
  const {data,error}=await db.from("getlink_ai_training_examples")
    .upsert(row,{onConflict:"customer_account_id,conversation_id,raw_normalized"}).select("*").single();
  if(error)throw error;
  return data;
}

async function loadTrainingSession(db:any,conversationId:string):Promise<any|null>{
  const {data,error}=await db.from("getlink_ai_order_sessions")
    .select("id,awaiting_context").eq("conversation_id",conversationId)
    .in("state",["collecting","awaiting_clarification","quoted","confirmed"])
    .order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  return data||null;
}

async function setTrainingAwaitingContext(db:any,sessionId:string,context:Record<string,unknown>):Promise<void>{
  const {error}=await db.from("getlink_ai_order_sessions")
    .update({awaiting_context:context,updated_at:new Date().toISOString()}).eq("id",sessionId);
  if(error)throw error;
}

function pendingFromContext(value:any):TrainingPendingConfirmation|null{
  if(!value||value.kind!=="training_candidate")return null;
  const quantity=Number(value.quantity);
  if(!clean(value.rawText)||!clean(value.productName)||!clean(value.productCode)||!Number.isFinite(quantity)||quantity<=0)return null;
  return {rawText:clean(value.rawText),productName:clean(value.productName),productCode:clean(value.productCode),quantity,unitHint:value.unitHint?clean(value.unitHint):null};
}

export async function processDbTrainingMessage(db:any,message:TrainingMessage,modelCredentials?:Partial<ModelCredentials>|null,fetchImpl:typeof fetch=fetch):Promise<TrainingResult>{
  const session=await loadTrainingSession(db,message.conversationId);
  const pending=pendingFromContext(session?.awaiting_context);
  const decision=normalizeCustomerText(message.body);

  if(pending&&(decision==="1"||decision==="2")){
    await setTrainingAwaitingContext(db,String(session.id),{});
    if(decision==="2"){
      return {
        reply:"Đã bỏ qua.",
        translation:{kind:"conversation",items:[],teachings:[],replyText:"Đã bỏ qua."},
        learned:[],pendingConfirmation:null,
      };
    }
    const example:TrainingSavedExample={
      customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,
      rawText:pending.rawText,productName:pending.productName,productCode:pending.productCode,
      quantity:pending.quantity,unitHint:pending.unitHint,status:"corrected",confidence:1,
    };
    await saveTrainingExample(db,example);
    return {
      reply:itemReply(pending),
      translation:{kind:"teaching",items:[],teachings:[{rawText:pending.rawText,productName:pending.productName,productCode:pending.productCode}],replyText:""},
      learned:[example],pendingConfirmation:null,
    };
  }

  if(pending&&session?.id)await setTrainingAwaitingContext(db,String(session.id),{});

  const result=await processTrainingMessage(message,{
    loadCatalog:async()=>await loadTrainingCatalog(db),
    loadExamples:async()=>await loadTrainingExamples(db,message.customerAccountId,message.conversationId),
    translate:async(input)=>await translateTrainingMessageWithModel(input,fetchImpl,modelCredentials),
    saveExample:async(example)=>await saveTrainingExample(db,example),
  });

  if(result.pendingConfirmation&&session?.id){
    await setTrainingAwaitingContext(db,String(session.id),{
      kind:"training_candidate",
      rawText:result.pendingConfirmation.rawText,
      productName:result.pendingConfirmation.productName,
      productCode:result.pendingConfirmation.productCode,
      quantity:result.pendingConfirmation.quantity,
      unitHint:result.pendingConfirmation.unitHint,
    });
  }
  return result;
}
