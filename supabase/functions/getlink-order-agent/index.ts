import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { TURN_DEBOUNCE_MS } from "./rules.ts";
import { MARKET_MAX_AGE_MS } from "./commerce.ts";
import { STORE_ALIAS_PROMOTION_CUSTOMERS } from "./matcher.ts";

const SUPABASE_URL=String(Deno.env.get("SUPABASE_URL")||"");
const SERVICE_ROLE=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
const db=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});

export const ORDER_AGENT_MODE=String(Deno.env.get("ORDER_AGENT_MODE")||"off").toLowerCase();

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8"},
  });
}

Deno.serve(async (req:Request)=>{
  if(req.method==="GET"){
    return json({
      ok:true,
      mode:ORDER_AGENT_MODE,
      debounce_ms:TURN_DEBOUNCE_MS,
      market_max_age_ms:MARKET_MAX_AGE_MS,
      alias_promotion_customers:STORE_ALIAS_PROMOTION_CUSTOMERS,
    });
  }
  if(ORDER_AGENT_MODE==="off")return json({ok:true,mode:"off",processed:false},202);

  // Runtime processing is introduced in later TDD tasks. Keeping the function
  // deployable in off mode lets schema and deterministic modules verify first.
  void db;
  return json({ok:false,error:"agent_runtime_not_enabled"},503);
});
