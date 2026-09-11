import assert from "node:assert/strict";
import { createSessionRepository } from "../supabase/functions/getlink-order-agent/repository.ts";
import { processTurn } from "../supabase/functions/getlink-order-agent/session.ts";
import { shouldEnqueueCustomerReply } from "../supabase/functions/getlink-order-agent/orchestrator.ts";

function memoryUnresolvedDb(){
  const rows:any[]=[];
  let seq=0;
  return {
    rows,
    from(table:string){
      assert.equal(table,"getlink_ai_unresolved_draft_lines");
      const filters:Array<[string,unknown]>=[];
      let mode:"read"|"upsert"|"update"="read";
      let payload:any=null;
      let onConflict="";
      const query:any={
        select(){return query;},
        eq(column:string,value:unknown){filters.push([column,value]);return query;},
        order(){return query;},
        upsert(value:any,opts:any){mode="upsert";payload=value;onConflict=String(opts?.onConflict||"");return query;},
        update(value:any){mode="update";payload=value;return query;},
        async single(){
          if(mode==="upsert"){
            assert.equal(onConflict,"session_id,line_key");
            const index=rows.findIndex(row=>row.session_id===payload.session_id&&row.line_key===payload.line_key);
            const next={id:index>=0?rows[index].id:`u${++seq}`,created_at:index>=0?rows[index].created_at:new Date().toISOString(),...index>=0?rows[index]:{},...payload};
            if(index>=0)rows[index]=next;else rows.push(next);
            return {data:next,error:null};
          }
          const selected=rows.find(row=>filters.every(([key,value])=>row[key]===value));
          if(mode==="update"&&selected)Object.assign(selected,payload);
          return {data:selected||null,error:null};
        },
        then(resolve:(value:any)=>unknown,reject:(reason:any)=>unknown){
          let selected=rows.filter(row=>filters.every(([key,value])=>row[key]===value));
          if(mode==="update")selected=selected.map(row=>Object.assign(row,payload));
          return Promise.resolve({data:selected,error:null}).then(resolve,reject);
        },
      };
      return query;
    },
  };
}

Deno.test("unresolved draft repository upserts by session and line key and lists pending rows",async()=>{
  const db:any=memoryUnresolvedDb();
  const repo:any=createSessionRepository(db);
  const line={
    lineKey:"message-1:0",
    sourceMessageId:"message-1",
    rawText:"2 bịch hướng dương",
    rawProductText:"hướng dương",
    quantity:2,
    unitHint:"bịch",
    contextFamily:null,
    candidateProductCodes:[],
    reason:"not_in_catalog",
    status:"pending",
    resolvedProductCode:null,
  };
  await repo.saveUnresolvedLine("session-1",line);
  await repo.saveUnresolvedLine("session-1",{...line,quantity:3});
  assert.equal(db.rows.length,1);
  assert.equal(db.rows[0].quantity,3);
  const pending=await repo.listUnresolvedLines("session-1","pending");
  assert.equal(pending.length,1);
  assert.equal(pending[0].lineKey,"message-1:0");
  assert.equal(pending[0].rawProductText,"hướng dương");
  assert.equal(pending[0].unitHint,"bịch");
  assert.equal(pending[0].reason,"not_in_catalog");
});

Deno.test("owner resolution marks one unresolved row resolved with catalog product code",async()=>{
  const db:any=memoryUnresolvedDb();
  const repo:any=createSessionRepository(db);
  const saved=await repo.saveUnresolvedLine("session-1",{
    lineKey:"message-1:1",sourceMessageId:"message-1",rawText:"2 bát 1.8kg",rawProductText:"bát 1.8kg",
    quantity:2,unitHint:null,contextFamily:"mi_chinh",candidateProductCodes:["HT-000099"],
    reason:"size_mismatch",status:"pending",resolvedProductCode:null,
  });
  const resolved=await repo.markUnresolvedResolved(saved.id,"HT-000099");
  assert.equal(resolved.status,"resolved");
  assert.equal(resolved.resolvedProductCode,"HT-000099");
  assert.equal((await repo.listUnresolvedLines("session-1","pending")).length,0);
});

