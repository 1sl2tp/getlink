from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label} anchor missing")
    return text.replace(old, new, 1)


# ---------- GETLINK frontend ----------
p = Path("app.js")
s = p.read_text(encoding="utf-8")

s = replace_once(
    s,
    '''let updateAdminToken=sessionStorage.getItem(UPDATE_ADMIN_TOKEN_KEY)||"";
let appRole="user";
const USER_CLIENT_ID_KEY="getlink:user-client-id";
''',
    '''let updateAdminToken=sessionStorage.getItem(UPDATE_ADMIN_TOKEN_KEY)||"";
let appRole="user";
const GETLINK_CHAT_ORIGINS=new Set(["https://chat.taphoa.xyz","https://1sl2tp.github.io"]);
let sharedAccessToken="";
let sharedAccountContext=null;
let salesBootstrap=null;
let salesSelectedCustomerId="";
let salesBootstrapPending=null;
let salesSubmitBusy=false;
const USER_CLIENT_ID_KEY="getlink:user-client-id";
''',
    "frontend state",
)

s = replace_once(
    s,
    '''function apiFetch(path,options={}){
  const headers=new Headers(options.headers||{});
  if(API_KEY)headers.set("apikey",API_KEY);
  if(updateAdminToken)headers.set("x-getlink-admin",updateAdminToken);
  return fetch(API+path,{...options,headers});
}
''',
    '''function apiFetch(path,options={}){
  const headers=new Headers(options.headers||{});
  if(API_KEY)headers.set("apikey",API_KEY);
  if(updateAdminToken)headers.set("x-getlink-admin",updateAdminToken);
  if(sharedAccessToken)headers.set("Authorization","Bearer "+sharedAccessToken);
  return fetch(API+path,{...options,headers});
}

function salesAccountLabel(account){
  if(!account)return "Chưa đăng nhập Chat";
  return String(account.display_name||account.username||"Khách hàng").trim()||"Khách hàng";
}
function salesControlContainers(){
  return [
    [document.querySelector(".mobile-user-order-bar"),"mobile"],
    [document.querySelector(".user-work-order-foot"),"desktop"]
  ].filter(([node])=>Boolean(node));
}
function renderSalesAccountControls(){
  const account=salesBootstrap?.account||sharedAccountContext;
  const customers=Array.isArray(salesBootstrap?.customers)?salesBootstrap.customers:[];
  const isAdmin=account?.role==="admin";
  for(const [container,key] of salesControlContainers()){
    let control=container.querySelector('[data-sales-account-control="'+key+'"]');
    if(!control){
      control=document.createElement("label");
      control.className="sales-account-control";
      control.dataset.salesAccountControl=key;
      container.insertBefore(control,container.firstChild);
    }
    control.replaceChildren();
    const caption=document.createElement("span");
    caption.className="sales-account-caption";
    caption.textContent=isAdmin?"Khách hàng":"Khách";
    control.appendChild(caption);
    if(isAdmin){
      const select=document.createElement("select");
      select.className="sales-customer-select";
      select.id=key==="mobile"?"mobileSalesCustomer":"desktopSalesCustomer";
      const empty=document.createElement("option");
      empty.value="";
      empty.textContent="Chọn khách hàng";
      select.appendChild(empty);
      for(const customer of customers){
        const option=document.createElement("option");
        option.value=String(customer.id||"");
        option.textContent=salesAccountLabel(customer);
        select.appendChild(option);
      }
      select.value=salesSelectedCustomerId;
      select.addEventListener("change",()=>{
        salesSelectedCustomerId=select.value;
        document.querySelectorAll(".sales-customer-select").forEach(other=>{
          if(other!==select)other.value=salesSelectedCustomerId;
        });
        updateUserWorkOrderSummary();
      });
      control.appendChild(select);
    }else{
      const value=document.createElement("strong");
      value.className="sales-account-value";
      value.textContent=salesAccountLabel(account);
      control.appendChild(value);
    }
  }
}
async function loadSalesBootstrap(force=false){
  if(!sharedAccessToken||!sharedAccountContext){
    salesBootstrap=null;
    salesSelectedCustomerId="";
    renderSalesAccountControls();
    updateUserWorkOrderSummary();
    return null;
  }
  if(salesBootstrapPending&&!force)return salesBootstrapPending;
  const promise=apiFetch("/api/sales/bootstrap",{cache:"no-store"})
    .then(async res=>{
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(data.error||"sales_bootstrap_failed");
      salesBootstrap=data;
      sharedAccountContext=data.account||sharedAccountContext;
      if(sharedAccountContext?.role==="user")salesSelectedCustomerId=String(sharedAccountContext.id||"");
      else if(!Array.isArray(data.customers)||!data.customers.some(x=>String(x.id)===salesSelectedCustomerId))salesSelectedCustomerId="";
      renderSalesAccountControls();
      updateUserWorkOrderSummary();
      return data;
    })
    .catch(error=>{
      console.debug("GETLINK sales bootstrap",error);
      salesBootstrap=null;
      renderSalesAccountControls();
      updateUserWorkOrderSummary();
      return null;
    })
    .finally(()=>{if(salesBootstrapPending===promise)salesBootstrapPending=null;});
  salesBootstrapPending=promise;
  return promise;
}
window.addEventListener("message",event=>{
  if(!GETLINK_CHAT_ORIGINS.has(event.origin))return;
  const data=event.data;
  if(!data||data.type!=="taphoa-auth-context")return;
  sharedAccessToken=data.authenticated?String(data.accessToken||""):"";
  sharedAccountContext=data.authenticated&&data.account?{...data.account}:null;
  salesBootstrap=null;
  salesSelectedCustomerId=sharedAccountContext?.role==="user"?String(sharedAccountContext.id||""):"";
  renderSalesAccountControls();
  updateUserWorkOrderSummary();
  void loadSalesBootstrap(true);
});
''',
    "apiFetch",
)

