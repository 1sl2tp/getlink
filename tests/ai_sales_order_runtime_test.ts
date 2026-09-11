import assert from "node:assert/strict";

async function loadRuntime(){
  try{return await import("../supabase/functions/getlink-order-agent/runtime.ts");}
  catch(error){assert.fail(`runtime module missing or invalid: ${String(error)}`);}
}

function request(path:string,secret?:string,body:any={}):Request{
  const headers=new Headers({"content-type":"application/json"});
  if(secret)headers.set("x-order-agent-secret",secret);
  return new Request(`https://agent.example${path}`,{method:"POST",headers,body:JSON.stringify(body)});
}

Deno.test("invalid webhook secret is rejected before database access",async()=>{
  const {createOrderAgentHandler}=await loadRuntime();
  let dbTouched=false;
  const handler=createOrderAgentHandler({
    mode:"on",webhookSecret:"secret",pilotCustomerIds:new Set(),
    claimTurn:async()=>{dbTouched=true;return [];},
    processLiveTurn:async()=>{throw new Error("unexpected");},
    processShadowTurn:async()=>{throw new Error("unexpected");},
    sweep:async()=>({claimed:0,flushed:0}),
    health:()=>({}),
    sleep:async()=>{},
  });
  const response=await handler(request("/message","wrong",{conversation_id:"c1"}));
  assert.equal(response.status,401);
  assert.equal(dbTouched,false);
});

Deno.test("off mode acknowledges message without claiming any turn",async()=>{
  const {createOrderAgentHandler}=await loadRuntime();
  let claimed=0;
  const handler=createOrderAgentHandler({
    mode:"off",webhookSecret:"secret",pilotCustomerIds:new Set(),
    claimTurn:async()=>{claimed++;return [];},
    processLiveTurn:async()=>{throw new Error("unexpected");},
    processShadowTurn:async()=>{throw new Error("unexpected");},
    sweep:async()=>({claimed:0,flushed:0}),health:()=>({}),sleep:async()=>{},
  });
  const response=await handler(request("/message","secret",{conversation_id:"c1"}));
  assert.equal(response.status,202);
  assert.equal(claimed,0);
});

Deno.test("message path waits for debounce then atomic claim and exits cleanly when another worker won",async()=>{
  const {createOrderAgentHandler}=await loadRuntime();
  const events:string[]=[];
  const handler=createOrderAgentHandler({
    mode:"on",webhookSecret:"secret",pilotCustomerIds:new Set(),
    sleep:async(ms:number)=>{events.push(`sleep:${ms}`);},
    claimTurn:async(conversationId:string)=>{events.push(`claim:${conversationId}`);return [];},
    processLiveTurn:async()=>{events.push("process");},processShadowTurn:async()=>{events.push("shadow");},
    sweep:async()=>({claimed:0,flushed:0}),health:()=>({}),
  });
  const response=await handler(request("/message","secret",{conversation_id:"c1"}));
  assert.equal(response.status,200);
  assert.deepEqual(events,["sleep:4000","claim:c1"]);
});

Deno.test("shadow mode analyzes claimed turn but never invokes live mutation/reply path",async()=>{
  const {createOrderAgentHandler}=await loadRuntime();
  const events:string[]=[];
  const turn=[{inbox_id:"i1",message_id:"m1",conversation_id:"c1",customer_account_id:"u1",message_body:"milo 2",message_created_at:"2026-09-12T00:00:00Z",turn_key:"t1"}];
  const handler=createOrderAgentHandler({
    mode:"shadow",webhookSecret:"secret",pilotCustomerIds:new Set(),sleep:async()=>{},
    claimTurn:async()=>turn,
    processLiveTurn:async()=>{events.push("live");},
    processShadowTurn:async(rows:any[])=>{events.push(`shadow:${rows.length}`);},
    sweep:async()=>({claimed:0,flushed:0}),health:()=>({}),
  });
  const response=await handler(request("/message","secret",{conversation_id:"c1"}));
  assert.equal(response.status,200);
  assert.deepEqual(events,["shadow:1"]);
});

Deno.test("pilot mode ignores customers outside pilot allowlist",async()=>{
  const {createOrderAgentHandler}=await loadRuntime();
  let live=0;
  const turn=[{inbox_id:"i1",message_id:"m1",conversation_id:"c1",customer_account_id:"u-not-pilot",message_body:"milo 2",message_created_at:"2026-09-12T00:00:00Z",turn_key:"t1"}];
  const handler=createOrderAgentHandler({
    mode:"pilot",webhookSecret:"secret",pilotCustomerIds:new Set(["u-pilot"]),sleep:async()=>{},claimTurn:async()=>turn,
    processLiveTurn:async()=>{live++;},processShadowTurn:async()=>{},sweep:async()=>({claimed:0,flushed:0}),health:()=>({}),
  });
  const response=await handler(request("/message","secret",{conversation_id:"c1"}));
  assert.equal(response.status,200);
  assert.equal(live,0);
});

Deno.test("sweep requires secret and invokes recovery path",async()=>{
  const {createOrderAgentHandler}=await loadRuntime();
  let sweeps=0;
  const handler=createOrderAgentHandler({
    mode:"on",webhookSecret:"secret",pilotCustomerIds:new Set(),sleep:async()=>{},claimTurn:async()=>[],
    processLiveTurn:async()=>{},processShadowTurn:async()=>{},
    sweep:async()=>{sweeps++;return {claimed:2,flushed:1};},health:()=>({}),
  });
  const response=await handler(request("/sweep","secret"));
  assert.equal(response.status,200);
  assert.equal(sweeps,1);
  assert.deepEqual(await response.json(),{ok:true,claimed:2,flushed:1});
});

Deno.test("health exposes booleans and mode but never secret values",async()=>{
  const {createOrderAgentHandler}=await loadRuntime();
  const handler=createOrderAgentHandler({
    mode:"pilot",webhookSecret:"very-secret",pilotCustomerIds:new Set(["u1"]),sleep:async()=>{},claimTurn:async()=>[],
    processLiveTurn:async()=>{},processShadowTurn:async()=>{},sweep:async()=>({claimed:0,flushed:0}),
    health:()=>({model_configured:true,database_configured:true}),
  });
  const response=await handler(new Request("https://agent.example/health"));
  assert.equal(response.status,200);
  const text=await response.text();
  assert.match(text,/"mode":"pilot"/);
  assert.match(text,/"model_configured":true/);
  assert.doesNotMatch(text,/very-secret/);
});
