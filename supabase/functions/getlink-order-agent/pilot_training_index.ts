import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { processDbTrainingMessage } from "./training.ts";

const SUPABASE_URL=String(Deno.env.get("SUPABASE_URL")||"").trim();
const SERVICE_KEY=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"").trim();
const db=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const clean=(v:unknown)=>String(v??"").replace(/\s+/g," ").trim();
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

async function config(){
  const result=await db.rpc("getlink_ai_runtime_config_gemini");
  if(result.error)throw result.error;
  const row=Array.isArray(result.data)?result.data[0]:result.data;
  const ids=new Set<string>((row?.pilot_customer_ids||[]).map((v:unknown)=>clean(v)));
  return {
    mode:clean(row?.mode)==="pilot"?"pilot":"off",
    model:clean(row?.model_name),
    secret:clean(row?.webhook_secret),
    key:clean(row?.gemini_api_key),
    ids,
  };
}

async function processConversation(conversationId:string,cfg:any){
  const claimed=await db.rpc("getlink_ai_claim_turn",{p_conversation_id:conversationId});
  if(claimed.error)throw claimed.error;
  for(const row of claimed.data||[]){
    if(!cfg.ids.has(String(row.customer_account_id))){
      await db.from("getlink_ai_message_inbox").update({status:"processed",processed_at:new Date().toISOString()}).eq("id",row.inbox_id);
      continue;
    }
    try{
      let session=await db.from("getlink_ai_order_sessions").select("*")
        .eq("conversation_id",conversationId).in("state",["collecting","awaiting_clarification","quoted","confirmed"])
        .order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(session.error)throw session.error;
      if(!session.data){
        session=await db.from("getlink_ai_order_sessions").insert({
          customer_account_id:row.customer_account_id,conversation_id:conversationId,state:"collecting",
        }).select("*").single();
        if(session.error)throw session.error;
      }
      const result=await processDbTrainingMessage(db,{
        customerAccountId:String(row.customer_account_id),conversationId,
        messageId:String(row.message_id),body:String(row.message_body),
      },{apiKey:cfg.key,model:cfg.model});
      const body=clean(result.reply);
      if(body){
        const outbox=await db.from("getlink_ai_reply_outbox").upsert({
          session_id:String(session.data.id),turn_key:`${row.turn_key}:${row.message_id}`,
          reply_kind:result.translation.kind==="order"?"draft_update":"fallback",body,
        },{onConflict:"session_id,turn_key,reply_kind"}).select("*").single();
        if(outbox.error)throw outbox.error;
        const sent=await db.rpc("getlink_ai_send_chat_message",{
          p_outbox_id:String(outbox.data.id),p_body:body,p_client_id:`ai:${outbox.data.id}`,
        });
        if(sent.error)throw sent.error;
      }
      await db.from("getlink_ai_message_inbox").update({
        status:"processed",processed_at:new Date().toISOString(),last_error:null,
      }).eq("id",row.inbox_id);
    }catch(error){
      await db.from("getlink_ai_message_inbox").update({
        status:"failed",processed_at:new Date().toISOString(),last_error:String(error).slice(0,500),
      }).eq("id",row.inbox_id);
    }
  }
  return (claimed.data||[]).length;
}

Deno.serve(async req=>{
  const cfg=await config();
  const url=new URL(req.url);
  if(req.method==="GET")return new Response(JSON.stringify({ok:true,mode:cfg.mode,training_only:true,name_translation:true,provider:"gemini",model:cfg.model,model_configured:Boolean(cfg.key&&cfg.model)}),{headers:{"content-type":"application/json"}});
  if(req.headers.get("x-order-agent-secret")!==cfg.secret)return new Response("unauthorized",{status:401});
  let body:any={};
  try{body=await req.json();}catch{body={};}
  if(url.pathname.endsWith("/message")){
    await sleep(4000);
    return new Response(JSON.stringify({ok:true,claimed:await processConversation(clean(body.conversation_id),cfg)}),{headers:{"content-type":"application/json"}});
  }
  if(url.pathname.endsWith("/sweep")){
    const pending=await db.rpc("getlink_ai_pending_dispatches",{p_limit:100});
    if(pending.error)throw pending.error;
    let count=0;
    for(const id of [...new Set<string>((pending.data||[]).map((row:any)=>clean(row.conversation_id)).filter(Boolean))]){
      count+=await processConversation(id,cfg);
    }
    return new Response(JSON.stringify({ok:true,claimed:count}),{headers:{"content-type":"application/json"}});
  }
  return new Response("not found",{status:404});
});
