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
