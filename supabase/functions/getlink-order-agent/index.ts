import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { TURN_DEBOUNCE_MS } from "./rules.ts";
import { MARKET_MAX_AGE_MS } from "./commerce.ts";
import { STORE_ALIAS_PROMOTION_CUSTOMERS } from "./matcher.ts";
import { createOrderAgentHandler, type OrderAgentMode } from "./runtime.ts";
import { claimTurn, processLiveRows, processShadowRows, recoverySweep } from "./orchestrator.ts";

const SUPABASE_URL=String(Deno.env.get("SUPABASE_URL")||"").trim();
const SERVICE_ROLE=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"").trim();
const db=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,Math.max(0,ms)));

type RuntimeConfig={
  mode:OrderAgentMode;
  modelName:string;
  webhookSecret:string;
  openaiApiKey:string;
  pilotCustomerIds:Set<string>;
};

function clean(value:unknown):string{return String(value??"").trim();}

async function loadRuntimeConfig():Promise<RuntimeConfig>{
  const {data,error}=await db.rpc("getlink_ai_runtime_config");
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  const requested=clean(row?.mode).toLowerCase();
  const modelName=clean(row?.model_name);
  const webhookSecret=clean(row?.webhook_secret);
  const openaiApiKey=clean(row?.openai_api_key);
  const ids=Array.isArray(row?.pilot_customer_ids)?row.pilot_customer_ids:[];
  const pilotCustomerIds=new Set(ids.map((value:unknown)=>clean(value)).filter(Boolean));
  const readyForPilot=Boolean(modelName&&webhookSecret&&openaiApiKey&&pilotCustomerIds.size>0);
  const mode:OrderAgentMode=requested==="pilot"&&readyForPilot?"pilot":"off";
  return {
    mode,
    modelName,
    webhookSecret,
    openaiApiKey,
    pilotCustomerIds,
  };
}

function unavailable(error:unknown):Response{
  console.error("order-agent runtime config unavailable",error);
  return new Response(JSON.stringify({ok:false,mode:"off",error:"runtime_config_unavailable"}),{
    status:503,
    headers:{"content-type":"application/json; charset=utf-8"},
  });
}

Deno.serve(async (req:Request)=>{
  let config:RuntimeConfig;
  try{config=await loadRuntimeConfig();}
  catch(error){return unavailable(error);}

  const modelCredentials={apiKey:config.openaiApiKey,model:config.modelName};
  const handler=createOrderAgentHandler({
    mode:config.mode,
    webhookSecret:config.webhookSecret,
    pilotCustomerIds:config.pilotCustomerIds,
    sleep,
    claimTurn:(conversationId:string)=>claimTurn(db,conversationId),
    processShadowTurn:(rows)=>processShadowRows(db,rows,modelCredentials),
    processLiveTurn:(rows)=>processLiveRows(db,rows,"pilot",modelCredentials),
    sweep:()=>recoverySweep(db,config.mode,config.pilotCustomerIds,modelCredentials),
    health:()=>({
      database_configured:Boolean(SUPABASE_URL&&SERVICE_ROLE),
      runtime_configured:true,
      webhook_configured:Boolean(config.webhookSecret),
      model_configured:Boolean(config.openaiApiKey&&config.modelName),
      pilot_customer_count:config.pilotCustomerIds.size,
      debounce_ms:TURN_DEBOUNCE_MS,
      market_max_age_ms:MARKET_MAX_AGE_MS,
      alias_promotion_customers:STORE_ALIAS_PROMOTION_CUSTOMERS,
    }),
  });
  return handler(req);
});
