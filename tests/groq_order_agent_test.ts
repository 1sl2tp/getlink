import assert from "node:assert/strict";

async function loadModel():Promise<any>{
  try{return await import("../supabase/functions/getlink-order-agent/llm.ts");}
  catch(error){assert.fail(`model module missing or invalid: ${String(error)}`);}
}

Deno.test("order agent uses Groq Responses API with strict structured output",async()=>{
  const {parseWithModel}=await loadModel();
  let url="";
  let auth="";
  let body:any=null;
  const result=await parseWithModel(
    {customerText:"chị lấy cho chị hai thùng milo nha em"},
    async (requestUrl:string,init:RequestInit)=>{
      url=requestUrl;
      auth=String(new Headers(init.headers).get("authorization")||"");
      body=JSON.parse(String(init.body||"{}"));
      return new Response(JSON.stringify({
        status:"completed",
        output_text:JSON.stringify({
          intent:"add_item",raw_product_text:"milo",quantity:2,unit_hint:"thùng",
          attributes:{color:null,flavor:null,size:null,pack:null,other:null},line_note:"",
          reference_target:null,needs_clarification:false,clarification_question_hint:null,
        }),
      }),{status:200,headers:{"content-type":"application/json"}});
    },
    {apiKey:"groq-test-key",model:"qwen/qwen3.8-27b"},
  );
  assert.equal(url,"https://api.groq.com/openai/v1/responses");
  assert.equal(auth,"Bearer groq-test-key");
  assert.equal(body.model,"qwen/qwen3.8-27b");
  assert.equal(body.store,false);
  assert.equal(body.max_output_tokens,350);
  assert.equal(body.text.format.type,"json_schema");
  assert.equal(body.text.format.strict,true);
  assert.equal(result.intent,"add_item");
  assert.equal(result.quantity,2);
});

Deno.test("Groq model parser can read GROQ_API_KEY from server environment",async()=>{
  const {parseWithModel}=await loadModel();
  const oldGroq=Deno.env.get("GROQ_API_KEY");
  const oldOpenai=Deno.env.get("OPENAI_API_KEY");
  const oldModel=Deno.env.get("ORDER_AGENT_MODEL");
  Deno.env.set("GROQ_API_KEY","groq-env-key");
  Deno.env.delete("OPENAI_API_KEY");
  Deno.env.set("ORDER_AGENT_MODEL","openai/gpt-oss-120b");
  let auth="";
  try{
    await parseWithModel({customerText:"milo lấy 2"},async (_url:string,init:RequestInit)=>{
      auth=String(new Headers(init.headers).get("authorization")||"");
      return new Response(JSON.stringify({
        status:"completed",
        output_text:JSON.stringify({
          intent:"add_item",raw_product_text:"milo",quantity:2,unit_hint:null,
          attributes:{color:null,flavor:null,size:null,pack:null,other:null},line_note:"",
          reference_target:null,needs_clarification:false,clarification_question_hint:null,
        }),
      }),{status:200,headers:{"content-type":"application/json"}});
    });
    assert.equal(auth,"Bearer groq-env-key");
  } finally {
    oldGroq==null?Deno.env.delete("GROQ_API_KEY"):Deno.env.set("GROQ_API_KEY",oldGroq);
    oldOpenai==null?Deno.env.delete("OPENAI_API_KEY"):Deno.env.set("OPENAI_API_KEY",oldOpenai);
    oldModel==null?Deno.env.delete("ORDER_AGENT_MODEL"):Deno.env.set("ORDER_AGENT_MODEL",oldModel);
  }
});
