import { TURN_DEBOUNCE_MS } from "./rules.ts";

export type OrderAgentMode="off"|"shadow"|"pilot"|"on";
export type ClaimedInboxRow={
  inbox_id:string;
  message_id:string;
  conversation_id:string;
  customer_account_id:string;
  message_body:string;
  message_created_at:string;
  turn_key:string;
};

export type RuntimeDeps={
  mode:OrderAgentMode;
  webhookSecret:string;
  pilotCustomerIds:Set<string>;
  sleep:(ms:number)=>Promise<void>;
  claimTurn:(conversationId:string)=>Promise<ClaimedInboxRow[]>;
  processLiveTurn:(rows:ClaimedInboxRow[])=>Promise<unknown>;
  processShadowTurn:(rows:ClaimedInboxRow[])=>Promise<unknown>;
  sweep:()=>Promise<{claimed:number;flushed:number}>;
  health:()=>Record<string,unknown>;
};

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8"}});
}
function clean(value:unknown){return String(value??"").replace(/\s+/g," ").trim();}
function route(req:Request){
  const parts=new URL(req.url).pathname.split("/").filter(Boolean);
  return "/"+(parts[parts.length-1]||"");
}
function constantTimeEqual(a:string,b:string){
  const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
  if(!x.length||!y.length)return false;
  let diff=x.length^y.length;
  const n=Math.max(x.length,y.length);
  for(let i=0;i<n;i++)diff|=(x[i%x.length]||0)^(y[i%y.length]||0);
  return diff===0;
}
function authorized(req:Request,expected:string){
  return constantTimeEqual(clean(req.headers.get("x-order-agent-secret")),clean(expected));
}
async function readJson(req:Request):Promise<any>{
  try{return await req.json();}catch{return {};}
}

export function createOrderAgentHandler(deps:RuntimeDeps){
  return async function handle(req:Request):Promise<Response>{
    const path=route(req);
    if(req.method==="GET"&&(path==="/health"||path==="/getlink-order-agent"||path==="/")){
      return json({ok:true,mode:deps.mode,...deps.health()});
    }
    if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
    if(path!=="/message"&&path!=="/sweep")return json({ok:false,error:"not_found"},404);
    if(!authorized(req,deps.webhookSecret))return json({ok:false,error:"unauthorized"},401);

    if(path==="/sweep"){
      if(deps.mode==="off")return json({ok:true,claimed:0,flushed:0});
      const result=await deps.sweep();
      return json({ok:true,claimed:Number(result.claimed)||0,flushed:Number(result.flushed)||0});
    }

    if(deps.mode==="off")return json({ok:true,mode:"off",processed:false},202);
    const body=await readJson(req);
    const conversationId=clean(body?.conversation_id);
    if(!conversationId)return json({ok:false,error:"conversation_id_required"},400);

    await deps.sleep(TURN_DEBOUNCE_MS);
    const rows=await deps.claimTurn(conversationId);
    if(!rows.length)return json({ok:true,claimed:0,processed:false});

    const customerId=clean(rows[0]?.customer_account_id);
    if(deps.mode==="pilot"&&!deps.pilotCustomerIds.has(customerId)){
      return json({ok:true,claimed:rows.length,processed:false,reason:"not_pilot_customer"});
    }
    if(deps.mode==="shadow"){
      await deps.processShadowTurn(rows);
      return json({ok:true,claimed:rows.length,processed:true,mode:"shadow"});
    }
    await deps.processLiveTurn(rows);
    return json({ok:true,claimed:rows.length,processed:true,mode:deps.mode});
  };
}
