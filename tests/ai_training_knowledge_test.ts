import assert from "node:assert/strict";

async function loadModule(path:string):Promise<any>{
  try{return await import(new URL(path,import.meta.url).href);}
  catch(error){assert.fail(`required training module is missing or invalid: ${path}\n${String(error)}`);}
}

Deno.test("Gemini can classify explicit reusable teaching as knowledge and receives stored rules",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_llm.ts");
  let requestBody:any=null;
  const result=await mod.translateTrainingMessageWithModel(
    {
      customerText:"Luôn trả về Tên sản phẩm + số lượng. Dầu ăn 1l, 2l thường là chai.",
      learnedExamples:[],
      candidates:[],
      knowledgeRules:[
        {ruleType:"behavior",ruleText:"Luôn trả về tên sản phẩm chuẩn của cửa hàng kèm số lượng."},
      ],
    },
    async(_url:string|URL|Request,init?:RequestInit)=>{
      requestBody=JSON.parse(String(init?.body||"{}"));
      return new Response(JSON.stringify({
        status:"completed",
        steps:[{type:"model_output",content:[{type:"text",text:JSON.stringify({
          kind:"knowledge",
          items:[],
          teachings:[],
          knowledge:[
            {rule_type:"behavior",rule_text:"Luôn trả về tên sản phẩm chuẩn của cửa hàng kèm số lượng."},
            {rule_type:"unit",rule_text:"Dầu ăn dung tích 1L hoặc 2L thường dùng đơn vị chai."},
          ],
          reply_text:"",
        })}]}],
      }),{status:200,headers:{"content-type":"application/json"}});
    },
    {apiKey:"gemini-test-key",model:"gemini-3.8-flash"},
  );

  assert.match(String(requestBody.input),/Luôn trả về tên sản phẩm chuẩn của cửa hàng kèm số lượng/);
  assert.match(requestBody.system_instruction,/kiến thức|quy tắc/i);
  assert.equal(result.kind,"knowledge");
  assert.equal(result.knowledge.length,2);
  assert.deepEqual(result.knowledge[1],{
    ruleType:"unit",
    ruleText:"Dầu ăn dung tích 1L hoặc 2L thường dùng đơn vị chai.",
  });
});

Deno.test("knowledge persistence deduplicates equivalent rules and writes customer-scoped memory",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_knowledge.ts");
  const writes:any[]=[];
  const db={
    from(table:string){
      assert.equal(table,"getlink_ai_knowledge_rules");
      return {
        async upsert(rows:any[],options:any){writes.push({rows,options});return {error:null};},
      };
    },
  };

  await mod.saveKnowledgeRules(db,{
    customerAccountId:"customer-1",
    sourceMessageId:"message-1",
    rules:[
      {ruleType:"behavior",ruleText:"Luôn trả về Tên sản phẩm + số lượng."},
      {ruleType:"behavior",ruleText:"  luôn   trả về tên sản phẩm + số lượng  "},
      {ruleType:"unit",ruleText:"Dầu ăn 1L, 2L thường là chai."},
    ],
  });

  assert.equal(writes.length,1);
  assert.equal(writes[0].rows.length,2);
  assert.equal(writes[0].options.onConflict,"customer_account_id,rule_normalized");
  assert.deepEqual(writes[0].rows.map((row:any)=>({
    customer_account_id:row.customer_account_id,
    rule_type:row.rule_type,
    rule_text:row.rule_text,
    rule_normalized:row.rule_normalized,
    source_message_id:row.source_message_id,
    is_active:row.is_active,
  })),[
    {
      customer_account_id:"customer-1",
      rule_type:"behavior",
      rule_text:"Luôn trả về Tên sản phẩm + số lượng.",
      rule_normalized:"luon tra ve ten san pham + so luong.",
      source_message_id:"message-1",
      is_active:true,
    },
    {
      customer_account_id:"customer-1",
      rule_type:"unit",
      rule_text:"Dầu ăn 1L, 2L thường là chai.",
      rule_normalized:"dau an 1l, 2l thuong la chai.",
      source_message_id:"message-1",
      is_active:true,
    },
  ]);
});
