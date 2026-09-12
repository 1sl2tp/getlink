import assert from "node:assert/strict";

async function loadModule(path:string):Promise<any>{
  try{return await import(new URL(path,import.meta.url).href);}
  catch(error){assert.fail(`required training module is missing or invalid: ${path}\n${String(error)}`);}
}

Deno.test("training model accepts Responses nested output_text instead of requiring top-level output_text",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_llm.ts");
  const result=await mod.translateTrainingMessageWithModel(
    {customerText:"AKIKO 10",learnedExamples:[]},
    async()=>new Response(JSON.stringify({
      status:"completed",
      output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({
        kind:"order",
        items:[{raw_text:"AKIKO 10",product_name:"Akiko",quantity:10,unit_hint:null,product_code:null,confidence:1}],
        teachings:[],
        reply_text:"",
      })}]}],
    }),{status:200,headers:{"content-type":"application/json"}}),
    {apiKey:"test-key",model:"test-model"},
  );
  assert.equal(result.kind,"order");
  assert.equal(result.items[0].productName,"Akiko");
  assert.equal(result.items[0].quantity,10);
});

Deno.test("simple order parser understands quantity, carton unit and product wording",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_resolver.ts");
  assert.deepEqual(mod.parseSimpleOrderLine("5 thùng neptune 2l"),{
    rawText:"5 thùng neptune 2l",
    productText:"neptune 2l",
    quantity:5,
    unitHint:"thùng",
  });
  assert.deepEqual(mod.parseSimpleOrderLine("akiko 10"),{
    rawText:"akiko 10",
    productText:"akiko",
    quantity:10,
    unitHint:null,
  });
});

Deno.test("customer alias translates customer wording to canonical own product",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_resolver.ts");
  const catalog=[
    {productCode:"HT-000105",productName:"Mi indi"},
    {productCode:"HT-000110",productName:"Mi miket"},
    {productCode:"HT-000004",productName:"Akiko"},
  ];
  const aliases=[{aliasNormalized:"indomie",productCode:"HT-000105"}];
  const result=mod.resolveTrainingProduct("indomie",catalog,aliases);
  assert.deepEqual(result,{productCode:"HT-000105",productName:"Mi indi",source:"customer_alias"});
});

Deno.test("unique close typo can resolve to canonical catalog name but ambiguity never guesses",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_resolver.ts");
  const catalog=[
    {productCode:"HT-000110",productName:"Mi miket"},
    {productCode:"HT-000105",productName:"Mi indi"},
  ];
  assert.deepEqual(mod.resolveTrainingProduct("miliket",catalog,[]),{
    productCode:"HT-000110",productName:"Mi miket",source:"fuzzy",
  });
  const ambiguous=[
    {productCode:"X1",productName:"Mi abc 1"},
    {productCode:"X2",productName:"Mi abc 2"},
  ];
  assert.equal(mod.resolveTrainingProduct("mi abc",ambiguous,[]),null);
});

Deno.test("teaching equation learns alias against the canonical side instead of echoing model wording",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_resolver.ts");
  const catalog=[{productCode:"HT-000105",productName:"Mi indi"}];
  assert.deepEqual(mod.resolveTeachingEquation("Mi indi = indomie",catalog),{
    aliasDisplay:"indomie",
    aliasNormalized:"indomie",
    productCode:"HT-000105",
    productName:"Mi indi",
  });
  assert.deepEqual(mod.resolveTeachingEquation("indomie = Mi indi",catalog),{
    aliasDisplay:"indomie",
    aliasNormalized:"indomie",
    productCode:"HT-000105",
    productName:"Mi indi",
  });
});