s = replace_once(
    s,
    '''function updateUserWorkOrderSummary(){
  const selected=userWorkSelectedItems();
  const text="Đã chọn "+selected.length+" sản phẩm";
  const countHost=$("#userWorkSelectedCount");
  const mobileCount=$("#mobileUserSelectedCount");
  const send=$("#userWorkSendOrder");
  const mobileSend=$("#mobileUserSendOrder");
  if(countHost)countHost.textContent=text;
  if(mobileCount)mobileCount.textContent=text;
  if(send)send.disabled=selected.length===0;
  if(mobileSend)mobileSend.disabled=selected.length===0;
}

function saveUserWorkOrderDraft(){
  const selected=userWorkSelectedItems().map(item=>({
    url:item.row.canonical_url,
    name:canonicalDisplayName(item.row),
    qty:item.qty,
    bargain:readOwnPrice(item.row.canonical_url,"bargain")
  }));
  try{localStorage.setItem("getlink:work-order-draft",JSON.stringify(selected));}catch{}
  const message="Đã giữ đơn tạm "+selected.length+" sản phẩm · bước sau sẽ nối sang Chat.";
  const status=$("#userWorkOrderStatus");
  const mobileStatus=$("#mobileUserOrderStatus");
  if(status)status.textContent=message;
  if(mobileStatus)mobileStatus.textContent=message;
  return selected;
}
''',
    '''function updateUserWorkOrderSummary(){
  const selected=userWorkSelectedItems();
  const text="Đã chọn "+selected.length+" sản phẩm";
  const countHost=$("#userWorkSelectedCount");
  const mobileCount=$("#mobileUserSelectedCount");
  const send=$("#userWorkSendOrder");
  const mobileSend=$("#mobileUserSendOrder");
  const account=salesBootstrap?.account||sharedAccountContext;
  const customerReady=account?.role==="user"?Boolean(account?.id):Boolean(salesSelectedCustomerId);
  const ready=Boolean(sharedAccessToken&&salesBootstrap&&customerReady&&selected.length&&!salesSubmitBusy);
  if(countHost)countHost.textContent=text;
  if(mobileCount)mobileCount.textContent=text;
  if(send)send.disabled=!ready;
  if(mobileSend)mobileSend.disabled=!ready;
  renderSalesAccountControls();
}

async function saveUserWorkOrderDraft(){
  const picked=userWorkSelectedItems();
  const status=$("#userWorkOrderStatus");
  const mobileStatus=$("#mobileUserOrderStatus");
  const setMessage=message=>{
    if(status)status.textContent=message;
    if(mobileStatus)mobileStatus.textContent=message;
  };
  if(!picked.length)return null;
  if(!salesBootstrap)await loadSalesBootstrap(true);
  const account=salesBootstrap?.account||sharedAccountContext;
  if(!sharedAccessToken||!account){
    setMessage("Đăng nhập Chat để gửi đơn.");
    return null;
  }
  const customer_account_id=account.role==="user"?String(account.id||""):String(salesSelectedCustomerId||"");
  if(!customer_account_id){
    setMessage("Chọn khách hàng trước khi gửi đơn.");
    return null;
  }
  const items=picked.map(item=>({product_url:item.row.canonical_url,qty:item.qty}));
  salesSubmitBusy=true;
  updateUserWorkOrderSummary();
  setMessage("Đang tạo đơn tạm...");
  try{
    const res=await apiFetch("/api/sales/orders",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({customer_account_id,status:"pending",items})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||"sales_order_failed");
    for(const item of picked){
      setUserWorkQty(item.row.canonical_url,0);
      document.querySelectorAll('[data-work-url="'+CSS.escape(item.row.canonical_url)+'"] b').forEach(node=>node.textContent="0");
    }
    const order=data.order||{};
    const code=order.order_no?" #"+order.order_no:"";
    setMessage("Đã tạo đơn tạm"+code+" · Admin sẽ xác nhận giao.");
    return order;
  }catch(error){
    setMessage("Chưa gửi được đơn · "+String(error&&error.message||error));
    return null;
  }finally{
    salesSubmitBusy=false;
    updateUserWorkOrderSummary();
  }
}
''',
    "order draft",
)

