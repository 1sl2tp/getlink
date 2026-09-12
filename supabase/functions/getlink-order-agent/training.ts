import { normalizeCustomerText } from "./normalize.ts";
import { TrainingModelError,translateTrainingMessageWithModel,type ModelCredentials } from "./training_llm.ts";
import { fallbackKnowledgeRules,loadKnowledgeRules,saveKnowledgeRules } from "./training_knowledge.ts";
import {
  applyKnowledgeNaming,parseGroupedVariantOrder,parseSimpleOrderLine,parseSimpleOrderLines,rankTrainingCandidates,resolveTeachingEquation,resolveTrainingProduct,scopeCatalogByParent,
  type TrainingAlias,type TrainingCatalogItem,type TrainingKnowledgeLike,
} from "./training_resolver.ts";

const C=(v:unknown)=>String(v??"").replace(/\s+/g," ").trim();
const Q=(v:number)=>Number.isInteger(v)?String(v):String(Math.round(v*100)/100);
const R=(i:any)=>`${C(i.productName)} × ${Q(i.quantity)}${i.unitHint?` ${C(i.unitHint)}`:""}`;
const K=(v:unknown)=>normalizeCustomerText(v);

type InputOnlyParse=
  |{kind:"order";lines:Array<{rawText:string;productText:string;quantity:number;unitHint:string|null}>}
  |{kind:"ambiguous";lines:[]};

function parseInputOnlyMessage(value:unknown):InputOnlyParse|null{
  const original=String(value??"").replace(/\r\n?/g,"\n").trim();
  if(!original||original.includes("=")||original.includes(":"))return null;

  const explicitSeparator=/(?:\/|;|\n|,(?!\d))/u;
  if(explicitSeparator.test(original)){
    const chunks=original.split(/\s*(?:\/|;|\n|,(?!\d))\s*/u).map(C).filter(Boolean);
    if(chunks.length<2)return null;
    const parsed=chunks.map(chunk=>parseSimpleOrderLine(chunk));
    if(parsed.some(line=>!line))return {kind:"ambiguous",lines:[]};
    return {kind:"order",lines:parsed as Array<{rawText:string;productText:string;quantity:number;unitHint:string|null}>};
  }

  const bareQuantities=K(original).match(/(?:^|\s)\d+(?:[.,]\d+)?(?=\s|$)/g)||[];
  if(bareQuantities.length>1)return {kind:"ambiguous",lines:[]};
  const line=parseSimpleOrderLine(original);
  return line?{kind:"order",lines:[line]}:null;
}

async function catalog(db:any):Promise<TrainingCatalogItem[]>{
  const out:TrainingCatalogItem[]=[];
  for(let from=0;from<5000;from+=1000){
    const x=await db.from("getlink_supplier_products")
      .select("product_code,product_name,is_active,stock_status")
      .eq("is_active",true)
      .range(from,from+999);
    if(x.error)throw x.error;
    const rows=Array.isArray(x.data)?x.data:[];
    for(const row of rows){
      if(row?.product_code&&row?.product_name&&String(row.stock_status||"")!=="inactive")out.push({productCode:String(row.product_code),productName:String(row.product_name)});
    }
    if(rows.length<1000)break;
  }
  return out;
}

async function aliases(db:any,customerId:string):Promise<TrainingAlias[]>{
  const customer=await db.from("getlink_ai_product_aliases")
    .select("alias_normalized,product_code,scope")
    .eq("scope","customer").eq("customer_account_id",customerId).limit(500);
  if(customer.error)throw customer.error;
  const store=await db.from("getlink_ai_product_aliases")
    .select("alias_normalized,product_code,scope")
    .eq("scope","store").limit(500);
  if(store.error)throw store.error;
  return [...(customer.data||[]),...(store.data||[])].map((r:any):TrainingAlias=>({
    aliasNormalized:String(r.alias_normalized||""),
    productCode:String(r.product_code||""),
    scope:r.scope==="store"?"store":"customer",
  })).filter((r:TrainingAlias)=>Boolean(r.aliasNormalized&&r.productCode));
}

