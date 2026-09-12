import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { processDbTrainingMessage } from "./training.ts";

const SUPABASE_URL=String(Deno.env.get("SUPABASE_URL")||"").trim();
const SERVICE_ROLE=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"").trim();
const db=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const DEBOUNCE_MS=4000;

type RuntimeConfig={
  mode:"off"|"pilot";
  modelName:string;
  webhookSecret:string;
  groqApiKey:string;
  pilotCustomerIds:Set<string>;
};

type InboxRow={
  inbox_id:string;
  message_id:string;
  conversation_id:string;
  customer_account_id:string;
  message_body:string;
  message_created_at:string;
  turn_key:string;
};

function clean(value:unknown):string{return String(value??"").replace(/\s+/g," ").trim();}
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8"}});}
function route(req:Request){const parts=new URL(req.url).pathname.split("/").filter(Boolean);return "/"+(parts.at(-1)||"");}
function sleep(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,Math.max(0,ms)));}
function errorCode(error:unknown){return error instanceof Error?error.message:String(error||"unknown_error");}
function constantTimeEqual(a:string,b:string){
  const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
  if(!x.length||!y.length)return false;
  let diff=x.length^y.length;const n=Math.max(x.length,y.length);
  for(let i=0;i<n;i++)diff|=(x[i%x.length]||0)^(y[i%y.length]||0);
  return diff===0;
}

async function loadRuntimeConfig():Promise<RuntimeConfig>{
  const {data,error}=await db.rpc("getlink_ai_runtime_config");
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  const requested=clean(row?.mode).toLowerCase();
  const modelName=clean(row?.model_name);
  const webhookSecret=clean(row?.webhook_secret);
  const groqApiKey=clean(row?.groq_api_key);
  const ids=Array.isArray(row?.pilot_customer_ids)?row.pilot_customer_ids:[];
  const pilotCustomerIds=new Set<string>(ids.map((v:unknown)=>clean(v)).filter(Boolean));
  const ready=Boolean(modelName&&webhookSecret&&groqApiKey&&pilotCustomerIds.size>0);
  return {mode:requested==="pilot"&&ready?"pilot":"off",modelName,webhookSecret,groqApiKey,pilotCustomerIds};
}

async function claimTurn(conversationId:string):Promise<InboxRow[]>{
  const {data,error}=await db.rpc("getlink_ai_claim_turn",{p_conversation_id:conversationId});
  if(error)throw error;
  return Array.isArray(data)?data as InboxRow[]:[];
}

async function ensureSession(customerAccountId:string,conversationId:string):Promise<any>{
  const {data:existing,error}=await db.from("getlink_ai_order_sessions").select("*")
    .eq("conversation_id",conversationId).in("state",["collecting","awaiting_clarification","quoted","confirmed"])
    .order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  if(existing)return existing;
  const {data:created,error:createError}=await db.from("getlink_ai_order_sessions").insert({
    customer_account_id:customerAccountId,conversation_id:conversationId,state:"collecting",
  }).select("*").single();
  if(createError)throw createError;
  return created;
}

async function markProcessed(row:InboxRow){
  const {error}=await db.from("getlink_ai_message_inbox").update({status:"processed",processed_at:new Date().toISOString(),last_error:null}).eq("id",row.inbox_id);
  if(error)throw error;
}

async function markFailed(row:InboxRow,code:string){
  const {error}=await db.from("getlink_ai_message_inbox").update({status:"failed",processed_at:new Date().toISOString(),last_error:clean(code).slice(0,500)}).eq("id",row.inbox_id);
  if(error)throw error;
}

async function audit(row:InboxRow,extra:Record<string,unknown>){
  const {error}=await db.from("getlink_ai_turn_audit").upsert({
    turn_key:row.turn_key,conversation_id:row.conversation_id,customer_account_id:row.customer_account_id,
    source_message_ids:[row.message_id],mode:"pilot",...extra,
  },{onConflict:"turn_key,mode"});
  if(error)throw error;
}

async function enqueueReply(sessionId:string,row:InboxRow,replyKind:"draft_update"|"fallback",body:string):Promise<any>{
  const payload={session_id:sessionId,turn_key:`${row.turn_key}:${row.message_id}`,reply_kind:replyKind,body:body.trim()};
  const {data,error}=await db.from("getlink_ai_reply_outbox")
    .upsert(payload,{onConflict:"session_id,turn_key,reply_kind"}).select("*").single();
  if(error)throw error;
  return data;
}

