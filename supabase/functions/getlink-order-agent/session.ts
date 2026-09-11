import type { ParsedIntent, ProductResolution } from "./types.ts";
import { parseFastCommand, nextRoundSuggestion } from "./rules.ts";

export type DraftLine={
  lineKey:string;
  productCode:string;
  productName:string;
  customerRawText:string;
  quantity:number;
  unitHint:string|null;
  attributes:Record<string,unknown>;
  lineNote:string;
  quotedPriceVnd:number|null;
  confidence:number;
  resolutionSource:string;
  sourceMessageId?:string|null;
};

export type AgentSession={
  id:string;
  customerAccountId:string;
  conversationId:string;
  state:string;
  awaitingContext:Record<string,unknown>;
  lastPriceListContext:Record<string,unknown>;
  roundUpsellOffered:boolean;
  roundUpsellDeclined:boolean;
  salesOrderId:string|null;
};

export type ClaimedTurn={
  turnKey:string;
  conversationId:string;
  customerAccountId:string;
  messages:Array<{id:string;body:string;createdAt?:string}>;
};

export type SessionRepository={
  loadOrCreateSession(customerAccountId:string,conversationId:string):Promise<AgentSession>;
  listDraftLines(sessionId:string):Promise<DraftLine[]>;
  saveLine(sessionId:string,line:DraftLine):Promise<unknown>;
  deleteLine(sessionId:string,lineKey:string):Promise<unknown>;
  updateSession(sessionId:string,patch:Record<string,unknown>):Promise<AgentSession|unknown>;
  getProductHint(productCode:string):Promise<{askAttribute?:string|null}|null>;
  listPriceScope(scope:string):Promise<unknown>;
  materializePendingOrder(session:AgentSession,lines:DraftLine[]):Promise<string>;
};

export type ProcessDeps={
  parseWithModel(input:any):Promise<ParsedIntent>;
  resolveProduct(customerId:string,rawText:string):Promise<ProductResolution>;
  commercialFacts(productCode:string,quantity:number):Promise<any>;
};

export type TurnResult={
  kind:"ignore"|"order_update"|"clarification"|"price"|"price_list"|"confirmation"|"decline"|"fallback";
  sessionId:string;
  facts?:any;
  lines?:DraftLine[];
  salesOrderId?:string;
  reason?:string;
  roundSuggestion?:{target:number;gap:number}|null;
  priceList?:unknown;
};

function clean(value:unknown){return String(value??"").replace(/\s+/g," ").trim();}

function attributeValue(intent:ParsedIntent,key:string):string{
  const direct=intent.attributes?.[key];
  if(direct!=null&&clean(direct))return clean(direct);
  if(intent.line_note)return clean(intent.line_note);
  return "";
}

async function parseMessage(
  message:{body:string},
  session:AgentSession,
  lines:DraftLine[],
  deps:ProcessDeps,
):Promise<ParsedIntent>{
  const fast=parseFastCommand(message.body);
  if(fast && session.state!=="awaiting_clarification")return fast;
  if(fast?.intent==="confirm"||fast?.intent==="decline")return fast;
  return await deps.parseWithModel({
    customerText:message.body,
    recentContext:lines.slice(-8).map(line=>({role:"assistant",text:`${line.productName} x${line.quantity}`})),
    awaitingClarification:session.state==="awaiting_clarification"?session.awaitingContext:null,
  });
}

async function resolveForIntent(
  intent:ParsedIntent,
  lines:DraftLine[],
  customerId:string,
  deps:ProcessDeps,
):Promise<ProductResolution>{
  const target=clean(intent.reference_target);
  if(target){
    const existing=lines.find(line=>line.productCode===target||line.lineKey===target);
    if(existing)return {productCode:existing.productCode,productName:existing.productName,confidence:1,source:"canonical"};
  }
  return deps.resolveProduct(customerId,intent.raw_product_text);
}

async function cartonEquivalent(lines:DraftLine[],deps:ProcessDeps):Promise<number>{
  let total=0;
  for(const line of lines){
    const facts=await deps.commercialFacts(line.productCode,line.quantity);
    const n=Number(facts?.cartonEquivalent)||0;
    if(n>0)total+=n;
    else if(String(line.unitHint||"").toLowerCase()==="thùng")total+=Number(line.quantity)||0;
  }
  return total;
}