async function examples(db:any,userId:string,conversationId:string){
  const x=await db.from("getlink_ai_training_examples")
    .select("raw_text,product_name,product_code,quantity,unit_hint,status,updated_at")
    .eq("customer_account_id",userId).eq("conversation_id",conversationId)
    .neq("status","rejected").order("updated_at",{ascending:false}).limit(80);
  if(x.error)throw x.error;
  return (x.data||[]).map((r:any)=>({
    rawText:String(r.raw_text||""),productName:String(r.product_name||""),productCode:r.product_code?String(r.product_code):null,
    quantity:r.quantity==null?null:Number(r.quantity),unitHint:r.unit_hint?String(r.unit_hint):null,status:String(r.status||"auto"),
  }));
}

async function saveExample(db:any,e:any){
  const n=K(e.rawText);
  const old=await db.from("getlink_ai_training_examples").select("id,status")
    .eq("customer_account_id",e.customerAccountId).eq("conversation_id",e.conversationId).eq("raw_normalized",n).maybeSingle();
  if(old.error)throw old.error;
  if(old.data?.id&&String(old.data.status)==="corrected"&&e.status==="auto")return;
  const x=await db.from("getlink_ai_training_examples").upsert({
    customer_account_id:e.customerAccountId,conversation_id:e.conversationId,source_message_id:e.sourceMessageId,
    raw_text:C(e.rawText),raw_normalized:n,product_name:C(e.productName),product_code:e.productCode||null,
    quantity:e.quantity,unit_hint:e.unitHint||null,status:e.status,confidence:e.status==="corrected"?1:e.confidence,
    updated_at:new Date().toISOString(),
  },{onConflict:"customer_account_id,conversation_id,raw_normalized"});
  if(x.error)throw x.error;
}

async function saveCustomerAlias(db:any,e:{customerAccountId:string;conversationId:string;sessionId?:string|null;sourceMessageId:string;aliasDisplay:string;productCode:string}){
  const aliasNormalized=K(e.aliasDisplay),now=new Date().toISOString();
  if(!aliasNormalized||!e.productCode)return;
  const old=await db.from("getlink_ai_product_aliases").select("id,product_code,confirm_count,correction_count")
    .eq("scope","customer").eq("customer_account_id",e.customerAccountId).eq("alias_normalized",aliasNormalized).maybeSingle();
  if(old.error)throw old.error;
  const previous=old.data?.product_code?String(old.data.product_code):null;
  if(old.data?.id){
    const x=await db.from("getlink_ai_product_aliases").update({
      product_code:e.productCode,alias_display:C(e.aliasDisplay),confidence:1,
      confirm_count:Math.max(1,(Number(old.data.confirm_count)||0)+1),
      correction_count:(Number(old.data.correction_count)||0)+(previous&&previous!==e.productCode?1:0),
      last_used_at:now,updated_at:now,
    }).eq("id",old.data.id);
    if(x.error)throw x.error;
  }else{
    const x=await db.from("getlink_ai_product_aliases").insert({
      scope:"customer",customer_account_id:e.customerAccountId,product_code:e.productCode,
      alias_display:C(e.aliasDisplay),alias_normalized:aliasNormalized,confidence:1,confirm_count:1,correction_count:0,last_used_at:now,
    });
    if(x.error)throw x.error;
  }
  if(previous!==e.productCode){
    const audit=await db.from("getlink_ai_corrections").insert({
      customer_account_id:e.customerAccountId,conversation_id:e.conversationId,session_id:e.sessionId||null,
      source_message_id:e.sourceMessageId,raw_customer_phrase:C(e.aliasDisplay),prior_product_code:previous,
      corrected_product_code:e.productCode,correction_source:"customer_confirmation",
    });
    if(audit.error)throw audit.error;
  }
}

async function session(db:any,conversationId:string){
  const x=await db.from("getlink_ai_order_sessions").select("id,awaiting_context")
    .eq("conversation_id",conversationId).in("state",["collecting","awaiting_clarification","quoted","confirmed"])
    .order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(x.error)throw x.error;return x.data;
}
async function setContext(db:any,id:string,value:any){
  const x=await db.from("getlink_ai_order_sessions").update({awaiting_context:value,updated_at:new Date().toISOString()}).eq("id",id);
  if(x.error)throw x.error;
}

function unresolvedReply(productText:string,quantity?:number|null,unitHint?:string|null){
  const suffix=quantity?` × ${Q(quantity)}${unitHint?` ${unitHint}`:""}`:"";
  return `Em chưa khớp “${C(productText)}” với tên hàng của mình${suffix}. Nhắn “Tên của mình = tên khách gọi” để em học ạ.`;
}

