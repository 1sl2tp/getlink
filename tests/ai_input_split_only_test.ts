import assert from "node:assert/strict";
import { processDbTrainingMessage } from "../supabase/functions/getlink-order-agent/training.ts";

function noDataDb(){
  return {
    from(){
      throw new Error("input-only parsing must not touch data");
    },
  };
}

function message(body:string,id="message-1"){
  return {
    customerAccountId:"customer-1",
    conversationId:"conversation-1",
    messageId:id,
    body,
  };
}

Deno.test("input-only single item returns raw name and quantity without asking or touching data",async()=>{
  const result=await processDbTrainingMessage(noDataDb(),message("1 cung"));

  assert.equal(result.reply,"cung × 1");
  assert.equal(result.translation.kind,"order");
  assert.deepEqual(result.translation.items,[{
    rawText:"1 cung",
    productName:"cung",
    productCode:null,
    quantity:1,
    unitHint:null,
    confidence:1,
  }]);
});

Deno.test("explicit slash separators split independent raw items without mapping names",async()=>{
  const result=await processDbTrainingMessage(noDataDb(),message("cung 1 / det 1 / mem 1","message-2"));

  assert.equal(result.reply,"cung × 1\ndet × 1\nmem × 1");
  assert.equal(result.translation.kind,"order");
  assert.deepEqual(result.translation.items.map((item:any)=>({
    productName:item.productName,
    quantity:item.quantity,
    productCode:item.productCode,
  })),[
    {productName:"cung",quantity:1,productCode:null},
    {productName:"det",quantity:1,productCode:null},
    {productName:"mem",quantity:1,productCode:null},
  ]);
});

Deno.test("multiple quantity clusters without a separator stay silent instead of guessing",async()=>{
  const result=await processDbTrainingMessage(noDataDb(),message("cung 1 det 1 mem 1","message-3"));

  assert.equal(result.reply,"");
  assert.equal(result.translation.kind,"conversation");
  assert.deepEqual(result.translation.items,[]);
});