p.write_text(s, encoding="utf-8")

# ---------- Small sales identity/customer UI ----------
p = Path("style.css")
css = p.read_text(encoding="utf-8")
addition = '''

/* Shared Chat account -> Tạp hóa sales identity. */
.sales-account-control{
  min-width:0;display:flex;align-items:center;gap:6px;color:#667085;font-size:10px;
}
.sales-account-caption{flex:0 0 auto;font-weight:650;color:#98a2b3}
.sales-account-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475467;font-weight:750}
.sales-customer-select{
  min-width:0;max-width:190px;height:30px;border:1px solid #d7dbe2;border-radius:8px;
  background:#fff;color:#344054;padding:0 26px 0 8px;font:600 11px/1.2 inherit;outline:none;
}
.sales-customer-select:focus{border-color:#9bcbb4;box-shadow:0 0 0 2px #0a8f4d0d}
@media(max-width:639px){
  .mobile-user-order-bar{flex-wrap:wrap}
  .mobile-user-order-bar .sales-account-control{flex:1 0 100%;height:28px}
  .mobile-user-order-bar .sales-customer-select{flex:1;max-width:none}
}
'''
if "/* Shared Chat account -> Tạp hóa sales identity. */" not in css:
    css += addition
p.write_text(css, encoding="utf-8")

# ---------- Edge sales auth + routes ----------
p = Path("supabase/functions/getlink-api/index.ts")
e = p.read_text(encoding="utf-8")

e = replace_once(
    e,
    'return {"access-control-allow-origin":allow,"access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type,apikey,x-getlink-internal,x-getlink-admin,x-getlink-cron","content-type":"application/json; charset=utf-8","cache-control":"no-store"};',
    'return {"access-control-allow-origin":allow,"access-control-allow-methods":"GET,POST,DELETE,OPTIONS","access-control-allow-headers":"content-type,apikey,authorization,x-getlink-internal,x-getlink-admin,x-getlink-cron","content-type":"application/json; charset=utf-8","cache-control":"no-store"};',
    "cors",
)

