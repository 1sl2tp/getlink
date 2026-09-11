import assert from "node:assert/strict";

async function loadModule(path: string): Promise<any> {
  try {
    return await import(new URL(path, import.meta.url).href);
  } catch (error) {
    assert.fail(`required AI sales-agent module is missing or invalid: ${path}\n${String(error)}`);
  }
}

Deno.test("normalizeCustomerText removes accents and collapses spacing", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/normalize.ts");
  assert.equal(mod.normalizeCustomerText("  Bi bé   màu 2 "), "bi be mau 2");
});

Deno.test("nextRoundSuggestion offers 17 to 20 but not 11 to 15", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/rules.ts");
  assert.deepEqual(mod.nextRoundSuggestion(17), { target: 20, gap: 3 });
  assert.equal(mod.nextRoundSuggestion(11), null);
  assert.equal(mod.nextRoundSuggestion(4), null);
});

Deno.test("marketComparison rejects stale data and classifies fresh comparison", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/commerce.ts");
  const now = new Date("2026-09-12T12:00:00.000Z");
  const store = {
    productCode: "HH30",
    priceVnd: 188000,
    equivalenceKey: "hao-hao:30-goi",
  };
  const fresh = {
    priceVnd: 185000,
    equivalenceKey: "hao-hao:30-goi",
    checkedAt: "2026-09-12T08:00:00.000Z",
  };
  const stale = {
    ...fresh,
    checkedAt: "2026-09-11T11:59:59.000Z",
  };
  assert.equal(mod.marketComparison(store, stale, now), null);
  const result = mod.marketComparison(store, fresh, now);
  assert.equal(result?.position, "store_higher");
  assert.equal(result?.differenceVnd, 3000);
});

Deno.test("resolution source order is customer alias then store alias then canonical then fuzzy", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/matcher.ts");
  assert.ok(mod.resolutionSourceRank("customer_alias") < mod.resolutionSourceRank("store_alias"));
  assert.ok(mod.resolutionSourceRank("store_alias") < mod.resolutionSourceRank("canonical"));
  assert.ok(mod.resolutionSourceRank("canonical") < mod.resolutionSourceRank("fuzzy"));
});

Deno.test("validateParsedIntent accepts structured add item and rejects invalid quantity", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/types.ts");
  const valid = mod.validateParsedIntent({
    intent: "add_item",
    raw_product_text: "bi be mau",
    quantity: 2,
    unit_hint: null,
    attributes: {},
    line_note: "",
    reference_target: null,
    needs_clarification: false,
  });
  assert.equal(valid.intent, "add_item");
  assert.equal(valid.quantity, 2);
  assert.throws(() => mod.validateParsedIntent({ ...valid, quantity: -1 }));
});

Deno.test("parseWithModel uses Responses structured output and returns a validated correction", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/llm.ts");
  const oldKey=Deno.env.get("OPENAI_API_KEY");
  const oldModel=Deno.env.get("ORDER_AGENT_MODEL");
  Deno.env.set("OPENAI_API_KEY","test-key");
  Deno.env.set("ORDER_AGENT_MODEL","test-model");
  let requestBody:any=null;
  try {
    const result=await mod.parseWithModel({
      customerText:"milo lấy 3 thôi",
      recentContext:[{role:"customer",text:"milo 5"}],
      candidates:[{productCode:"MILO180",productName:"Milo 180ml"}],
    },async (_url:string,init:RequestInit)=>{
      requestBody=JSON.parse(String(init.body||"{}"));
      return new Response(JSON.stringify({
        status:"completed",
        output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({
          intent:"change_qty",
          raw_product_text:"milo",
          quantity:3,
          unit_hint:null,
          attributes:{},
          line_note:"",
          reference_target:"MILO180",
          needs_clarification:false,
          clarification_question_hint:null,
        })}]}],
      }),{status:200,headers:{"content-type":"application/json"}});
    });
    assert.equal(result.intent,"change_qty");
    assert.equal(result.quantity,3);
    assert.equal(requestBody.store,false);
    assert.equal(requestBody.text.format.type,"json_schema");
    assert.equal(requestBody.text.format.strict,true);
    assert.equal(requestBody.model,"test-model");
  } finally {
    oldKey==null?Deno.env.delete("OPENAI_API_KEY"):Deno.env.set("OPENAI_API_KEY",oldKey);
    oldModel==null?Deno.env.delete("ORDER_AGENT_MODEL"):Deno.env.set("ORDER_AGENT_MODEL",oldModel);
  }
});

