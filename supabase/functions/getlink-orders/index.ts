import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL=String(Deno.env.get("SUPABASE_URL")||"");
const SERVICE_ROLE=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
const PUBLISHABLES=(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}")}catch{return {}}})();
const PUBLIC_KEY=String(PUBLISHABLES.default||Deno.env.get("SUPABASE_ANON_KEY")||"");
const db=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();
const ORDER_STATUSES=["pending","done","returned"] as const;

type OrderStatus=typeof ORDER_STATUSES[number];
type Identity={kind:"customer"|"admin";id:string;name:string};
type CreateInput={url:string;qty:number};

function clean(value:unknown){return String(value??"").replace(/\s+/g," ").trim()}
function json(req:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:cors(req)})}
function cors(req:Request){
  const origin=clean(req.headers.get("origin"));
  const allowed=origin==="https://get.taphoa.xyz"||origin==="https://1sl2tp.github.io"||origin.startsWith("http://localhost")||origin.startsWith("http://127.0.0.1");
  return {
    "content-type":"application/json; charset=utf-8",
    "access-control-allow-origin":allowed?origin:"https://get.taphoa.xyz",
    "access-control-allow-methods":"GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers":"apikey, authorization, content-type, x-getlink-admin, x-taphoa-session",
    "access-control-max-age":"86400",
    "vary":"Origin"
  };
}
function fail(message:string,status=400){return Object.assign(new Error(message),{status})}
function errorText(e:unknown){return e instanceof Error?e.message:String(e||"Lỗi hệ thống")}
async function sha256(value:string){
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
function constantTimeEqual(a:string,b:string){
  const x=enc.encode(a),y=enc.encode(b);
  let diff=x.length^y.length;
  const n=Math.max(x.length,y.length);
  for(let i=0;i<n;i++)diff|=(x[i%x.length]||0)^(y[i%y.length]||0);
  return diff===0;
}
function publicKeyAuthorized(req:Request){
  const supplied=clean(req.headers.get("apikey"));
  return Boolean(PUBLIC_KEY&&supplied&&constantTimeEqual(supplied,PUBLIC_KEY));
}
function newId(prefix:string){
  const bytes=crypto.getRandomValues(new Uint8Array(12));
  return prefix+Array.from(bytes,b=>(b%10).toString()).join("");
}
function normalizedName(value:unknown){return clean(value).toLocaleLowerCase("vi-VN")}
function routePath(req:Request){
  const parts=new URL(req.url).pathname.split("/").filter(Boolean);
  const at=parts.lastIndexOf("getlink-orders");
  return "/"+parts.slice(at>=0?at+1:0).join("/");
}
function bearer(req:Request){
  const auth=clean(req.headers.get("authorization"));
  return auth.toLowerCase().startsWith("bearer ")?clean(auth.slice(7)):"";
}

async function customerIdentity(req:Request):Promise<Identity|null>{
  const token=clean(req.headers.get("x-taphoa-session"))||bearer(req);
  if(!token)return null;
  const tokenHash=await sha256(token);
  const now=new Date().toISOString();
  const {data:session,error:sessionError}=await db.from("sessions")
    .select("account_id,expires_at")
    .eq("token_hash",tokenHash)
    .gt("expires_at",now)
    .maybeSingle();
  if(sessionError)throw sessionError;
  if(!session)return null;
  const {data:account,error:accountError}=await db.from("accounts")
    .select("id,name,role,active")
    .eq("id",session.account_id)
    .eq("active",true)
    .maybeSingle();
  if(accountError)throw accountError;
  if(!account||account.role!=="customer")return null;
  await db.from("sessions").update({last_seen_at:now}).eq("token_hash",tokenHash);
  return {kind:"customer",id:String(account.id),name:clean(account.name)};
}

async function adminAuthorized(req:Request):Promise<boolean>{
  const token=clean(req.headers.get("x-getlink-admin"));
  if(!token)return false;
  const {data,error}=await db.from("getlink_update_settings")
    .select("admin_session_hash,admin_session_expires_at")
    .eq("id",1)
    .maybeSingle();
  if(error)throw error;
  const expected=clean(data?.admin_session_hash);
  const expires=Date.parse(String(data?.admin_session_expires_at||""));
  if(!expected||!Number.isFinite(expires)||expires<=Date.now())return false;
  return constantTimeEqual(await sha256(token),expected);
}

async function identity(req:Request):Promise<Identity|null>{
  if(await adminAuthorized(req))return {kind:"admin",id:"admin",name:"Admin"};
  return await customerIdentity(req);
}

async function fetchAll(make:()=>any,size=1000){
  const out:any[]=[];
  for(let from=0;;from+=size){
    const {data,error}=await make().range(from,from+size-1);
    if(error)throw error;
    const rows=data||[];
    out.push(...rows);
    if(rows.length<size)break;
  }
  return out;
}

function itemView(row:any,includeCost:boolean){
  const out:any={
    productId:row.product_id||"",
    name:clean(row.product_name),
    qty:Number(row.qty||0),
    price:Number(row.unit_price||0),
    sourceId:row.source_id||"",
    group:clean(row.group_name),
    note:clean(row.note)
  };
  if(includeCost)out.cost=Number(row.unit_cost||0);
  return out;
}
function orderView(order:any,items:any[],includeCost:boolean){
  const out:any={
    id:String(order.id),
    customerId:String(order.customer_id||""),
    customerName:clean(order.customer_name),
    orderedAt:order.ordered_at,
    returnedAt:order.returned_at||null,
    status:String(order.status) as OrderStatus,
    total:Number(order.total_amount||0),
    items:items.map(row=>itemView(row,includeCost))
  };
  if(includeCost)out.totalCost=Number(order.total_cost||0);
  return out;
}

async function listOrders(identity:Identity){
  let query=db.from("orders")
    .select("id,customer_id,customer_name,ordered_at,returned_at,status,total_amount,total_cost")
    .in("status",["pending","done","returned"])
    .order("ordered_at",{ascending:false})
    .order("id",{ascending:false});
  if(identity.kind==="customer")query=query.eq("customer_id",identity.id);
  const orders=await fetchAll(()=>query);
  const ids=orders.map((row:any)=>String(row.id));
  const items:any[]=[];
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);
    if(!batch.length)continue;
    const rows=await fetchAll(()=>db.from("order_items")
      .select("id,order_id,product_id,product_name,qty,unit_price,unit_cost,source_id,group_name,note,line_no")
      .in("order_id",batch)
      .order("line_no")
      .order("id"));
    items.push(...rows);
  }
  const grouped=new Map<string,any[]>();
  for(const row of items){
    const key=String(row.order_id);
    const bucket=grouped.get(key)||[];
    bucket.push(row);grouped.set(key,bucket);
  }
  return orders.map((row:any)=>orderView(row,grouped.get(String(row.id))||[],identity.kind==="admin"));
}