async function flushReply(outbox:any):Promise<void>{
  if(outbox?.status==="sent"&&clean(outbox?.chat_message_id))return;
  const {data,error}=await db.rpc("getlink_ai_send_chat_message",{
    p_outbox_id:String(outbox.id),p_body:String(outbox.body),p_client_id:`ai:${outbox.id}`,
  });
  if(error)throw error;
  if(!clean(data))throw new Error("chat_message_missing");
}

async function processRow(row:InboxRow,config:RuntimeConfig):Promise<void>{
  let outbox:any=null;
  try{
    const session=await ensureSession(String(row.customer_account_id),String(row.conversation_id));
    const result=await processDbTrainingMessage(db,{
      customerAccountId:String(row.customer_account_id),conversationId:String(row.conversation_id),
      messageId:String(row.message_id),body:String(row.message_body),
    },{apiKey:config.groqApiKey,model:config.modelName});
    const body=String(result.reply||"").trim();
    if(body){
      const replyKind=result.translation.kind==="order"?"draft_update":"fallback";
      outbox=await enqueueReply(String(session.id),row,replyKind,body);
    }
    await audit(row,{
      result_kind:`training_${result.translation.kind}`,
      parsed_intent:{kind:result.translation.kind,items:result.translation.items,teachings:result.translation.teachings},
      reply_outbox_id:outbox?.id||null,
    });
    await markProcessed(row);
    if(outbox)try{await flushReply(outbox);}catch{/* retry by sweep */}
  }catch(error){
    const code=errorCode(error);
    try{await audit(row,{result_kind:"training_error",error_code:code,reply_outbox_id:outbox?.id||null});}catch{/* keep primary */}
    await markFailed(row,code);
  }
}

async function processConversation(conversationId:string,config:RuntimeConfig):Promise<number>{
  const rows=await claimTurn(conversationId);
  if(!rows.length)return 0;
  const pilotRows=rows.filter(row=>config.pilotCustomerIds.has(String(row.customer_account_id)));
  for(const row of pilotRows)await processRow(row,config);
  for(const row of rows.filter(row=>!config.pilotCustomerIds.has(String(row.customer_account_id))))await markProcessed(row);
  return rows.length;
}

async function recoverySweep(config:RuntimeConfig){
  let claimed=0,flushed=0;
  const {data:pending,error:pError}=await db.rpc("getlink_ai_pending_dispatches",{p_limit:100});
  if(pError)throw pError;
  const conversations=[...new Set<string>((pending||[]).map((row:any)=>clean(row.conversation_id)).filter(Boolean))];
  for(const conversationId of conversations)claimed+=await processConversation(conversationId,config);
  const {data:outbox,error:oError}=await db.from("getlink_ai_reply_outbox")
    .select("*").in("status",["pending","failed"]).order("created_at",{ascending:true}).limit(100);
  if(oError)throw oError;
  for(const row of outbox||[]){try{await flushReply(row);flushed+=1;}catch{/* next sweep */}}
  return {claimed,flushed};
}

Deno.serve(async(req:Request)=>{
  let config:RuntimeConfig;
  try{config=await loadRuntimeConfig();}
  catch(error){console.error(error);return json({ok:false,mode:"off",error:"runtime_config_unavailable"},503);}

  const path=route(req);
  if(req.method==="GET"&&(path==="/health"||path==="/getlink-order-agent"||path==="/")){
    return json({
      ok:true,mode:config.mode,model_provider:"groq",model_configured:Boolean(config.modelName&&config.groqApiKey),
      database_configured:Boolean(SUPABASE_URL&&SERVICE_ROLE),webhook_configured:Boolean(config.webhookSecret),
      pilot_customer_count:config.pilotCustomerIds.size,training_only:true,debounce_ms:DEBOUNCE_MS,
    });
  }
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  if(path!=="/message"&&path!=="/sweep")return json({ok:false,error:"not_found"},404);
  if(!constantTimeEqual(clean(req.headers.get("x-order-agent-secret")),config.webhookSecret))return json({ok:false,error:"unauthorized"},401);
  if(config.mode==="off")return json({ok:true,mode:"off",processed:false},202);

  if(path==="/sweep"){
    const result=await recoverySweep(config);
    return json({ok:true,...result});
  }

  let body:any={};
  try{body=await req.json();}catch{/* empty */}
  const conversationId=clean(body?.conversation_id);
  if(!conversationId)return json({ok:false,error:"conversation_id_required"},400);
  await sleep(DEBOUNCE_MS);
  const claimed=await processConversation(conversationId,config);
  return json({ok:true,claimed,processed:claimed>0,mode:"pilot",training_only:true});
});