function resolveKnownPhrase(
  phrase:string,
  cat:TrainingCatalogItem[],
  knownAliases:TrainingAlias[],
  knowledgeRules:TrainingKnowledgeLike[],
){
  const learnedPhrase=applyKnowledgeNaming(phrase,knowledgeRules);
  return resolveTrainingProduct(learnedPhrase,cat,knownAliases)||resolveTrainingProduct(phrase,cat,knownAliases);
}

export async function processDbTrainingMessage(
  db:any,
  message:{customerAccountId:string;conversationId:string;messageId:string;body:string},
  credentials?:Partial<ModelCredentials>|null,
  fetchImpl:typeof fetch=fetch,
){
  const inputOnly=parseInputOnlyMessage(message.body);
  if(inputOnly?.kind==="ambiguous"){
    return {reply:"",translation:{kind:"conversation",items:[],teachings:[],knowledge:[],replyText:""}};
  }
  if(inputOnly?.kind==="order"){
    const items=inputOnly.lines.map(line=>({
      rawText:line.rawText,
      productName:line.productText,
      productCode:null,
      quantity:line.quantity,
      unitHint:line.unitHint,
      confidence:1,
    }));
    return {reply:items.map(R).join("\n"),translation:{kind:"order",items,teachings:[],knowledge:[],replyText:""}};
  }

  const s=await session(db,message.conversationId);
  const pending=s?.awaiting_context?.kind==="training_candidate"?s.awaiting_context:null;
  const normalizedBody=K(message.body);
  if(pending&&(normalizedBody==="1"||normalizedBody==="2")){
    await setContext(db,String(s.id),{});
    if(normalizedBody==="2")return {reply:"Đã bỏ qua.",translation:{kind:"conversation",items:[],teachings:[],knowledge:[],replyText:""}};
    const e={
      customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,
      rawText:C(pending.rawText),productName:C(pending.productName),productCode:C(pending.productCode),quantity:Number(pending.quantity),
      unitHint:pending.unitHint?C(pending.unitHint):null,status:"corrected",confidence:1,
    };
    await saveExample(db,e);
    if(pending.aliasText)await saveCustomerAlias(db,{
      customerAccountId:message.customerAccountId,
      conversationId:message.conversationId,
      sourceMessageId:message.messageId,
      sessionId:String(s.id),
      aliasDisplay:C(pending.aliasText),
      productCode:C(pending.productCode),
    });
    return {reply:R(e),translation:{kind:"teaching",items:[],teachings:[e],knowledge:[],replyText:""}};
  }
  if(pending&&s?.id)await setContext(db,String(s.id),{});

  const cat=await catalog(db);
  const knownAliases=await aliases(db,message.customerAccountId);
  const knowledgeRules=await loadKnowledgeRules(db,message.customerAccountId);

  const equation=resolveTeachingEquation(message.body,cat);
  if(equation){
    await saveCustomerAlias(db,{
      customerAccountId:message.customerAccountId,
      conversationId:message.conversationId,
      sourceMessageId:message.messageId,
      sessionId:s?.id?String(s.id):null,
      aliasDisplay:equation.aliasDisplay,
      productCode:equation.productCode,
    });
    const e={
      customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,
      rawText:equation.aliasDisplay,productName:equation.productName,productCode:equation.productCode,quantity:null,unitHint:null,status:"corrected",confidence:1,
    };
    await saveExample(db,e);
    return {reply:`${equation.aliasDisplay} → ${equation.productName}`,translation:{kind:"teaching",items:[],teachings:[e],knowledge:[],replyText:""}};
  }

  const grouped=parseGroupedVariantOrder(message.body);
  if(grouped){
    const parentCatalog=scopeCatalogByParent(grouped.parentText,cat);
    const scopedCatalog=parentCatalog.length?parentCatalog:cat;
    const fallbackReplies:string[]=[],fallbackItems:any[]=[];
    let unresolvedCount=0;
    for(const child of grouped.items){
      const phrase=`${grouped.parentText} ${child.label}`;
      const resolved=resolveKnownPhrase(phrase,scopedCatalog,knownAliases,knowledgeRules);
      const rawText=`${Q(child.quantity)} ${grouped.parentText} ${child.label}`;
      if(resolved){
        const e={customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,rawText,productName:resolved.productName,productCode:resolved.productCode,quantity:child.quantity,unitHint:null,status:"auto",confidence:resolved.source==="fuzzy"?.9:1};
        fallbackReplies.push(R(e));fallbackItems.push(e);
      }else{
        unresolvedCount++;
        fallbackReplies.push(unresolvedReply(phrase,child.quantity,null));
        fallbackItems.push({rawText,productName:phrase,productCode:null,quantity:child.quantity,unitHint:null,confidence:0});
      }
    }
    if(!unresolvedCount){
      for(const item of fallbackItems)await saveExample(db,item);
      return {reply:fallbackReplies.join("\n"),translation:{kind:"order",items:fallbackItems,teachings:[],knowledge:[],replyText:""}};
    }

    try{
      const learned=await examples(db,message.customerAccountId,message.conversationId);
      const candidates=(parentCatalog.length?parentCatalog:rankTrainingCandidates(grouped.parentText,cat,30)).slice(0,40).map(({productCode,productName})=>({productCode,productName}));
      const translation=await translateTrainingMessageWithModel({customerText:message.body,learnedExamples:learned,candidates,knowledgeRules},fetchImpl,credentials);
      if(translation.kind==="order"&&translation.items.length){
        const replies:string[]=[],items:any[]=[];
        for(const item of translation.items){
          const parsed=parseSimpleOrderLine(item.rawText);
          const phrase=parsed?.productText||item.productName;
          const resolved=resolveKnownPhrase(item.productName,scopedCatalog,knownAliases,knowledgeRules)
            ||resolveKnownPhrase(phrase,scopedCatalog,knownAliases,knowledgeRules);
          if(resolved){
            const e={
              customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,
              rawText:item.rawText,productName:resolved.productName,productCode:resolved.productCode,quantity:item.quantity,
              unitHint:item.unitHint,status:"auto",confidence:Math.max(Number(item.confidence)||0,resolved.source==="fuzzy"?.9:.99),
            };
            await saveExample(db,e);replies.push(R(e));items.push(e);
          }else{
            replies.push(unresolvedReply(phrase,item.quantity,item.unitHint));
            items.push({...item,productCode:null});
          }
        }
        return {reply:replies.join("\n"),translation:{...translation,items}};
      }
    }catch(error){
      if(!(error instanceof TrainingModelError))throw error;
    }
    for(const item of fallbackItems){if(item.productCode)await saveExample(db,item);}
    return {reply:fallbackReplies.join("\n"),translation:{kind:"order",items:fallbackItems,teachings:[],knowledge:[],replyText:""}};
  }

  const simpleLines=parseSimpleOrderLines(message.body);
  if(simpleLines.length){
    const replies:string[]=[],items:any[]=[];
    for(const line of simpleLines){
      const resolved=resolveKnownPhrase(line.productText,cat,knownAliases,knowledgeRules);
      if(resolved){
        const e={customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,rawText:line.rawText,productName:resolved.productName,productCode:resolved.productCode,quantity:line.quantity,unitHint:line.unitHint,status:"auto",confidence:resolved.source.includes("alias")?1:resolved.source==="canonical"?.99:.88};
        await saveExample(db,e);replies.push(R(e));items.push(e);
      }else{
        replies.push(unresolvedReply(line.productText,line.quantity,line.unitHint));
        items.push({rawText:line.rawText,productName:line.productText,productCode:null,quantity:line.quantity,unitHint:line.unitHint,confidence:0});
      }
    }
    return {reply:replies.join("\n"),translation:{kind:"order",items,teachings:[],knowledge:[],replyText:""}};
  }

  const simple=parseSimpleOrderLine(message.body);
  if(simple){
    const resolved=resolveKnownPhrase(simple.productText,cat,knownAliases,knowledgeRules);
    if(resolved){
      const e={
        customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,
        rawText:simple.rawText,productName:resolved.productName,productCode:resolved.productCode,quantity:simple.quantity,
        unitHint:simple.unitHint,status:"auto",confidence:resolved.source.includes("alias")?1:resolved.source==="canonical"?.99:.88,
      };
      await saveExample(db,e);
      return {reply:R(e),translation:{kind:"order",items:[e],teachings:[],knowledge:[],replyText:""}};
    }
  }

  const learned=await examples(db,message.customerAccountId,message.conversationId);
  const candidateSeed=applyKnowledgeNaming(simple?.productText||message.body,knowledgeRules);
  const candidates=rankTrainingCandidates(candidateSeed,cat,20).map(({productCode,productName})=>({productCode,productName}));
  let translation:any;
  try{
    translation=await translateTrainingMessageWithModel({customerText:message.body,learnedExamples:learned,candidates,knowledgeRules},fetchImpl,credentials);
  }catch(error){
    if(error instanceof TrainingModelError){
      const fallbackRules=fallbackKnowledgeRules(message.body);
      if(fallbackRules.length){
        const saved=await saveKnowledgeRules(db,{customerAccountId:message.customerAccountId,sourceMessageId:message.messageId,rules:fallbackRules});
        return {reply:saved?`Đã lưu ${saved} hướng dẫn để dùng lại.`:"Hướng dẫn này đã có trong kiến thức.",translation:{kind:"knowledge",items:[],teachings:[],knowledge:fallbackRules,replyText:""}};
      }
      return {reply:unresolvedReply(simple?.productText||message.body,simple?.quantity,simple?.unitHint),translation:{kind:"conversation",items:[],teachings:[],knowledge:[],replyText:""}};
    }
    throw error;
  }

  if(translation.kind==="knowledge"){
    const saved=await saveKnowledgeRules(db,{
      customerAccountId:message.customerAccountId,
      sourceMessageId:message.messageId,
      rules:translation.knowledge,
    });
    return {reply:saved?`Đã học ${saved} quy tắc.`:"Không có quy tắc mới để lưu.",translation};
  }

  const replies:string[]=[];
  let newPending:any=null;
  if(translation.kind==="conversation")return {reply:C(translation.replyText),translation};
  if(translation.kind==="order"){
    for(const item of translation.items){
      const parsed=parseSimpleOrderLine(item.rawText);
      const phrase=parsed?.productText||item.productName;
      const resolved=resolveKnownPhrase(phrase,cat,knownAliases,knowledgeRules)||resolveKnownPhrase(item.productName,cat,knownAliases,knowledgeRules);
      if(resolved){
        const e={
          customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,
          rawText:item.rawText,productName:resolved.productName,productCode:resolved.productCode,quantity:item.quantity,
          unitHint:item.unitHint,status:"auto",confidence:Math.max(Number(item.confidence)||0,resolved.source==="fuzzy"?.88:.99),
        };
        await saveExample(db,e);replies.push(R(e));continue;
      }
      const ranked=rankTrainingCandidates(applyKnowledgeNaming(phrase,knowledgeRules),cat,2);
      if(ranked[0]&&!newPending&&ranked[0].score>=.68){
        newPending={rawText:item.rawText,aliasText:phrase,productName:ranked[0].productName,productCode:ranked[0].productCode,quantity:item.quantity,unitHint:item.unitHint};
        replies.push(`Có phải ${R(newPending)} không?\n1. Đúng\n2. Sai / bỏ qua`);continue;
      }
      const e={
        customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,
        rawText:item.rawText,productName:item.productName,productCode:null,quantity:item.quantity,
        unitHint:item.unitHint,status:"auto",confidence:item.confidence,
      };
      await saveExample(db,e);replies.push(unresolvedReply(phrase,item.quantity,item.unitHint));
    }
    if(newPending&&s?.id)await setContext(db,String(s.id),{kind:"training_candidate",...newPending});
    return {reply:replies.join("\n"),translation};
  }

  for(const teaching of translation.teachings){
    const resolved=resolveKnownPhrase(teaching.productName,cat,knownAliases,knowledgeRules);
    const e={
      customerAccountId:message.customerAccountId,conversationId:message.conversationId,sourceMessageId:message.messageId,
      rawText:teaching.rawText,productName:resolved?.productName||teaching.productName,productCode:resolved?.productCode||null,
      quantity:teaching.quantity==null?null:Number(teaching.quantity),unitHint:teaching.unitHint?C(teaching.unitHint):null,status:"corrected",confidence:1,
    };
    await saveExample(db,e);
    replies.push(e.quantity!=null?`${C(e.rawText)} → ${R(e)}`:`${C(e.rawText)} → ${C(e.productName)}`);
  }
  return {reply:replies.join("\n")||C(translation.replyText),translation};
}
