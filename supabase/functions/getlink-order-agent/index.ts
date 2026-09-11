import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { TURN_DEBOUNCE_MS } from "./rules.ts";
import { MARKET_MAX_AGE_MS } from "./commerce.ts";
import { STORE_ALIAS_PROMOTION_CUSTOMERS } from "./matcher.ts";
import { createOrderAgentHandler, type OrderAgentMode } from "./runtime.ts";
import { claimTurn, processLiveRows, processShadowRows, recoverySweep } from "./orchestrator.ts";

const SUPABASE_URL=String(Deno.env.get("SUPABASE_URL")||"").trim();
const SERVICE_ROLE=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"").trim();
const WEBHOOK_SECRET=String(Deno.env.get("ORDER_AGENT_WEBHOOK_SECRET")||"").trim();
const OPENAI_KEY=String(Deno.env.get("OPENAI_API_KEY")||"").trim();
const MODEL=String(Deno.env.get("ORDER_AGENT_MODEL")||"").trim();
const requestedMode=String(Deno.env.get("ORDER_AGENT_MODE")||"off").trim().toLowerCase();
export const ORDER_AGENT_MODE:OrderAgentMode=(new Set(["off","shadow","pilot","on"]).has(requestedMode)?requestedMode:"off") as OrderAgentMode;
const PILOT_CUSTOMER_IDS=new Set(
  String(Deno.env.get("ORDER_AGENT_PILOT_CUSTOMER_IDS")||"")
    .split(",").map(x=>x.trim()).filter(Boolean),
);

const db=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,Math.max(0,ms)));

const handler=createOrderAgentHandler({
  mode:ORDER_AGENT_MODE,
  webhookSecret:WEBHOOK_SECRET,
  pilotCustomerIds:PILOT_CUSTOMER_IDS,
  sleep,
  claimTurn:(conversationId:string)=>claimTurn(db,conversationId),
  processShadowTurn:(rows)=>processShadowRows(db,rows),
  processLiveTurn:(rows)=>processLiveRows(db,rows,ORDER_AGENT_MODE==="pilot"?"pilot":"on"),
  sweep:()=>recoverySweep(db,ORDER_AGENT_MODE,PILOT_CUSTOMER_IDS),
  health:()=>({
    database_configured:Boolean(SUPABASE_URL&&SERVICE_ROLE),
    webhook_configured:Boolean(WEBHOOK_SECRET),
    model_configured:Boolean(OPENAI_KEY&&MODEL),
    pilot_customer_count:PILOT_CUSTOMER_IDS.size,
    debounce_ms:TURN_DEBOUNCE_MS,
    market_max_age_ms:MARKET_MAX_AGE_MS,
    alias_promotion_customers:STORE_ALIAS_PROMOTION_CUSTOMERS,
  }),
});

Deno.serve(handler);