async function requireAdminOrder(id:string,status:OrderStatus){
  const {data,error}=await db.from("orders")
    .select("id,status")
    .eq("id",id)
    .maybeSingle();
  if(error)throw error;
  if(!data)throw fail("Không tìm thấy đơn",404);
  if(data.status!==status)throw fail("Trạng thái đơn không còn phù hợp",409);
  return data;
}

async function uniqueShopProductMap(names:string[]){
  const needed=new Set(names.map(normalizedName).filter(Boolean));
  const rows=await fetchAll(()=>db.from("products")
    .select("id,name,source_id,group_name")
    .eq("active",true)
    .order("id"));
  const grouped=new Map<string,any[]>();
  for(const row of rows){
    const key=normalizedName(row.name);
    if(!needed.has(key))continue;
    const bucket=grouped.get(key)||[];
    bucket.push(row);grouped.set(key,bucket);
  }
  const out=new Map<string,any>();
  for(const [key,bucket] of grouped){if(bucket.length===1)out.set(key,bucket[0]);}
  return out;
}

async function resolveCreateItems(raw:unknown){
  if(!Array.isArray(raw)||raw.length===0)throw fail("Đơn phải có ít nhất một sản phẩm");
  if(raw.length>100)throw fail("Đơn có quá nhiều sản phẩm");
  const requested:CreateInput[]=[];
  const seen=new Set<string>();
  for(const entry of raw){
    const url=clean(entry?.url).toLowerCase();
    const qty=Number(entry?.qty);
    if(!url||!Number.isFinite(qty)||qty<=0||qty>999)throw fail("Sản phẩm hoặc số lượng không hợp lệ");
    if(seen.has(url))throw fail("Sản phẩm bị trùng trong đơn");
    seen.add(url);requested.push({url,qty});
  }
  const urls=requested.map(x=>x.url);
  const {data,error}=await db.from("getlink_supplier_products")
    .select("canonical_url,product_name,source_key,source_name,display_price_vnd,input_price_vnd,stock_status,is_active")
    .in("canonical_url",urls)
    .eq("is_active",true);
  if(error)throw error;
  const rows=data||[];
  const byUrl=new Map(rows.map((row:any)=>[clean(row.canonical_url).toLowerCase(),row]));
  if(byUrl.size!==urls.length)throw fail("Có sản phẩm không còn tồn tại");
  const shopMap=await uniqueShopProductMap(rows.map((row:any)=>clean(row.product_name)));
  const items=requested.map(request=>{
    const row:any=byUrl.get(request.url);
    const price=Number(row.display_price_vnd||0)/1000;
    const cost=Number(row.input_price_vnd||0)/1000;
    if(!Number.isFinite(price)||price<=0)throw fail("Có sản phẩm chưa có giá bán");
    if(clean(row.stock_status)==="out_of_stock")throw fail("Có sản phẩm đang hết hàng");
    const shop=shopMap.get(normalizedName(row.product_name));
    const item:any={
      ten:clean(row.product_name),
      sourceId:clean(shop?.source_id||""),
      nhom:clean(shop?.group_name||row.source_name||row.source_key||"Tạp hóa"),
      sl:request.qty,
      gia:price,
      von:Number.isFinite(cost)&&cost>0?cost:0,
      ghiChu:""
    };
    if(shop?.id)item.maSP=String(shop.id);
    return item;
  });
  return items;
}

