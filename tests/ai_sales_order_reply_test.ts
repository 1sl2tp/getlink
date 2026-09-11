import assert from "node:assert/strict";

async function loadReply(){
  try{return await import("../supabase/functions/getlink-order-agent/reply.ts");}
  catch(error){assert.fail(`reply module missing or invalid: ${String(error)}`);}
}
async function loadChat(){
  try{return await import("../supabase/functions/getlink-order-agent/chat.ts");}
  catch(error){assert.fail(`chat module missing or invalid: ${String(error)}`);}
}

Deno.test("draft reply uses authoritative line prices and total",async()=>{
  const {composeReply}=await loadReply();
  const reply=composeReply({
    kind:"order_update",
    lines:[
      {productName:"Milo 180ml",quantity:3,quotedPriceVnd:12000},
      {productName:"Probi bé màu",quantity:2,quotedPriceVnd:52000},
    ],
    roundSuggestion:null,
  });
  assert.equal(reply.replyKind,"draft_update");
  assert.match(reply.body,/Milo 180ml × 3/);
  assert.match(reply.body,/Probi bé màu × 2/);
  assert.match(reply.body,/140\.000/);
  assert.doesNotMatch(reply.body,/undefined|NaN/);
});

Deno.test("price reply reports truthful fresh market position from supplied facts",async()=>{
  const {composeReply}=await loadReply();
  const reply=composeReply({kind:"price",facts:{
    productName:"Mì Hảo Hảo 30 gói",unitLabel:"thùng",unitPriceVnd:188000,
    marketComparison:{position:"store_higher",referencePriceVnd:185000,differenceVnd:3000,differencePercent:1.62},
  }});
  assert.equal(reply.replyKind,"price");
  assert.match(reply.body,/188\.000/);
  assert.match(reply.body,/185\.000/);
  assert.match(reply.body,/cao hơn 3\.000/);
  assert.match(reply.body,/cân đối/);
});

Deno.test("clarification asks only the missing color politely",async()=>{
  const {composeReply}=await loadReply();
  const reply=composeReply({kind:"clarification",facts:{productName:"Bi bé",missingAttribute:"color"}});
  assert.equal(reply.replyKind,"clarification");
  assert.match(reply.body,/Dạ/);
  assert.match(reply.body,/Bi bé/);
  assert.match(reply.body,/màu gì/);
  assert.ok(reply.body.length<180);
});

Deno.test("round suggestion is a separate gentle follow-up",async()=>{
  const {composeReply}=await loadReply();
  const reply=composeReply({kind:"order_update",lines:[{productName:"Hảo Hảo",quantity:17,quotedPriceVnd:188000}],roundSuggestion:{target:20,gap:3}});
  const followUp=reply.followUp;
  assert.ok(followUp);
  assert.equal(followUp.replyKind,"round_suggestion");
  assert.match(followUp.body,/thêm.*3 thùng/);
  assert.match(followUp.body,/tròn 20/);
});

Deno.test("enqueueReply uses outbox uniqueness and flush uses ai client id",async()=>{
  const {enqueueReply,flushReply}=await loadChat();
  const calls:any[]=[];
  const db:any={
    from(table:string){
      assert.equal(table,"getlink_ai_reply_outbox");
      return {
        upsert(row:any,opts:any){
          calls.push({kind:"upsert",row,opts});
          return {select(){return {single:async()=>({data:{id:"o1",...row,status:"pending"},error:null})};}};
        },
      };
    },
    async rpc(name:string,args:any){
      calls.push({kind:"rpc",name,args});
      return {data:"chat-message-1",error:null};
    },
  };
  const row=await enqueueReply(db,"s1","t1","draft_update","Dạ em ghi rồi ạ");
  assert.equal(row.id,"o1");
  assert.equal(calls[0].opts.onConflict,"session_id,turn_key,reply_kind");
  const messageId=await flushReply(db,row);
  assert.equal(messageId,"chat-message-1");
  assert.equal(calls[1].name,"getlink_ai_send_chat_message");
  assert.equal(calls[1].args.p_client_id,"ai:o1");
});