Deno.test("repository materialization fails closed before native order when unresolved rows remain",async()=>{
  const db:any=memoryUnresolvedDb();
  const repo:any=createSessionRepository(db);
  await repo.saveUnresolvedLine("session-1",{
    lineKey:"message-1:0",sourceMessageId:"message-1",rawText:"2 bịch hướng dương",rawProductText:"hướng dương",
    quantity:2,unitHint:"bịch",contextFamily:null,candidateProductCodes:[],reason:"not_in_catalog",status:"pending",resolvedProductCode:null,
  });
  await assert.rejects(
    ()=>repo.materializePendingOrder(
      {id:"session-1",customerAccountId:"u1",conversationId:"c1",state:"collecting",awaitingContext:{},lastPriceListContext:{},roundUpsellOffered:false,roundUpsellDeclined:false,salesOrderId:null},
      [{lineKey:"P1",productCode:"P1",productName:"Known",customerRawText:"known",quantity:1,unitHint:null,attributes:{},lineNote:"",quotedPriceVnd:1000,confidence:1,resolutionSource:"canonical"}],
    ),
    /unresolved_items_pending/,
  );
});

const MULTILINE=`2 bịch hướng dương
- 2 bát 1.8kg, 2 bát 1kg, 2 bát 454
- 2 omo 1.15kg, 2 omo 5.5kg, 2 omo 5.1kg, 2 omo 2.9kg, 2 omo 2.6kg, 2 omo 700g, 1 omo 380g
- 2 cái lân 1l, 2 cái lân 5l
- 2 meizan 1l, 2 meizan 5l
- 5 gạo 2l, 5 nep 2l`;

const LOOKUPS:Record<string,{productCode:string;productName:string}>={
  "Mi chinh bat 1":{productCode:"HT-000098",productName:"Mi chinh bat 1"},
  "Mi chinh bat 454":{productCode:"HT-000100",productName:"Mi chinh bat 454"},
  "Bot giat omo 1.15kg":{productCode:"HU-000004",productName:"Bot giat omo 1.15kg"},
  "Bot giat omo 5.5kg":{productCode:"HU-000012",productName:"Bot giat omo 5.5kg"},
  "Bot giat omo 5.1kg":{productCode:"HU-000011",productName:"Bot giat omo 5.1kg"},
  "Bot giat omo 2.9kg":{productCode:"HU-000006",productName:"Bot giat omo 2.9kg"},
  "Bot giat omo 2.6kg":{productCode:"HU-000005",productName:"Bot giat omo 2.6kg"},
  "Bot giat omo 700g":{productCode:"HU-000013",productName:"Bot giat omo 700g/24 gói"},
  "Bot giat omo 380g":{productCode:"HU-000009",productName:"Bot giat omo 380g"},
  "Dau lan 1":{productCode:"HT-000063",productName:"Dau lan 1"},
  "Dau lan 5":{productCode:"HT-000065",productName:"Dau lan 5"},
  "Dau zan 1":{productCode:"HT-000074",productName:"Dau zan 1"},
  "Dau zan 5":{productCode:"HT-000077",productName:"Dau zan 5"},
  "Dau sim gao 2":{productCode:"HT-000073",productName:"Dau sim gao 2"},
  "Dau nep 2":{productCode:"HT-000067",productName:"Dau nep 2"},
};

class MixedMemoryRepo{
  session:any={id:"s1",customerAccountId:"u1",conversationId:"c1",state:"collecting",awaitingContext:{},lastPriceListContext:{},roundUpsellOffered:false,roundUpsellDeclined:false,salesOrderId:null};
  lines:any[]=[];
  unresolved:any[]=[];
  materializeCalls=0;
  async loadOrCreateSession(){return this.session;}
  async listDraftLines(){return this.lines.map(row=>({...row,attributes:{...(row.attributes||{})}}));}
  async saveLine(_sessionId:string,line:any){const at=this.lines.findIndex(row=>row.lineKey===line.lineKey);if(at>=0)this.lines[at]={...this.lines[at],...line};else this.lines.push({...line});return line;}
  async deleteLine(_sessionId:string,lineKey:string){this.lines=this.lines.filter(row=>row.lineKey!==lineKey);}
  async listUnresolvedLines(_sessionId:string,status:string|null="pending"){return this.unresolved.filter(row=>!status||row.status===status).map(row=>({...row}));}
  async saveUnresolvedLine(_sessionId:string,line:any){const at=this.unresolved.findIndex(row=>row.lineKey===line.lineKey);const next={id:at>=0?this.unresolved[at].id:`u${this.unresolved.length+1}`,...line};if(at>=0)this.unresolved[at]=next;else this.unresolved.push(next);return next;}
  async markUnresolvedResolved(id:string,productCode:string){const row=this.unresolved.find(item=>item.id===id);if(!row)throw new Error("not_found");row.status="resolved";row.resolvedProductCode=productCode;return {...row};}
  async updateSession(_id:string,patch:any){Object.assign(this.session,patch);return this.session;}
  async getProductHint(){return null;}
  async listPriceScope(){return {scope:"",count:0,items:[]};}
  async materializePendingOrder(){this.materializeCalls+=1;return "order-1";}
}