helper = r'''
type SalesAccountRow={
  id:string;auth_user_id:string;username:string;display_name:string;role:"admin"|"user";
  avatar_url?:string|null;avatar_path?:string|null;locked_at?:string|null;deleted_at?:string|null;
};
type SalesAccountAuth=
  | {ok:true;account:SalesAccountRow;accessToken:string}
  | {ok:false;res:Response};

async function salesAccount(req:Request):Promise<SalesAccountAuth>{
  const header=clean(req.headers.get("authorization")||"");
  const match=header.match(/^Bearer\s+(.+)$/i);
  if(!match)return {ok:false,res:response(req,{error:"sales_auth_required"},401)};
  const accessToken=clean(match[1]);
  const {data:userData,error:userError}=await sb.auth.getUser(accessToken);
  const authUser=userData?.user||null;
  if(userError||!authUser?.id)return {ok:false,res:response(req,{error:"sales_auth_invalid"},401)};
  const {data:account,error}=await sb.from("v21_accounts")
    .select("id,auth_user_id,username,display_name,role,avatar_url,avatar_path,locked_at,deleted_at")
    .eq("auth_user_id",authUser.id)
    .maybeSingle();
  if(error||!account||account.deleted_at||account.locked_at||!(account.role==="admin"||account.role==="user")){
    return {ok:false,res:response(req,{error:"sales_account_unavailable"},403)};
  }
  return {ok:true,account:account as SalesAccountRow,accessToken};
}
function salesAdminRequired(account:SalesAccountRow){return account.role==="admin";}
function salesPublicAccount(account:any){
  return {
    id:clean(account?.id),username:clean(account?.username),display_name:clean(account?.display_name),
    role:account?.role==="admin"?"admin":"user",avatar_url:clean(account?.avatar_url||""),avatar_path:clean(account?.avatar_path||"")
  };
}
async function salesOrderCustomer(account:SalesAccountRow,requestedId:unknown):Promise<string>{
  if(account.role==="user")return account.id;
  const id=clean(requestedId);
  if(!id)throw new Error("sales_customer_required");
  const {data,error}=await sb.from("v21_accounts")
    .select("id,role,locked_at,deleted_at")
    .eq("id",id).eq("role","user").is("locked_at",null).is("deleted_at",null).maybeSingle();
  if(error||!data)throw new Error("sales_customer_invalid");
  return clean(data.id);
}
function salesProductUrl(value:unknown):string{
  const raw=clean(value);
  let u:URL;
  try{u=new URL(raw);}catch{throw new Error("sales_product_invalid");}
  if(u.protocol!=="https:"||u.hostname.toLowerCase()!=="get.taphoa.xyz"||!u.pathname.startsWith("/nguon-hang/")){
    throw new Error("sales_product_invalid");
  }
  return u.origin+u.pathname;
}
async function salesValidatedItems(rawItems:unknown):Promise<any[]>{
  const incoming=Array.isArray(rawItems)?rawItems:[];
  if(!incoming.length||incoming.length>100)throw new Error("sales_items_invalid");
  const wanted=new Map<string,{url:string,qty:number}>();
  for(const raw of incoming){
    const url=salesProductUrl((raw as any)?.product_url||(raw as any)?.url);
    const qty=Math.round(Number((raw as any)?.qty)||0);
    if(qty<1||qty>999)throw new Error("sales_qty_invalid");
    const key=url.toLowerCase();
    const prior=wanted.get(key);
    const total=(prior?.qty||0)+qty;
    if(total>999)throw new Error("sales_qty_invalid");
    wanted.set(key,{url,qty:total});
  }
  const urls=[...wanted.values()].map(x=>x.url);
  const {data,error}=await sb.from("getlink_supplier_products")
    .select("product_code,product_name,canonical_url,display_price_vnd,is_active,deleted_at")
    .in("canonical_url",urls).eq("is_active",true).is("deleted_at",null);
  if(error)throw error;
  const products=new Map((data||[]).map((row:any)=>[clean(row.canonical_url).toLowerCase(),row]));
  return [...wanted.entries()].map(([key,w])=>{
    const row:any=products.get(key);
    const price=Math.round(Number(row?.display_price_vnd)||0);
    if(!row||price<=0)throw new Error("sales_product_unavailable");
    return {
      product_url:clean(row.canonical_url),product_code:clean(row.product_code),
      product_name_snapshot:clean(row.product_name)||"Sản phẩm",qty:w.qty,unit_price_vnd:price,note:""
    };
  });
}
async function handleSalesRequest(req:Request,url:URL,route:string):Promise<Response>{
  const auth=await salesAccount(req);
  if(!auth.ok)return auth.res;
  const account=auth.account;

  if(req.method==="GET"&&route==="/api/sales/bootstrap"){
    let customers:any[]=[];
    if(account.role==="admin"){
      const {data,error}=await sb.from("v21_accounts")
        .select("id,username,display_name,role,avatar_url,avatar_path")
        .eq("role","user").is("locked_at",null).is("deleted_at",null)
        .order("display_name",{ascending:true}).order("username",{ascending:true});
      if(error)throw error;
      customers=(data||[]).map(salesPublicAccount);
    }else{
      customers=[salesPublicAccount(account)];
    }
    return response(req,{
      account:salesPublicAccount(account),customers,
      permissions:{can_select_customer:account.role==="admin",can_deliver:account.role==="admin",can_reverse:account.role==="admin"}
    });
  }

  if(req.method==="GET"&&route==="/api/sales/orders"){
    const requested=clean(url.searchParams.get("status")||"pending");
    const status=["pending","delivered","reversed"].includes(requested)?requested:"pending";
    let query=sb.from("getlink_sales_orders")
      .select("id,order_no,customer_account_id,created_by_account_id,status,note,total_vnd,delivered_at,reversed_at,created_at,updated_at")
      .eq("status",status).order("created_at",{ascending:false}).limit(100);
    if(account.role==="user")query=query.eq("customer_account_id",account.id);
    const {data,error}=await query;
    if(error)throw error;
    return response(req,{account:salesPublicAccount(account),status,orders:data||[]});
  }

  if(req.method==="POST"&&route==="/api/sales/orders"){
    const body=await req.json().catch(()=>({}));
    const customer_account_id=await salesOrderCustomer(account,body?.customer_account_id);
    const items=await salesValidatedItems(body?.items);
    const note=clean(body?.note||"").slice(0,500);
    const {data,error}=await sb.rpc("getlink_sales_create_order",{
      p_customer_account_id:customer_account_id,
      p_created_by_account_id:account.id,
      p_note:note,
      p_items:items
    });
    if(error)throw error;
    return response(req,{order:{...data,status:"pending"},items});
  }

  const deliverRoute=route.endsWith("/deliver");
  const reverseRoute=route.endsWith("/reverse");
  if(req.method==="POST"&&(deliverRoute||reverseRoute)){
    if(!salesAdminRequired(account))return response(req,{error:"sales_admin_required"},403);
    const parts=route.split("/").filter(Boolean);
    const orderId=clean(parts[parts.length-2]);
    if(!/^[0-9a-f-]{36}$/i.test(orderId))return response(req,{error:"sales_order_invalid"},400);
    if(deliverRoute){
      const {data,error}=await sb.rpc("getlink_sales_deliver_order",{p_order_id:orderId,p_actor_account_id:account.id});
      if(error)throw error;
      return response(req,{order:{...data,status:"delivered"},debt:{kind:"sale",amount_vnd:Number(data?.total_vnd||0)}});
    }
    const {data,error}=await sb.rpc("getlink_sales_reverse_order",{p_order_id:orderId,p_actor_account_id:account.id});
    if(error)throw error;
    return response(req,{order:{...data,status:"reversed"},debt:{kind:"reversal",amount_vnd:-Number(data?.total_vnd||0)}});
  }

  if(req.method==="DELETE"&&route.startsWith("/api/sales/orders/")){
    if(!salesAdminRequired(account))return response(req,{error:"sales_admin_required"},403);
    const orderId=clean(route.split("/").filter(Boolean).at(-1)||"");
    if(!/^[0-9a-f-]{36}$/i.test(orderId))return response(req,{error:"sales_order_invalid"},400);
    const {data,error}=await sb.rpc("getlink_sales_delete_pending_order",{p_order_id:orderId});
    if(error)throw error;
    return response(req,{deleted_id:data});
  }
  return response(req,{error:"sales_route_not_found"},404);
}
'''

e = replace_once(e, "\nDeno.serve(async(req:Request)=>{", helper + "\nDeno.serve(async(req:Request)=>{", "Deno serve")

e = replace_once(
    e,
    '''  if(!authorized(req))return response(req,{error:"unauthorized"},401);
  if(req.method!=="GET"&&!writeAuthorized(req))return response(req,{error:"write_forbidden"},403);
''',
    '''  if(route.startsWith("/api/sales/")){
    try{return await handleSalesRequest(req,url,route);}
    catch(e){
      const code=errorText(e);
      const status=code.includes("required")||code.includes("invalid")||code.includes("unavailable")?400:409;
      return response(req,{error:code.slice(0,180)||"sales_failed"},status);
    }
  }

  if(!authorized(req))return response(req,{error:"unauthorized"},401);
  if(req.method!=="GET"&&!writeAuthorized(req))return response(req,{error:"write_forbidden"},403);
''',
    "legacy auth gate",
)

p.write_text(e, encoding="utf-8")
print("unified sales patch applied")
