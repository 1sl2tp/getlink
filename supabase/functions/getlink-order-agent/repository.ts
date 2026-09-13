import type { AgentSession, DraftLine, SessionRepository } from "./session.ts";
import { normalizeCustomerText } from "./normalize.ts";

function clean(value:unknown){return String(value??"").replace(/\s+/g," ").trim();}
function asObject(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}

function mapSession(row:any):AgentSession{
  return {
    id:String(row.id),
    customerAccountId:String(row.customer_account_id),
    conversationId:String(row.conversation_id),
    state:String(row.state||"collecting"),
    awaitingContext:asObject(row.awaiting_context),
    lastPriceListContext:asObject(row.last_price_list_context),
    roundUpsellOffered:Boolean(row.round_upsell_offered),
    roundUpsellDeclined:Boolean(row.round_upsell_declined),
    salesOrderId:row.sales_order_id?String(row.sales_order_id):null,
  };
}

function mapLine(row:any):DraftLine{
  return {
    lineKey:String(row.line_key),
    productCode:String(row.product_code),
    productName:String(row.product_name||row.product_code),
    customerRawText:String(row.customer_raw_text||""),
    quantity:Number(row.quantity)||0,
    unitHint:row.unit_hint?String(row.unit_hint):null,
    attributes:asObject(row.attributes),
    lineNote:String(row.line_note||""),
    quotedPriceVnd:row.quoted_price_vnd==null?null:Number(row.quoted_price_vnd),
    confidence:Number(row.matcher_confidence)||0,
    resolutionSource:String(row.resolution_source||"canonical"),
    sourceMessageId:row.source_message_id?String(row.source_message_id):null,
  };
}

function sessionPatch(patch:Record<string,unknown>){
  const out:Record<string,unknown>={updated_at:new Date().toISOString()};
  const map:Record<string,string>={
    customerAccountId:"customer_account_id",conversationId:"conversation_id",awaitingContext:"awaiting_context",
    lastPriceListContext:"last_price_list_context",roundUpsellOffered:"round_upsell_offered",
    roundUpsellDeclined:"round_upsell_declined",salesOrderId:"sales_order_id",lastCustomerMessageAt:"last_customer_message_at",
    lastTurnKey:"last_turn_key",
  };
  for(const [key,value] of Object.entries(patch))out[map[key]||key]=value;
  return out;
}

async function activeAdminForConversation(db:any,conversationId:string):Promise<string>{
  const {data:conversation,error:cError}=await db.from("v21_conversations")
    .select("member_a,member_b").eq("id",conversationId).maybeSingle();
  if(cError)throw cError;
  if(!conversation)throw new Error("conversation_not_found");
  const ids=[conversation.member_a,conversation.member_b].filter(Boolean).map(String);
  const {data:accounts,error:aError}=await db.from("v21_accounts")
    .select("id,role,deleted_at,locked_at").in("id",ids).eq("role","admin").is("deleted_at",null).is("locked_at",null).limit(1);
  if(aError)throw aError;
  const id=accounts?.[0]?.id;
  if(!id)throw new Error("active_admin_not_found");
  return String(id);
}

async function loadPriceListProducts(db:any):Promise<any[]>{
  const rows:any[]=[];
  const pageSize=1000;
  for(let start=0;start<10000;start+=pageSize){
    const {data,error}=await db.from("getlink_supplier_products")
      .select("product_code,product_name,display_price_vnd,primary_packaging,retail_packaging,stock_status,is_active,updated_at")
      .eq("is_active",true)
      .neq("stock_status","inactive")
      .range(start,start+pageSize-1);
    if(error)throw error;
    const page=Array.isArray(data)?data:[];
    rows.push(...page);
    if(page.length<pageSize)break;
  }
  return rows
    .filter(row=>String(row?.stock_status||"")!=="out_of_stock")
    .filter(row=>row?.display_price_vnd!==null&&row?.display_price_vnd!==undefined)
    .sort((a,b)=>String(a?.product_name||"").localeCompare(String(b?.product_name||""),"vi")||String(a?.product_code||"").localeCompare(String(b?.product_code||""),"vi"));
}

