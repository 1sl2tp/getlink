import assert from "node:assert/strict";

async function loadModule(path:string):Promise<any>{
  try{return await import(new URL(path,import.meta.url).href);}
  catch(error){assert.fail(`required training module is missing or invalid: ${path}\n${String(error)}`);}
}

Deno.test("training model uses Gemini Interactions structured JSON",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_llm.ts");
  let requestUrl="";
  let requestHeaders=new Headers();
  let requestBody:any=null;
  const result=await mod.translateTrainingMessageWithModel(
    {customerText:"AKIKO 10",learnedExamples:[],candidates:[{productCode:"HT-000004",productName:"Akiko"}]},
    async(url:string|URL|Request,init?:RequestInit)=>{
      requestUrl=String(url);
      requestHeaders=new Headers(init?.headers);
      requestBody=JSON.parse(String(init?.body||"{}"));
      return new Response(JSON.stringify({
        status:"completed",
        model:"gemini-3.8-flash",
        steps:[{type:"model_output",content:[{type:"text",text:JSON.stringify({
          kind:"order",
          items:[{raw_text:"AKIKO 10",product_name:"Akiko",quantity:10,unit_hint:null,product_code:null,confidence:1}],
          teachings:[],knowledge:[],
          reply_text:"",
        })}]}],
      }),{status:200,headers:{"content-type":"application/json"}});
    },
    {apiKey:"gemini-test-key",model:"gemini-3.8-flash"},
  );
  assert.equal(requestUrl,"https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(requestHeaders.get("x-goog-api-key"),"gemini-test-key");
  assert.equal(requestHeaders.get("authorization"),null);
  assert.equal(requestBody.model,"gemini-3.8-flash");
  assert.equal(requestBody.store,false);
  assert.equal(requestBody.generation_config.thinking_level,"low");
  assert.equal(requestBody.response_format.type,"text");
  assert.equal(requestBody.response_format.mime_type,"application/json");
  assert.equal(requestBody.response_format.schema.type,"object");
  assert.match(requestBody.system_instruction,/tên sản phẩm/i);
  assert.match(String(requestBody.input),/HT-000004/);
  assert.equal(result.kind,"order");
  assert.equal(result.items[0].productName,"Akiko");
  assert.equal(result.items[0].quantity,10);
});

Deno.test("Gemini structured output can split a messy multi-item customer block",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_llm.ts");
  const text="10 thùng indomie 5 thùng miliket 1 sài gòn bấm";
  const result=await mod.translateTrainingMessageWithModel(
    {customerText:text,learnedExamples:[],candidates:[
      {productCode:"HT-000105",productName:"Mi indi"},
      {productCode:"HT-000110",productName:"Mi miket"},
    ]},
    async()=>new Response(JSON.stringify({
      status:"completed",
      steps:[{type:"model_output",content:[{type:"text",text:JSON.stringify({
        kind:"order",
        items:[
          {raw_text:"10 thùng indomie",product_name:"indomie",quantity:10,unit_hint:"thùng",product_code:null,confidence:.98},
          {raw_text:"5 thùng miliket",product_name:"miliket",quantity:5,unit_hint:"thùng",product_code:null,confidence:.98},
          {raw_text:"1 sài gòn bấm",product_name:"sài gòn bấm",quantity:1,unit_hint:null,product_code:null,confidence:.9},
        ],
        teachings:[],knowledge:[],reply_text:"",
      })}]}],
    }),{status:200,headers:{"content-type":"application/json"}}),
    {apiKey:"gemini-test-key",model:"gemini-3.8-flash"},
  );
  assert.equal(result.kind,"order");
  assert.equal(result.items.length,3);
  assert.equal(result.items[0].quantity,10);
  assert.equal(result.items[1].quantity,5);
  assert.equal(result.items[2].productName,"sài gòn bấm");
});

