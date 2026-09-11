import assert from "node:assert/strict";

async function loadModel():Promise<any>{
  try{return await import("../supabase/functions/getlink-order-agent/llm.ts");}
  catch(error){assert.fail(`model module missing or invalid: ${String(error)}`);}
}

async function loadTraining():Promise<any>{
  try{return await import("../supabase/functions/getlink-order-agent/training.ts");}
  catch(error){assert.fail(`training module missing or invalid: ${String(error)}`);}
}

Deno.test("Groq training translator receives catalog plus learned examples and returns all current-message items",async()=>{
  const {translateTrainingMessageWithModel}=await loadModel();
  let requestBody:any=null;
  const result=await translateTrainingMessageWithModel({
    customerText:"2 bịch hướng dương\n5 thùng miliket\nMai có lịch sữa chua ko đấy lão",
    catalog:[
      {productCode:"HT-000173",productName:"Hướng dương"},
      {productCode:"HT-000180",productName:"Mi miket"},
    ],
    learnedExamples:[
      {rawText:"miliket",productName:"Mi miket",productCode:"HT-000180",quantity:5,unitHint:"thùng",status:"corrected"},
    ],
  },async (_url:string,init:RequestInit)=>{
    requestBody=JSON.parse(String(init.body||"{}"));
    return new Response(JSON.stringify({
      status:"completed",
      output_text:JSON.stringify({
        kind:"order",
        items:[
          {raw_text:"2 bịch hướng dương",product_name:"Hướng dương",quantity:2,unit_hint:"bịch",product_code:"HT-000173",confidence:0.99},
          {raw_text:"5 thùng miliket",product_name:"Mi miket",quantity:5,unit_hint:"thùng",product_code:"HT-000180",confidence:0.98},
        ],
        teachings:[],
        reply_text:"",
      }),
    }),{status:200,headers:{"content-type":"application/json"}});
  },{apiKey:"groq-test-key",model:"qwen/qwen3.8-27b"});

  assert.equal(result.kind,"order");
  assert.equal(result.items.length,2);
  assert.equal(result.items[1].productName,"Mi miket");
  assert.equal(result.items[1].quantity,5);
  const prompt=JSON.stringify(requestBody);
  assert.match(prompt,/HT-000180/);
  assert.match(prompt,/miliket/);
  assert.match(prompt,/learned_examples/);
  assert.match(prompt,/catalog/);
});

Deno.test("training mode replies only with products from the current message and saves them as examples",async()=>{
  const {processTrainingMessage}=await loadTraining();
  const saved:any[]=[];
  const result=await processTrainingMessage({
    customerAccountId:"u-test",
    conversationId:"c-test",
    messageId:"m-new",
    body:"2 bịch hướng dương\n5 thùng miliket",
  },{
    loadCatalog:async()=>[
      {productCode:"HT-000173",productName:"Hướng dương"},
      {productCode:"HT-000180",productName:"Mi miket"},
    ],
    loadExamples:async()=>[
      {rawText:"tin cũ",productName:"Sữa TH to",productCode:"HT-OLD",quantity:2,unitHint:null,status:"auto"},
    ],
    translate:async()=>({
      kind:"order",
      items:[
        {rawText:"2 bịch hướng dương",productName:"Hướng dương",quantity:2,unitHint:"bịch",productCode:"HT-000173",confidence:0.99},
        {rawText:"5 thùng miliket",productName:"Mi miket",quantity:5,unitHint:"thùng",productCode:"HT-000180",confidence:0.98},
      ],
      teachings:[],
      replyText:"",
    }),
    saveExample:async(example:any)=>{saved.push(example);},
  });

  assert.equal(result.reply,"Hướng dương × 2 bịch\nMi miket × 5 thùng");
  assert.doesNotMatch(result.reply,/Sữa TH/);
  assert.equal(saved.length,2);
  assert.equal(saved[1].rawText,"5 thùng miliket");
  assert.equal(saved[1].productCode,"HT-000180");
  assert.equal(saved[1].status,"auto");
});

Deno.test("a teaching message stores the correction for Groq instead of changing parser code",async()=>{
  const {processTrainingMessage}=await loadTraining();
  const saved:any[]=[];
  const result=await processTrainingMessage({
    customerAccountId:"u-test",
    conversationId:"c-test",
    messageId:"m-correction",
    body:"miliket là Mi miket",
  },{
    loadCatalog:async()=>[{productCode:"HT-000180",productName:"Mi miket"}],
    loadExamples:async()=>[],
    translate:async()=>({
      kind:"teaching",
      items:[],
      teachings:[{rawText:"miliket",productName:"Mi miket",productCode:"HT-000180"}],
      replyText:"",
    }),
    saveExample:async(example:any)=>{saved.push(example);},
  });

  assert.equal(result.reply,"miliket → Mi miket");
  assert.equal(saved.length,1);
  assert.equal(saved[0].status,"corrected");
  assert.equal(saved[0].rawText,"miliket");
  assert.equal(saved[0].productCode,"HT-000180");
});