async function createOrder(req:Request,account:Identity){
  if(account.kind!=="customer")throw fail("Chỉ khách hàng được gửi đơn",403);
  const body=await req.json().catch(()=>({}));
  const items=await resolveCreateItems(body?.items);
  const total=items.reduce((sum:number,item:any)=>sum+Number(item.gia||0)*Number(item.sl||0),0);
  const totalCost=items.reduce((sum:number,item:any)=>sum+Number(item.von||0)*Number(item.sl||0),0);
  const now=new Date().toISOString();
  const order={
    id:newId("DH"),maKH:account.id,tenKH:account.name,ngay:now,trangThai:"pending",
    tongTien:total,tongVon:totalCost,items
  };
  const {error}=await db.rpc("taphoa_create_order_with_debt",{p_order:order,p_items:items,p_debt:null});
  if(error)throw error;
  return order;
}

async function approveOrder(id:string){
  await requireAdminOrder(id,"pending");
  const {error}=await db.rpc("taphoa_approve_order_with_debt",{
    p_id:id,p_ngay:new Date().toISOString(),p_debt_id:newId("CN")
  });
  if(error)throw error;
}
async function returnOrder(id:string){
  await requireAdminOrder(id,"done");
  const {error}=await db.rpc("taphoa_cancel_order",{
    p_id:id,p_reverse_debt:true,p_debt_id:newId("CN")
  });
  if(error)throw error;
}
async function deletePendingOrder(id:string){
  await requireAdminOrder(id,"pending");
  const {error}=await db.rpc("taphoa_cancel_order",{
    p_id:id,p_reverse_debt:false,p_debt_id:newId("CN")
  });
  if(error)throw error;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  if(!publicKeyAuthorized(req))return json(req,{error:"unauthorized"},401);
  try{
    const path=routePath(req);
    const who=await identity(req);
    if(!who)return json(req,{error:"login_required"},401);

    if(req.method==="GET"&&path==="/orders"){
      return json(req,{ok:true,role:who.kind,orders:await listOrders(who)});
    }
    if(req.method==="POST"&&path==="/orders"){
      const order=await createOrder(req,who);
      return json(req,{ok:true,order},201);
    }

    const match=path.match(/^\/orders\/([^/]+)\/(approve|return)$/);
    if(req.method==="POST"&&match){
      if(who.kind!=="admin")return json(req,{error:"forbidden"},403);
      const id=decodeURIComponent(match[1]);
      if(match[2]==="approve")await approveOrder(id);else await returnOrder(id);
      return json(req,{ok:true});
    }
    const deleteMatch=path.match(/^\/orders\/([^/]+)$/);
    if(req.method==="DELETE"&&deleteMatch){
      if(who.kind!=="admin")return json(req,{error:"forbidden"},403);
      await deletePendingOrder(decodeURIComponent(deleteMatch[1]));
      return json(req,{ok:true});
    }
    return json(req,{error:"not_found"},404);
  }catch(e:any){
    console.error("getlink-orders",e);
    return json(req,{error:errorText(e)},Number(e?.status||500));
  }
});