export function createSessionRepository(db:any):SessionRepository&{
  markRowsProcessed(rows:any[]):Promise<void>;
  markRowsFailed(rows:any[],errorCode:string):Promise<void>;
  auditTurn(input:Record<string,unknown>):Promise<void>;
}{
  return {
    async loadOrCreateSession(customerAccountId:string,conversationId:string){
      const {data:existing,error}=await db.from("getlink_ai_order_sessions")
        .select("*")
        .eq("conversation_id",conversationId)
        .in("state",["collecting","awaiting_clarification","quoted","confirmed"])
        .order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(error)throw error;
      if(existing)return mapSession(existing);
      const {data:created,error:createError}=await db.from("getlink_ai_order_sessions").insert({
        customer_account_id:customerAccountId,conversation_id:conversationId,state:"collecting",
      }).select("*").single();
      if(createError)throw createError;
      return mapSession(created);
    },

    async listDraftLines(sessionId:string){
      const {data,error}=await db.from("getlink_ai_order_draft_lines")
        .select("*,getlink_supplier_products!inner(product_name)")
        .eq("session_id",sessionId).order("created_at",{ascending:true});
      if(error)throw error;
      return (data||[]).map((row:any)=>mapLine({
        ...row,
        product_name:Array.isArray(row.getlink_supplier_products)
          ?row.getlink_supplier_products[0]?.product_name
          :row.getlink_supplier_products?.product_name,
      }));
    },

    async saveLine(sessionId:string,line:DraftLine){
      const payload={
        session_id:sessionId,
        line_key:line.lineKey,
        product_code:line.productCode,
        customer_raw_text:line.customerRawText,
        quantity:line.quantity,
        unit_hint:line.unitHint,
        attributes:line.attributes||{},
        line_note:line.lineNote||"",
        quoted_price_vnd:line.quotedPriceVnd,
        matcher_confidence:line.confidence,
        resolution_source:line.resolutionSource,
        source_message_id:line.sourceMessageId||null,
        updated_at:new Date().toISOString(),
      };
      const {data,error}=await db.from("getlink_ai_order_draft_lines")
        .upsert(payload,{onConflict:"session_id,line_key"}).select("*").single();
      if(error)throw error;
      return data;
    },

    async deleteLine(sessionId:string,lineKey:string){
      const {error}=await db.from("getlink_ai_order_draft_lines").delete().eq("session_id",sessionId).eq("line_key",lineKey);
      if(error)throw error;
    },

    async updateSession(sessionId:string,patch:Record<string,unknown>){
      const {data,error}=await db.from("getlink_ai_order_sessions")
        .update(sessionPatch(patch)).eq("id",sessionId).select("*").single();
      if(error)throw error;
      return mapSession(data);
    },

    async getProductHint(productCode:string){
      const {data,error}=await db.from("getlink_ai_product_hints")
        .select("ask_attribute,allowed_values,sales_hint,market_reference_source,market_reference_key,equivalence_key")
        .eq("product_code",productCode).maybeSingle();
      if(error)throw error;
      if(!data)return null;
      return {askAttribute:data.ask_attribute?String(data.ask_attribute):null,...data};
    },

    async listPriceScope(scope:string){
      const normalized=normalizeCustomerText(scope);
      const all=["toan bo","tat ca","all","bang gia"].includes(normalized);
      const rows=await loadPriceListProducts(db);
      const mapped=rows.map((row:any,index:number)=>({
        code:`P${String(index+1).padStart(2,"0")}`,
        productCode:String(row.product_code),
        productName:String(row.product_name),
        priceVnd:Number(row.display_price_vnd)||0,
        unitLabel:clean(row.primary_packaging||row.retail_packaging),
        updatedAt:row.updated_at,
      }));
      const items=all||!normalized
        ?mapped
        :mapped.filter(item=>normalizeCustomerText(item.productName).includes(normalized));
      const url=all
        ?"https://get.taphoa.xyz/price-list.html?scope=all"
        :`https://get.taphoa.xyz/price-list.html?scope=group&name=${encodeURIComponent(clean(scope))}`;
      return {scope:all?"toàn bộ":clean(scope),count:items.length,url,items};
    },

    async materializePendingOrder(session:AgentSession,lines:DraftLine[]){
      if(session.salesOrderId)return session.salesOrderId;
      if(!lines.length)throw new Error("empty_order");
      const codes=[...new Set(lines.map(line=>line.productCode))];
      const {data:products,error:pError}=await db.from("getlink_supplier_products")
        .select("product_code,product_name,canonical_url,source_key,display_price_vnd,input_price_vnd,stock_status,is_active")
        .in("product_code",codes).eq("is_active",true);
      if(pError)throw pError;
      const byCode=new Map((products||[]).map((row:any)=>[String(row.product_code),row]));
      const items=lines.map(line=>{
        const product:any=byCode.get(line.productCode);
        if(!product||String(product.stock_status||"")==="inactive")throw new Error(`product_unavailable:${line.productCode}`);
        const price=Math.max(0,Math.round(Number(product.display_price_vnd)||0));
        const cost=Math.max(0,Math.round(Number(product.input_price_vnd)||0));
        return {
          productCode:String(product.product_code),productName:String(product.product_name),productUrl:String(product.canonical_url||""),
          quantity:Number(line.quantity),unitPriceVnd:price,unitCostVnd:cost,sourceKey:String(product.source_key||""),
        };
      });
      const adminId=await activeAdminForConversation(db,session.conversationId);
      const totalAmountVnd=Math.round(items.reduce((sum:number,item:any)=>sum+item.unitPriceVnd*item.quantity,0));
      const totalCostVnd=Math.round(items.reduce((sum:number,item:any)=>sum+item.unitCostVnd*item.quantity,0));
      const {data,error}=await db.rpc("getlink_sales_create_order",{
        p_order:{
          customerAccountId:session.customerAccountId,createdByAccountId:adminId,createdByRole:"admin",
          totalAmountVnd,totalCostVnd,submittedAt:new Date().toISOString(),
        },
        p_items:items,
      });
      if(error)throw error;
      if(!data)throw new Error("order_create_missing_id");
      return String(data);
    },

    async markRowsProcessed(rows:any[]){
      const ids=rows.map(row=>String(row.inbox_id||row.id||"")).filter(Boolean);
      if(!ids.length)return;
      const {error}=await db.from("getlink_ai_message_inbox").update({status:"processed",processed_at:new Date().toISOString(),last_error:null}).in("id",ids);
      if(error)throw error;
    },

    async markRowsFailed(rows:any[],errorCode:string){
      const ids=rows.map(row=>String(row.inbox_id||row.id||"")).filter(Boolean);
      if(!ids.length)return;
      const {error}=await db.from("getlink_ai_message_inbox").update({status:"failed",processed_at:new Date().toISOString(),last_error:clean(errorCode).slice(0,500)}).in("id",ids);
      if(error)throw error;
    },

    async auditTurn(input:Record<string,unknown>){
      const {error}=await db.from("getlink_ai_turn_audit").upsert(input,{onConflict:"turn_key,mode"});
      if(error)throw error;
    },
  };
}