export async function processTurn(
  repo:SessionRepository,
  claimedTurn:ClaimedTurn,
  deps:ProcessDeps,
):Promise<TurnResult>{
  const session=await repo.loadOrCreateSession(claimedTurn.customerAccountId,claimedTurn.conversationId);
  let lines=await repo.listDraftLines(session.id);
  let result:TurnResult={kind:"ignore",sessionId:session.id,lines,roundSuggestion:null};

  for(const message of claimedTurn.messages){
    let parsed:ParsedIntent;
    try{parsed=await parseMessage(message,session,lines,deps);}
    catch{
      result={kind:"fallback",sessionId:session.id,lines,reason:"model_unavailable",roundSuggestion:null};
      continue;
    }

    if(parsed.intent==="ignore")continue;

    if(parsed.intent==="decline"){
      session.roundUpsellDeclined=true;
      await repo.updateSession(session.id,{roundUpsellDeclined:true});
      result={kind:"decline",sessionId:session.id,lines,roundSuggestion:null};
      continue;
    }

    if(parsed.intent==="clarification_answer"&&session.state==="awaiting_clarification"){
      const lineKey=clean(session.awaitingContext?.lineKey);
      const attribute=clean(session.awaitingContext?.attribute)||"other";
      const line=lines.find(row=>row.lineKey===lineKey);
      if(!line){
        result={kind:"fallback",sessionId:session.id,lines,reason:"clarification_line_missing",roundSuggestion:null};
        continue;
      }
      const value=attributeValue(parsed,attribute)||clean(message.body);
      const next:DraftLine={
        ...line,
        attributes:{...(line.attributes||{}),[attribute]:value},
        lineNote:clean(parsed.line_note)||line.lineNote||value,
        sourceMessageId:message.id,
        resolutionSource:"clarification",
      };
      await repo.saveLine(session.id,next);
      session.state="collecting";
      session.awaitingContext={};
      await repo.updateSession(session.id,{state:"collecting",awaitingContext:{}});
      lines=await repo.listDraftLines(session.id);
      result={kind:"order_update",sessionId:session.id,lines,roundSuggestion:null};
      continue;
    }

    if(parsed.intent==="confirm"){
      if(session.salesOrderId){
        result={kind:"confirmation",sessionId:session.id,lines,salesOrderId:session.salesOrderId,roundSuggestion:null};
        continue;
      }
      lines=await repo.listDraftLines(session.id);
      if(!lines.length){
        result={kind:"fallback",sessionId:session.id,lines,reason:"empty_order",roundSuggestion:null};
        continue;
      }
      const salesOrderId=await repo.materializePendingOrder(session,lines);
      session.salesOrderId=salesOrderId;
      session.state="handed_off";
      await repo.updateSession(session.id,{state:"handed_off",salesOrderId});
      result={kind:"confirmation",sessionId:session.id,lines,salesOrderId,roundSuggestion:null};
      continue;
    }

    if(parsed.intent==="price_list"){
      const scope=clean(parsed.raw_product_text)||"toan bo";
      const priceList=await repo.listPriceScope(scope);
      session.lastPriceListContext={scope};
      await repo.updateSession(session.id,{lastPriceListContext:{scope},state:"quoted"});
      session.state="quoted";
      result={kind:"price_list",sessionId:session.id,lines,priceList,roundSuggestion:null};
      continue;
    }

    if(["add_item","change_qty","remove_item","price_query"].includes(parsed.intent)){
      const resolution=await resolveForIntent(parsed,lines,claimedTurn.customerAccountId,deps);
      if(!resolution){
        result={kind:"clarification",sessionId:session.id,lines,reason:"product_not_confident",roundSuggestion:null};
        continue;
      }

      if(parsed.intent==="price_query"){
        const facts=await deps.commercialFacts(resolution.productCode,1);
        result={kind:"price",sessionId:session.id,lines,facts,roundSuggestion:null};
        continue;
      }

      const existing=lines.find(line=>line.productCode===resolution.productCode);
      if(parsed.intent==="remove_item"){
        if(existing)await repo.deleteLine(session.id,existing.lineKey);
        lines=await repo.listDraftLines(session.id);
        result={kind:"order_update",sessionId:session.id,lines,roundSuggestion:null};
        continue;
      }

      const incomingQty=Number(parsed.quantity)||0;
      if(incomingQty<=0){
        result={kind:"fallback",sessionId:session.id,lines,reason:"invalid_quantity",roundSuggestion:null};
        continue;
      }
      const quantity=parsed.intent==="change_qty"
        ?incomingQty
        :(Number(existing?.quantity)||0)+incomingQty;
      const facts=await deps.commercialFacts(resolution.productCode,quantity);
      const next:DraftLine={
        lineKey:existing?.lineKey||resolution.productCode,
        productCode:resolution.productCode,
        productName:resolution.productName,
        customerRawText:clean(message.body),
        quantity,
        unitHint:parsed.unit_hint??existing?.unitHint??null,
        attributes:{...(existing?.attributes||{}),...(parsed.attributes||{})},
        lineNote:clean(parsed.line_note)||existing?.lineNote||"",
        quotedPriceVnd:Number(facts?.unitPriceVnd)||0,
        confidence:resolution.confidence,
        resolutionSource:resolution.source,
        sourceMessageId:message.id,
      };
      await repo.saveLine(session.id,next);
      lines=await repo.listDraftLines(session.id);

      const hint=await repo.getProductHint(resolution.productCode);
      const requiredAttribute=clean(hint?.askAttribute);
      const requiredValue=requiredAttribute?clean(next.attributes?.[requiredAttribute]):"";
      if(parsed.needs_clarification||(requiredAttribute&&!requiredValue)){
        session.state="awaiting_clarification";
        session.awaitingContext={
          kind:"attribute",lineKey:next.lineKey,productCode:next.productCode,
          productName:next.productName,attribute:requiredAttribute||"other",
          questionHint:parsed.clarification_question_hint||null,
        };
        await repo.updateSession(session.id,{state:"awaiting_clarification",awaitingContext:session.awaitingContext});
        result={kind:"clarification",sessionId:session.id,lines,facts,reason:"missing_attribute",roundSuggestion:null};
        continue;
      }

      let roundSuggestion:{target:number;gap:number}|null=null;
      if(!session.roundUpsellDeclined&&!session.roundUpsellOffered){
        roundSuggestion=nextRoundSuggestion(await cartonEquivalent(lines,deps));
        if(roundSuggestion){
          session.roundUpsellOffered=true;
          await repo.updateSession(session.id,{roundUpsellOffered:true});
        }
      }
      await repo.updateSession(session.id,{state:"collecting"});
      session.state="collecting";
      result={kind:"order_update",sessionId:session.id,lines,facts,roundSuggestion};
    }
  }

  return result;
}
