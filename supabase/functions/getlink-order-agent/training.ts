import type { TrainingCatalogItem, TrainingExample, TrainingTranslation } from "./llm.ts";

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