Deno.test("hierarchy knowledge is passed to Gemini with only the relevant parent catalog",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_llm.ts");
  let requestBody:any=null;
  const result=await mod.translateTrainingMessageWithModel(
    {
      customerText:"Probi to : 4 có, 2 ít, 1 vq",
      learnedExamples:[],
      knowledgeRules:[
        {ruleType:"category",ruleText:"Phân tích tên theo Nhóm → Tên đầu tiên → Hãng → Cha → Mẹ → Con → Cháu."},
        {ruleType:"naming",ruleText:"vq = việt quất"},
        {ruleType:"product",ruleText:"Trong Sữa Vinamilk, Probi to là cha; có, ít, vq là các biến thể cùng cha và số đứng trước là số lượng."},
      ],
      candidates:[
        {productCode:"SUA-000044",productName:"Sua probi to mau - dâu"},
        {productCode:"SUA-000045",productName:"Sua probi to mau - it"},
        {productCode:"SUA-000046",productName:"Sua probi to mau - viet quat"},
        {productCode:"SUA-000047",productName:"Sua probi to trang"},
      ],
    },
    async(_url:string|URL|Request,init?:RequestInit)=>{
      requestBody=JSON.parse(String(init?.body||"{}"));
      return new Response(JSON.stringify({
        status:"completed",
        steps:[{type:"model_output",content:[{type:"text",text:JSON.stringify({
          kind:"order",
          items:[
            {raw_text:"4 Probi to có",product_name:"Sua probi to trang",quantity:4,unit_hint:null,product_code:null,confidence:.86},
            {raw_text:"2 Probi to ít",product_name:"Sua probi to mau - it",quantity:2,unit_hint:null,product_code:null,confidence:.99},
            {raw_text:"1 Probi to vq",product_name:"Sua probi to mau - viet quat",quantity:1,unit_hint:null,product_code:null,confidence:.99},
          ],
          teachings:[],knowledge:[],reply_text:"",
        })}]}],
      }),{status:200,headers:{"content-type":"application/json"}});
    },
    {apiKey:"gemini-test-key",model:"gemini-3.8-flash"},
  );
  const sent=String(requestBody.input);
  assert.match(requestBody.system_instruction,/cha.*mẹ.*con.*cháu/i);
  assert.match(sent,/vq = việt quất/i);
  assert.match(sent,/SUA-000044/);
  assert.match(sent,/SUA-000047/);
  assert.equal(result.items.length,3);
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

Deno.test("multiline order parser keeps each line and its own quantity",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_resolver.ts");
  const text="2 probi be mau dua\n3 probi be mau it\n4 probi lo 700ml";
  assert.equal(mod.parseSimpleOrderLine(text),null);
  assert.deepEqual(mod.parseSimpleOrderLines(text),[
    {rawText:"2 probi be mau dua",productText:"probi be mau dua",quantity:2,unitHint:null},
    {rawText:"3 probi be mau it",productText:"probi be mau it",quantity:3,unitHint:null},
    {rawText:"4 probi lo 700ml",productText:"probi lo 700ml",quantity:4,unitHint:null},
  ]);
});

Deno.test("grouped variant parser keeps shared parent and child quantities",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_resolver.ts");
  assert.deepEqual(mod.parseGroupedVariantOrder("Probi to : 4 có, 2 ít, 1 vq"),{
    parentText:"Probi to",
    items:[
      {quantity:4,label:"có"},
      {quantity:2,label:"ít"},
      {quantity:1,label:"vq"},
    ],
  });
});

Deno.test("learned naming rules expand generic aliases and parent scope excludes unrelated catalog",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/training_resolver.ts");
  const rules=[
    {ruleType:"naming",ruleText:"vq = việt quất"},
    {ruleType:"naming",ruleText:"rejoice = joy"},
  ];
  assert.equal(mod.applyKnowledgeNaming("Probi to vq",rules),"probi to viet quat");
  assert.equal(mod.applyKnowledgeNaming("gội rejoice 650g",rules),"goi joy 650g");
  const catalog=[
    {productCode:"SUA-000044",productName:"Sua probi to mau - dâu"},
    {productCode:"SUA-000045",productName:"Sua probi to mau - it"},
    {productCode:"SUA-000046",productName:"Sua probi to mau - viet quat"},
    {productCode:"SUA-000047",productName:"Sua probi to trang"},
    {productCode:"HU-000031",productName:"Dau goi joy 630"},
  ];
  assert.deepEqual(
    mod.scopeCatalogByParent("Probi to",catalog).map((row:any)=>row.productCode),
    ["SUA-000044","SUA-000045","SUA-000046","SUA-000047"],
  );
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

Deno.test("reply normalization preserves one product per line",async()=>{
  const mod=await loadModule("../supabase/functions/getlink-order-agent/reply_text.ts");
  assert.equal(
    mod.normalizeReplyText("  Mi indi × 10 thùng  \n  Mi miket × 5 thùng\r\nDau nep 2 × 5 thùng  "),
    "Mi indi × 10 thùng\nMi miket × 5 thùng\nDau nep 2 × 5 thùng",
  );
});
