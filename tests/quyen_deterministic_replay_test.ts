import assert from "node:assert/strict";

async function loadDeterministic():Promise<any>{
  try{return await import("../supabase/functions/getlink-order-agent/deterministic.ts");}
  catch(error){assert.fail(`deterministic parser missing or invalid: ${String(error)}`);}
}

Deno.test("Quyen replay expands Probi shorthand into deterministic catalog lookup names",async()=>{
  const {emptyOrderContext,parseCustomerOrderText}=await loadDeterministic();
  const result=parseCustomerOrderText("Probi to : 3 có, 1 ít, 1 vq",emptyOrderContext());
  assert.deepEqual(result.items.map((item:any)=>[item.lookupText,item.quantity]),[
    ["Sua probi to trang",3],
    ["Sua probi to mau - it",1],
    ["Sua probi to mau - viet quat",1],
  ]);
  assert.equal(result.context.family,"probi_to");
  assert.deepEqual(result.unresolved,[]);
});

Deno.test("Quyen replay keeps milk-yogurt context across short continuation messages",async()=>{
  const {emptyOrderContext,parseCustomerOrderText}=await loadDeterministic();
  const first=parseCustomerOrderText("5 chua không đường",emptyOrderContext());
  assert.deepEqual(first.items.map((item:any)=>[item.lookupText,item.quantity]),[["Sua chua khong",5]]);
  assert.equal(first.context.family,"sua_chua");

  const second=parseCustomerOrderText("3 ít",first.context);
  assert.deepEqual(second.items.map((item:any)=>[item.lookupText,item.quantity]),[["Sua chua it",3]]);
  assert.equal(second.context.family,"sua_chua");
});

Deno.test("short variant without that customer's context stays unresolved instead of guessing",async()=>{
  const {emptyOrderContext,parseCustomerOrderText}=await loadDeterministic();
  const result=parseCustomerOrderText("5 không",emptyOrderContext());
  assert.deepEqual(result.items,[]);
  assert.deepEqual(result.unresolved,["5 không"]);
});

Deno.test("Quyen replay maps explicit tobacco shorthand without leaking yogurt context",async()=>{
  const {emptyOrderContext,parseCustomerOrderText}=await loadDeterministic();
  const first=parseCustomerOrderText("1 thăng long mềm",emptyOrderContext());
  assert.deepEqual(first.items.map((item:any)=>[item.lookupText,item.quantity,item.unitHint]),[["Mềm",1,"cây"]]);
  const second=parseCustomerOrderText("25 sài gòn xanh",first.context);
  assert.deepEqual(second.items.map((item:any)=>[item.lookupText,item.quantity,item.unitHint]),[["SG xanh",25,"cây"]]);
  const third=parseCustomerOrderText("1 sài gòn dưa",second.context);
  assert.deepEqual(third.items.map((item:any)=>[item.lookupText,item.quantity,item.unitHint]),[["SG melon",1,"cây"]]);
});

Deno.test("Quyen replay understands quantity-first Milo shorthand",async()=>{
  const {emptyOrderContext,parseCustomerOrderText}=await loadDeterministic();
  const result=parseCustomerOrderText("10 milo ít đường to",emptyOrderContext());
  assert.deepEqual(result.items.map((item:any)=>[item.lookupText,item.quantity,item.unitHint]),[["Sua milo to it",10,"thùng"]]);
});