Deno.test("parseWithModel can use server-supplied credentials with empty env", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/llm.ts");
  const oldKey=Deno.env.get("OPENAI_API_KEY");
  const oldModel=Deno.env.get("ORDER_AGENT_MODEL");
  Deno.env.delete("OPENAI_API_KEY");
  Deno.env.delete("ORDER_AGENT_MODEL");
  let auth="";
  let model="";
  try {
    const result=await mod.parseWithModel(
      {customerText:"555 hôm nay bao nhiêu"},
      async (_url:string,init:RequestInit)=>{
        auth=String(new Headers(init.headers).get("authorization")||"");
        model=String(JSON.parse(String(init.body||"{}")).model||"");
        return new Response(JSON.stringify({
          status:"completed",
          output_text:JSON.stringify({
            intent:"price_query",raw_product_text:"555",quantity:null,unit_hint:null,
            attributes:{},line_note:"",reference_target:null,needs_clarification:false,
            clarification_question_hint:null,
          }),
        }),{status:200,headers:{"content-type":"application/json"}});
      },
      {apiKey:"vault-key",model:"vault-model"},
    );
    assert.equal(result.intent,"price_query");
    assert.equal(auth,"Bearer vault-key");
    assert.equal(model,"vault-model");
  } finally {
    oldKey==null?Deno.env.delete("OPENAI_API_KEY"):Deno.env.set("OPENAI_API_KEY",oldKey);
    oldModel==null?Deno.env.delete("ORDER_AGENT_MODEL"):Deno.env.set("ORDER_AGENT_MODEL",oldModel);
  }
});

Deno.test("parseWithModel can interpret an answer to an awaiting color clarification", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/llm.ts");
  const oldKey=Deno.env.get("OPENAI_API_KEY");
  const oldModel=Deno.env.get("ORDER_AGENT_MODEL");
  Deno.env.set("OPENAI_API_KEY","test-key");
  Deno.env.set("ORDER_AGENT_MODEL","test-model");
  try {
    const result=await mod.parseWithModel({
      customerText:"1 đỏ 1 xanh",
      awaitingClarification:{attribute:"color",productName:"Bi bé"},
    },async ()=>new Response(JSON.stringify({
      status:"completed",
      output_text:JSON.stringify({
        intent:"clarification_answer",
        raw_product_text:"",
        quantity:null,
        unit_hint:null,
        attributes:{color:"1 đỏ 1 xanh"},
        line_note:"1 đỏ, 1 xanh",
        reference_target:null,
        needs_clarification:false,
        clarification_question_hint:null,
      }),
    }),{status:200,headers:{"content-type":"application/json"}}));
    assert.equal(result.intent,"clarification_answer");
    assert.equal(result.attributes.color,"1 đỏ 1 xanh");
  } finally {
    oldKey==null?Deno.env.delete("OPENAI_API_KEY"):Deno.env.set("OPENAI_API_KEY",oldKey);
    oldModel==null?Deno.env.delete("ORDER_AGENT_MODEL"):Deno.env.set("ORDER_AGENT_MODEL",oldModel);
  }
});

Deno.test("parseWithModel rejects invalid or incomplete model output", async () => {
  const mod = await loadModule("../supabase/functions/getlink-order-agent/llm.ts");
  const oldKey=Deno.env.get("OPENAI_API_KEY");
  const oldModel=Deno.env.get("ORDER_AGENT_MODEL");
  Deno.env.set("OPENAI_API_KEY","test-key");
  Deno.env.set("ORDER_AGENT_MODEL","test-model");
  try {
    await assert.rejects(
      ()=>mod.parseWithModel({customerText:"cái kia lấy 2"},async ()=>new Response(JSON.stringify({status:"completed",output_text:"not-json"}),{status:200})),
      (error:any)=>error?.code==="model_unavailable_or_invalid",
    );
  } finally {
    oldKey==null?Deno.env.delete("OPENAI_API_KEY"):Deno.env.set("OPENAI_API_KEY",oldKey);
    oldModel==null?Deno.env.delete("ORDER_AGENT_MODEL"):Deno.env.set("ORDER_AGENT_MODEL",oldModel);
  }
});
