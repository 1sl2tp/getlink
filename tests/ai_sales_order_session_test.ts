import assert from "node:assert/strict";
import type { ParsedIntent, ProductResolution } from "../supabase/functions/getlink-order-agent/types.ts";

async function loadSession():Promise<any>{
  try{return await import("../supabase/functions/getlink-order-agent/session.ts");}
  catch(error){assert.fail(`session module missing or invalid: ${String(error)}`);}
}

function intent(overrides:Partial<ParsedIntent>):ParsedIntent{
  return {
    intent:"ignore",raw_product_text:"",quantity:null,unit_hint:null,attributes:{},line_note:"",
    reference_target:null,needs_clarification:false,clarification_question_hint:null,...overrides,
  };
}

class MemoryRepo{
  session:any={
    id:"s1",customerAccountId:"u1",conversationId:"c1",state:"collecting",awaitingContext:{},
    lastPriceListContext:{},roundUpsellOffered:false,roundUpsellDeclined:false,salesOrderId:null,
  };
  lines:any[]=[];
  materializeCalls=0;
  async loadOrCreateSession(){return this.session;}
  async listDraftLines(){return this.lines.map(x=>({...x,attributes:{...(x.attributes||{})}}));}
  async saveLine(_sessionId:string,line:any){
    const at=this.lines.findIndex(x=>x.lineKey===line.lineKey);
    if(at>=0)this.lines[at]={...this.lines[at],...line}; else this.lines.push({...line});
    return line;
  }
  async deleteLine(_sessionId:string,lineKey:string){this.lines=this.lines.filter(x=>x.lineKey!==lineKey);}
  async updateSession(_id:string,patch:any){Object.assign(this.session,patch);return this.session;}
  async getProductHint(productCode:string){
    return productCode==="BI-BE"?{askAttribute:"color"}:null;
  }
  async listPriceScope(scope:string){return {scope,items:[]};}
  async materializePendingOrder(){this.materializeCalls+=1;return "order-1";}
}

const products:Record<string,ProductResolution>={
  milo:{productCode:"MILO180",productName:"Milo 180ml",confidence:1,source:"customer_alias"},
  "bi be":{productCode:"BI-BE",productName:"Bi bé",confidence:.9,source:"fuzzy"},
  "hao hao":{productCode:"HH30",productName:"Mì Hảo Hảo 30 gói",confidence:1,source:"customer_alias"},
  "555":{productCode:"555",productName:"Thuốc lá 555",confidence:1,source:"customer_alias"},
};

function deps(modelIntents:ParsedIntent[]=[]){
  let modelAt=0;
  return {
    parseWithModel:async()=>modelIntents[modelAt++]||intent({intent:"ignore"}),
    resolveProduct:async(_customerId:string,raw:string)=>products[raw]||null,
    commercialFacts:async(productCode:string,quantity:number)=>({
      productCode,productName:productCode,quantity,unitPriceVnd:1000,lineTotalVnd:1000*quantity,
      cartonEquivalent:productCode==="HH30"?quantity:0,
    }),
  };
}

Deno.test("live session changes Milo quantity instead of duplicating the line",async()=>{
  const {processTurn}=await loadSession();
  const repo=new MemoryRepo();
  await processTurn(repo,{turnKey:"t1",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m1",body:"milo 5"}]},deps());
  await processTurn(repo,{turnKey:"t2",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m2",body:"milo lấy 3 thôi"}]},deps([
    intent({intent:"change_qty",raw_product_text:"milo",quantity:3,reference_target:"MILO180"}),
  ]));
  assert.equal(repo.lines.length,1);
  assert.equal(repo.lines[0].productCode,"MILO180");
  assert.equal(repo.lines[0].quantity,3);
});

Deno.test("missing color asks clarification and the next answer attaches to that exact line",async()=>{
  const {processTurn}=await loadSession();
  const repo=new MemoryRepo();
  const first=await processTurn(repo,{turnKey:"t1",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m1",body:"bi bé 2 màu"}]},deps([
    intent({intent:"add_item",raw_product_text:"bi be",quantity:2,needs_clarification:true,clarification_question_hint:"màu gì"}),
  ]));
  assert.equal(first.kind,"clarification");
  assert.equal(repo.session.state,"awaiting_clarification");
  const second=await processTurn(repo,{turnKey:"t2",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m2",body:"1 đỏ 1 xanh"}]},deps([
    intent({intent:"clarification_answer",attributes:{color:"1 đỏ 1 xanh"},line_note:"1 đỏ, 1 xanh"}),
  ]));
  assert.equal(second.kind,"order_update");
  assert.equal(repo.lines[0].attributes.color,"1 đỏ 1 xanh");
  assert.equal(repo.lines[0].lineNote,"1 đỏ, 1 xanh");
  assert.equal(repo.session.state,"collecting");
});

Deno.test("price query reads facts without mutating the draft",async()=>{
  const {processTurn}=await loadSession();
  const repo=new MemoryRepo();
  const result=await processTurn(repo,{turnKey:"t1",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m1",body:"555 hôm nay?"}]},deps());
  assert.equal(result.kind,"price");
  assert.equal(result.facts.productCode,"555");
  assert.equal(repo.lines.length,0);
});

Deno.test("confirmation materializes once and retry returns the same order",async()=>{
  const {processTurn}=await loadSession();
  const repo=new MemoryRepo();
  repo.lines=[{lineKey:"MILO180",productCode:"MILO180",productName:"Milo 180ml",quantity:3,attributes:{},lineNote:"",unitHint:null}];
  const first=await processTurn(repo,{turnKey:"t1",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m1",body:"ok"}]},deps());
  const second=await processTurn(repo,{turnKey:"t2",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m2",body:"ok"}]},deps());
  assert.equal(first.kind,"confirmation");
  assert.equal(first.salesOrderId,"order-1");
  assert.equal(second.salesOrderId,"order-1");
  assert.equal(repo.materializeCalls,1);
  assert.equal(repo.session.state,"handed_off");
});

Deno.test("17 cartons offers 20 once and decline suppresses further upsell",async()=>{
  const {processTurn}=await loadSession();
  const repo=new MemoryRepo();
  const first=await processTurn(repo,{turnKey:"t1",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m1",body:"hảo hảo 17 thùng"}]},deps());
  assert.deepEqual(first.roundSuggestion,{target:20,gap:3});
  assert.equal(repo.session.roundUpsellOffered,true);
  await processTurn(repo,{turnKey:"t2",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m2",body:"thôi em"}]},deps());
  assert.equal(repo.session.roundUpsellDeclined,true);
  const third=await processTurn(repo,{turnKey:"t3",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m3",body:"hảo hảo 1 thùng"}]},deps());
  assert.equal(third.roundSuggestion,null);
});
