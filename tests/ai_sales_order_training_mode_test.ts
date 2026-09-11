import assert from "node:assert/strict";

async function loadModel():Promise<any>{
  try{return await import("../supabase/functions/getlink-order-agent/llm.ts");}
  catch(error){assert.fail(`model module missing or invalid: ${String(error)}`);}
}

async function loadTraining():Promise<any>{
  try{return await import("../supabase/functions/getlink-order-agent/training.ts");}
  catch(error){assert.fail(`training module missing or invalid: ${String(error)}`);}
}

Deno.test("Groq training translator receives learned examples but not the full catalog",async()=>{
  const {translateTrainingMessageWithModel}=await loadModel();
  let requestBody:any=null;
  const result=await translateTrainingMessageWithModel({
    customerText:"akiko 10",
    catalog:[
      {productCode:"HT-AKIKO",productName:"Akiko"},
      {productCode:"HT-MIKET",productName:"Mi miket"},
    ],
    learnedExamples:[
      {rawText:"akiko 5",productName:"Akiko",productCode:"HT-AKIKO",quantity:5,unitHint:null,status:"auto"},
    ],
  },async (_url:string,init:RequestInit)=>{
    requestBody=JSON.parse(String(init.body||"{}"));
    return new Response(JSON.stringify({
      status:"completed",
      output_text:JSON.stringify({
        kind:"order",
        items:[{raw_text:"akiko 10",product_name:"Akiko",quantity:10,unit_hint:null,product_code:null,confidence:0.99}],
        teachings:[],
        reply_text:"",
      }),
    }),{status:200,headers:{"content-type":"application/json"}});
  },{apiKey:"groq-test-key",model:"qwen/qwen3.8-27b"});

  assert.equal(result.kind,"order");
  assert.equal(result.items[0].productName,"Akiko");
  assert.equal(result.items[0].quantity,10);
  const prompt=JSON.stringify(requestBody);
  assert.match(prompt,/learned_examples/);
  assert.match(prompt,/akiko 5/i);
  assert.doesNotMatch(prompt,/HT-MIKET/);
  assert.doesNotMatch(prompt,/"catalog"/);
});

Deno.test("name then quantity is canonicalized only by an exact catalog match",async()=>{
  const {processTrainingMessage}=await loadTraining();
  const saved:any[]=[];
  const result=await processTrainingMessage({
    customerAccountId:"u-test",conversationId:"c-test",messageId:"m1",body:"akiko 10",
  },{
    loadCatalog:async()=>[{productCode:"HT-AKIKO",productName:"Akiko"}],
    loadExamples:async()=>[],
    translate:async()=>({kind:"order",items:[{rawText:"akiko 10",productName:"akiko",quantity:10,unitHint:null,productCode:null,confidence:0.99}],teachings:[],replyText:""}),
    saveExample:async(example:any)=>{saved.push(example);},
  });
  assert.equal(result.reply,"Akiko × 10");
  assert.equal(saved.length,1);
  assert.equal(saved[0].productCode,"HT-AKIKO");
  assert.equal(saved[0].productName,"Akiko");
  assert.equal(saved[0].quantity,10);
});

Deno.test("quantity then name is learned by Groq without a server word-order parser",async()=>{
  const {processTrainingMessage}=await loadTraining();
  const saved:any[]=[];
  const result=await processTrainingMessage({
    customerAccountId:"u-test",conversationId:"c-test",messageId:"m2",body:"10 akiko",
  },{
    loadCatalog:async()=>[{productCode:"HT-AKIKO",productName:"Akiko"}],
    loadExamples:async()=>[{rawText:"akiko 10",productName:"Akiko",productCode:"HT-AKIKO",quantity:10,unitHint:null,status:"auto"}],
    translate:async(input:any)=>{
      assert.equal(input.customerText,"10 akiko");
      assert.equal(input.learnedExamples[0].rawText,"akiko 10");
      return {kind:"order",items:[{rawText:"10 akiko",productName:"Akiko",quantity:10,unitHint:null,productCode:null,confidence:0.99}],teachings:[],replyText:""};
    },
    saveExample:async(example:any)=>{saved.push(example);},
  });
  assert.equal(result.reply,"Akiko × 10");
  assert.equal(saved.length,1);
  assert.equal(saved[0].rawText,"10 akiko");
  assert.equal(saved[0].quantity,10);
});

Deno.test("a similar catalog name is suggested but never auto-selected or learned",async()=>{
  const {processTrainingMessage}=await loadTraining();
  const saved:any[]=[];
  const result=await processTrainingMessage({
    customerAccountId:"u-test",conversationId:"c-test",messageId:"m3",body:"5 thùng miliket",
  },{
    loadCatalog:async()=>[
      {productCode:"HT-MIKET",productName:"Mi miket"},
      {productCode:"HT-MILO",productName:"Sua milo"},
    ],
    loadExamples:async()=>[],
    translate:async()=>({kind:"order",items:[{rawText:"5 thùng miliket",productName:"Miliket",quantity:5,unitHint:"thùng",productCode:null,confidence:0.86}],teachings:[],replyText:""}),
    saveExample:async(example:any)=>{saved.push(example);},
  });
  assert.equal(result.reply,"Có phải Mi miket × 5 thùng không?\n1. Đúng\n2. Sai / bỏ qua");
  assert.equal(saved.length,0);
  assert.ok(result.pendingConfirmation);
  assert.equal(result.pendingConfirmation.productCode,"HT-MIKET");
  assert.equal(result.pendingConfirmation.rawText,"5 thùng miliket");
});

Deno.test("an explicit teaching message stores a corrected exact catalog mapping",async()=>{
  const {processTrainingMessage}=await loadTraining();
  const saved:any[]=[];
  const result=await processTrainingMessage({
    customerAccountId:"u-test",conversationId:"c-test",messageId:"m-correction",body:"miliket là Mi miket",
  },{
    loadCatalog:async()=>[{productCode:"HT-MIKET",productName:"Mi miket"}],
    loadExamples:async()=>[],
    translate:async()=>({kind:"teaching",items:[],teachings:[{rawText:"miliket",productName:"Mi miket",productCode:null}],replyText:""}),
    saveExample:async(example:any)=>{saved.push(example);},
  });
  assert.equal(result.reply,"miliket → Mi miket");
  assert.equal(saved.length,1);
  assert.equal(saved[0].status,"corrected");
  assert.equal(saved[0].productCode,"HT-MIKET");
});
