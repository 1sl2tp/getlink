import assert from "node:assert/strict";
import { resolveProduct, suggestProductCandidate } from "../supabase/functions/getlink-order-agent/matcher.ts";

function matcherDb(){
  let call=0;
  const catalog=[
    {product_code:"HT-000141",product_name:"Sua milo be",is_active:true,stock_status:"available"},
    {product_code:"HT-000142",product_name:"Sua milo to",is_active:true,stock_status:"available"},
    {product_code:"HT-000143",product_name:"Sua milo to it",is_active:true,stock_status:"available"},
  ];
  return {
    from(_table:string){
      call+=1;
      const callNo=call;
      let truncated=false;
      const q:any={
        select(){return q;},
        eq(){return q;},
        order(){return q;},
        range(){return q;},
        limit(){truncated=true;return q;},
        async maybeSingle(){return {data:null,error:null};},
        then(resolve:(value:any)=>unknown,reject:(reason:any)=>unknown){
          const data=callNo>=4?(truncated?[catalog[2]]:catalog):[];
          return Promise.resolve({data,error:null}).then(resolve,reject);
        },
      };
      return q;
    },
  };
}

function correctionDb(){
  const catalog=[
    {product_code:"HT-MIKET",product_name:"Mi miket",is_active:true,stock_status:"available"},
    {product_code:"HT-MILKET",product_name:"Sua milket",is_active:true,stock_status:"available"},
  ];
  return {
    from(_table:string){
      const q:any={
        select(){return q;},
        eq(){return q;},
        order(){return q;},
        range(){return q;},
        then(resolve:(value:any)=>unknown,reject:(reason:any)=>unknown){
          return Promise.resolve({data:catalog,error:null}).then(resolve,reject);
        },
      };
      return q;
    },
  };
}

Deno.test("fuzzy matcher does not call Milo unique when full catalog has multiple variants",async()=>{
  const result=await resolveProduct(matcherDb(),"customer-test","milo");
  assert.equal(result,null);
});

Deno.test("typo candidate suggests Mi miket for miliket without auto-resolving",async()=>{
  const result=await suggestProductCandidate(correctionDb(),"miliket");
  assert.ok(result);
  assert.equal(result.productCode,"HT-MIKET");
  assert.equal(result.productName,"Mi miket");
  assert.equal(result.requiresConfirmation,true);
  assert.ok(result.confidence>=0.8);
});
