import assert from "node:assert/strict";
import { processDbTrainingMessage } from "../supabase/functions/getlink-order-agent/training.ts";
import { parseInputOnly } from "../supabase/functions/getlink-order-agent/input_only.ts";

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

Deno.test("quantity at either outer edge preserves numeric labels inside the product name",async()=>{
  const cases=[
    ["sim 1 2","sim 1 × 2"],
    ["2 sim 1","sim 1 × 2"],
    ["2 Sim 1","sim 1 × 2"],
    ["sim 2","sim × 2"],
    ["ngua 2","ngua × 2"],
    ["sim 1 den 2 3","sim 1 den 2 × 3"],
    ["3 sim 1 den 2","sim 1 den 2 × 3"],
  ] as const;

  for(let i=0;i<cases.length;i++){
    const [body,reply]=cases[i];
    const result=await processDbTrainingMessage(noDataDb(),message(body,`edge-${i}`));
    assert.equal(result.reply,reply,body);
    assert.equal(result.translation.kind,"order",body);
    assert.equal(result.translation.items.length,1,body);
  }
});

Deno.test("pilot runtime parser stays raw and does not emit cigarette unit teaching",()=>{
  const cases=[
    [
      "1 cung, 1 mem, 1 det, 1 melon, 1 sg bam",
      "cung × 1\nmem × 1\ndet × 1\nmelon × 1\nsg bam × 1",
    ],
    [
      "1 cung, 1 mem, 1 det, 1 sai gon bam",
      "cung × 1\nmem × 1\ndet × 1\nsai gon bam × 1",
    ],
  ] as const;

  for(const [body,reply] of cases){
    const result=parseInputOnly(body);
    assert.equal(result.kind,"order",body);
    assert.equal(result.reply,reply,body);
    assert.equal(result.reply.includes("thùng"),false,body);
    assert.equal(result.reply.includes("cây"),false,body);
    assert.equal(result.reply.includes("="),false,body);
  }
});

Deno.test("pilot runtime parser is silent for unseparated multi-item and teaching-shaped text",()=>{
  for(const body of [
    "cung 1 det 1 mem 1",
    "1 cung 1 det 1 mem",
    "1 Sg bam 1 Cung — 1 = thùng, 0 = cây",
  ]){
    const result=parseInputOnly(body);
    assert.equal(result.kind,"silent",body);
    assert.equal(result.reply,"",body);
  }
});