function deterministicDeps(){
  return {
    parseWithModel:async()=>{throw new Error("model should not own deterministic multiline fixture");},
    resolveProduct:async(_customerId:string,raw:string)=>LOOKUPS[raw]?{...LOOKUPS[raw],confidence:1,source:"canonical" as const}:null,
    commercialFacts:async(productCode:string,quantity:number)=>({productCode,quantity,unitPriceVnd:productCode==="HT-000073"?0:1000,lineTotalVnd:productCode==="HT-000073"?0:quantity*1000,cartonEquivalent:quantity}),
  };
}

Deno.test("one multiline turn builds 15 resolved lines and preserves 2 unresolved owner-review lines",async()=>{
  const repo:any=new MixedMemoryRepo();
  const result=await processTurn(repo,{turnKey:"t1",conversationId:"c1",customerAccountId:"u1",messages:[{id:"message-real",body:MULTILINE}]},deterministicDeps());
  assert.equal(result.kind,"owner_review");
  assert.equal(repo.lines.length,15);
  assert.equal(repo.unresolved.filter((row:any)=>row.status==="pending").length,2);
  assert.deepEqual(repo.unresolved.map((row:any)=>[row.rawText,row.reason]),[
    ["2 bịch hướng dương","not_in_catalog"],["2 bát 1.8kg","size_mismatch"],
  ]);
  assert.ok(repo.lines.some((row:any)=>row.productCode==="HT-000073"&&row.quantity===5&&row.quotedPriceVnd===0));
  assert.ok(repo.lines.some((row:any)=>row.productCode==="HT-000067"&&row.quantity===5));
  assert.equal(repo.materializeCalls,0);
});

Deno.test("confirm with unresolved lines returns owner review and never materializes native order",async()=>{
  const repo:any=new MixedMemoryRepo();
  repo.lines=[{lineKey:"HT-000063",productCode:"HT-000063",productName:"Dau lan 1",customerRawText:"cái lân 1l",quantity:2,unitHint:null,attributes:{},lineNote:"",quotedPriceVnd:495000,confidence:1,resolutionSource:"canonical"}];
  repo.unresolved=[{id:"u1",lineKey:"m1:0",sourceMessageId:"m1",rawText:"2 bịch hướng dương",rawProductText:"hướng dương",quantity:2,unitHint:"bịch",contextFamily:null,candidateProductCodes:[],reason:"not_in_catalog",status:"pending",resolvedProductCode:null}];
  const result=await processTurn(repo,{turnKey:"t2",conversationId:"c1",customerAccountId:"u1",messages:[{id:"m2",body:"ok"}]},deterministicDeps());
  assert.equal(result.kind,"owner_review");
  assert.equal(result.unresolvedLines?.length,1);
  assert.equal(repo.materializeCalls,0);
  assert.equal(repo.session.salesOrderId,null);
});

Deno.test("owner review is back-office only and is never enqueued as customer reply",()=>{
  assert.equal(shouldEnqueueCustomerReply({kind:"owner_review"}),false);
  assert.equal(shouldEnqueueCustomerReply({kind:"ignore"}),false);
  assert.equal(shouldEnqueueCustomerReply({kind:"order_update"}),true);
  assert.equal(shouldEnqueueCustomerReply({kind:"clarification"}),true);
});
