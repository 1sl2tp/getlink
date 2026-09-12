import assert from "node:assert/strict";
import { processDbTrainingMessage } from "../supabase/functions/getlink-order-agent/training.ts";

function noDataDb(){
  return {
    from(){
      throw new Error("input-only parsing must not touch data");
    },
  };
}

Deno.test("input-only single item returns raw name and quantity without asking or touching data",async()=>{
  const result=await processDbTrainingMessage(noDataDb(),{
    customerAccountId:"customer-1",
    conversationId:"conversation-1",
    messageId:"message-1",
    body:"1 cung",
  });

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
