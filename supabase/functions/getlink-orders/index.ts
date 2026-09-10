import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL=String(Deno.env.get("SUPABASE_URL")||"");
const SERVICE_ROLE=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
const PUBLISHABLES=(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}")}catch{return {}}})();
const PUBLIC_KEY=String(PUBLISHABLES.default||Deno.env.get("SUPABASE_ANON_KEY")||"");
const db=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();
const ORDER_STATUSES=["pending","delivered","returned"] as const;

type OrderStatus=typeof ORDER_STATUSES[number];
type Identity={kind:"customer"|"admin";id:string;name:string;username:string;role:"user"|"admin"};
type CreateInput={url:string;qty:number};
type ChatCustomer={id:string;name:string;username:string;avatarPath:string};

function clean(value:unknown){return String(value??"").replace(/\s+/g," ").trim()}
function json(req:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:cors(req)})}
function cors(req:Request){
  const origin=clean(req.headers.get("origin"));
  const allowed=origin==="https://get.taphoa.xyz"||origin==="https://chat.taphoa.xyz"||origin==="https://1sl2tp.github.io"||origin.startsWith("http://localhost")||origin.startsWith("http://127.0.0.1");
  return {
    "content-type":"application/json; charset=utf-8",
    "access-control-allow-origin":allowed?origin:"https://get.taphoa.xyz",
    "access-control-allow-methods":"GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers":"apikey, authorization, content-type",
    "access-control-max-age":"86400",
    "vary":"Origin"
  };
}
function fail(message:string,status=400){return Object.assign(new Error(message),{status})}
function errorText(e:unknown){return e instanceof Error?e.message:String(e||"Lỗi hệ thống")}
function constantTimeEqual(a:string,b:string){
  const x=enc.encode(a),y=enc.encode(b);
  if(!x.length||!y.length)return false;
  let diff=x.length^y.length;
  const n=Math.max(x.length,y.length);
  for(let i=0;i<n;i++)diff|=(x[i%x.length]||0)^(y[i%y.length]||0);
  return diff===0;
}
function publicKeyAuthorized(req:Request){
  const supplied=clean(req.headers.get("apikey"));
  return Boolean(PUBLIC_KEY&&supplied&&constantTimeEqual(supplied,PUBLIC_KEY));
}
function routePath(req:Request){
  const parts=new URL(req.url).pathname.split("/").filter(Boolean);
  const at=parts.lastIndexOf("getlink-orders");
  return "/"+parts.slice(at>=0?at+1:0).join("/");
}
function bearer(req:Request){
  const auth=clean(req.headers.get("authorization"));
  return auth.toLowerCase().startsWith("bearer ")?clean(auth.slice(7)):"";
}

async function chatIdentity(req:Request):Promise<Identity|null>{
  const token=bearer(req);
  if(!token)return null;
  const {data:userData,error:userError}=await db.auth.getUser(token);
  if(userError||!userData?.user?.id)return null;
  const {data:account,error}=await db.from("v21_accounts")
    .select("id,username,display_name,role,deleted_at,locked_at")
    .eq("auth_user_id",userData.user.id)
    .is("deleted_at",null)
    .is("locked_at",null)
    .maybeSingle();
  if(error)throw error;
  if(!account||(account.role!=="user"&&account.role!=="admin"))return null;
  const role=account.role as "user"|"admin";
  return {
    kind:role==="admin"?"admin":"customer",
    id:String(account.id),
    name:clean(account.display_name)||clean(account.username)||"Khách hàng",
    username:clean(account.username),
    role
  };
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

function customerView(row:any):ChatCustomer{
  return {
    id:String(row.id||""),
    name:clean(row.display_name)||clean(row.username)||"Khách hàng",
    username:clean(row.username),
    avatarPath:clean(row.avatar_path)
  };
}

async function listCustomers(){
  const rows=await fetchAll(()=>db.from("v21_accounts")
    .select("id,username,display_name,avatar_path,role,deleted_at,locked_at")
    .eq("role","user")
    .is("deleted_at",null)
    .is("locked_at",null)
    .order("display_name",{ascending:true,nullsFirst:false})
    .order("username",{ascending:true}));
  return rows.map(customerView);
}

async function selectedCustomer(customerId:string):Promise<ChatCustomer>{
  if(!customerId)throw fail("Chưa chọn khách hàng");
  const {data,error}=await db.from("v21_accounts")
    .select("id,username,display_name,avatar_path,role,deleted_at,locked_at")
    .eq("id",customerId)
    .eq("role","user")
    .is("deleted_at",null)
    .is("locked_at",null)
    .maybeSingle();
  if(error)throw error;
  if(!data)throw fail("Khách hàng không còn hoạt động",404);
  return customerView(data);
}

async function accountNameMap(ids:string[]){
  const unique=Array.from(new Set(ids.filter(Boolean)));
  const map=new Map<string,string>();
  for(let i=0;i<unique.length;i+=100){
    const batch=unique.slice(i,i+100);
    const {data,error}=await db.from("v21_accounts")
      .select("id,username,display_name")
      .in("id",batch);
    if(error)throw error;
    for(const row of data||[])map.set(String(row.id),clean(row.display_name)||clean(row.username)||"Khách hàng");
  }
  return map;
}

function itemView(row:any,includeCost:boolean){
  const out:any={
    productId:clean(row.product_code),
    name:clean(row.product_name),
    qty:Number(row.quantity||0),
    price:Number(row.unit_price_vnd||0),
    sourceId:clean(row.source_key),
    url:clean(row.product_url)
  };
  if(includeCost)out.cost=Number(row.unit_cost_vnd||0);
  return out;
}
function orderView(order:any,items:any[],customerName:string,includeCost:boolean){
  const out:any={
    id:String(order.id),
    orderNo:Number(order.order_no||0),
    customerId:String(order.customer_account_id||""),
    customerName,
    orderedAt:order.submitted_at,
    deliveredAt:order.delivered_at||null,
    returnedAt:order.returned_at||null,
    status:String(order.status) as OrderStatus,
    total:Number(order.total_amount_vnd||0),
    items:items.map(row=>itemView(row,includeCost))
  };
  if(includeCost)out.totalCost=Number(order.total_cost_vnd||0);
  return out;
}

async function listOrders(actor:Identity){
  let query=db.from("getlink_sales_orders")
    .select("id,order_no,customer_account_id,created_by_account_id,created_by_role,status,total_amount_vnd,total_cost_vnd,submitted_at,delivered_at,returned_at")
    .in("status",["pending","delivered","returned"])
    .order("submitted_at",{ascending:false})
    .order("order_no",{ascending:false});
  if(actor.kind==="customer")query=query.eq("customer_account_id",actor.id);
  const orderRows=await fetchAll(()=>query);
  const ids=orderRows.map((row:any)=>String(row.id));
  const items:any[]=[];
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);
    if(!batch.length)continue;
    const rows=await fetchAll(()=>db.from("getlink_sales_order_items")
      .select("id,order_id,line_no,product_code,product_name,product_url,quantity,unit_price_vnd,unit_cost_vnd,source_key")
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
  const names=await accountNameMap(orderRows.map((row:any)=>String(row.customer_account_id||"")));
  return orderRows.map((row:any)=>orderView(
    row,
    grouped.get(String(row.id))||[],
    names.get(String(row.customer_account_id))||"Khách hàng",
    actor.kind==="admin"
  ));
}

async function resolveCreateItems(raw:unknown){
  if(!Array.isArray(raw)||raw.length===0)throw fail("Đơn phải có ít nhất một sản phẩm");
  if(raw.length>100)throw fail("Đơn có quá nhiều sản phẩm");
  const requested:CreateInput[]=[];
  const seen=new Set<string>();
  for(const entry of raw){
    const url=clean(entry?.url);
    const qty=Number(entry?.qty);
    const key=url.toLowerCase();
    if(!url||!Number.isInteger(qty)||qty<=0||qty>999)throw fail("Sản phẩm hoặc số lượng không hợp lệ");
    if(seen.has(key))throw fail("Sản phẩm bị trùng trong đơn");
    seen.add(key);requested.push({url,qty});
  }
  const urls=requested.map(x=>x.url);
  const {data,error}=await db.from("getlink_supplier_products")
    .select("product_code,canonical_url,product_name,source_key,display_price_vnd,input_price_vnd,stock_status,is_active")
    .in("canonical_url",urls)
    .eq("is_active",true);
  if(error)throw error;
  const rows=data||[];
  const byUrl=new Map(rows.map((row:any)=>[clean(row.canonical_url).toLowerCase(),row]));
  if(byUrl.size!==urls.length)throw fail("Có sản phẩm không còn tồn tại");
  return requested.map(request=>{
    const row:any=byUrl.get(request.url.toLowerCase());
    const price=Math.round(Number(row.display_price_vnd||0));
    const cost=Math.max(0,Math.round(Number(row.input_price_vnd||0)));
    if(!Number.isFinite(price)||price<=0)throw fail("Có sản phẩm chưa có giá bán");
    if(clean(row.stock_status)==="out_of_stock")throw fail("Có sản phẩm đang hết hàng");
    return {
      productCode:clean(row.product_code),
      productName:clean(row.product_name),
      productUrl:clean(row.canonical_url),
      quantity:request.qty,
      unitPriceVnd:price,
      unitCostVnd:Number.isFinite(cost)?cost:0,
      sourceKey:clean(row.source_key)
    };
  });
}

async function createOrder(req:Request,actor:Identity){
  const body=await req.json().catch(()=>({}));
  const customer=actor.kind==="customer"
    ?await selectedCustomer(actor.id)
    :await selectedCustomer(clean(body?.customerId));
  if(actor.kind==="admin"&&!clean(body?.customerId))throw fail("Chưa chọn khách hàng");
  const items=await resolveCreateItems(body?.items);
  const id=crypto.randomUUID();
  const submittedAt=new Date().toISOString();
  const total=items.reduce((sum:number,item:any)=>sum+item.unitPriceVnd*item.quantity,0);
  const totalCost=items.reduce((sum:number,item:any)=>sum+item.unitCostVnd*item.quantity,0);
  const {error}=await db.rpc("getlink_sales_create_order",{
    p_order:{id,customerAccountId:customer.id,createdByAccountId:actor.id,submittedAt},
    p_items:items
  });
  if(error)throw error;

  // The database owns the human order number and final persisted totals/status.
  // Read the inserted row back so the submit response is immediately usable by
  // both the purchase confirmation and order manager without falling back to UUID.
  const {data:created,error:createdError}=await db.from("getlink_sales_orders")
    .select("order_no,total_amount_vnd,total_cost_vnd,submitted_at")
    .eq("id",id)
    .single();
  if(createdError||!created)throw createdError||fail("Không đọc được đơn vừa tạo",500);

  return {
    id,orderNo:Number(created.order_no||0),customerId:customer.id,customerName:customer.name,
    orderedAt:created.submitted_at||submittedAt,status:"pending",
    total:Number(created.total_amount_vnd||total),totalCost:Number(created.total_cost_vnd||totalCost),
    items:items.map((item:any)=>({
      productId:item.productCode,name:item.productName,qty:item.quantity,price:item.unitPriceVnd,
      cost:item.unitCostVnd,sourceId:item.sourceKey,url:item.productUrl
    }))
  };
}

async function deliverOrder(id:string,actor:Identity){
  const {error}=await db.rpc("getlink_sales_deliver_order",{p_id:id,p_actor_id:actor.id});
  if(error)throw error;
}
async function returnOrder(id:string,actor:Identity){
  const {error}=await db.rpc("getlink_sales_return_order",{p_id:id,p_actor_id:actor.id});
  if(error)throw error;
}
async function deletePendingOrder(id:string,actor:Identity){
  const {data,error}=await db.from("getlink_sales_orders")
    .select("id,status")
    .eq("id",id)
    .maybeSingle();
  if(error)throw error;
  if(!data)throw fail("Không tìm thấy đơn",404);
  if(data.status!=="pending")throw fail("Chỉ xóa được Đơn tạm",409);
  await returnOrder(id,actor);
}

function signedDebt(row:any){
  const amount=Number(row.amount_vnd||0);
  return row.direction==="decrease"?-amount:amount;
}

async function listDebtSummaries(actor:Identity){
  const customerRows=actor.kind==="admin"?await listCustomers():[await selectedCustomer(actor.id)];
  const ids=customerRows.map(row=>row.id);
  const ledger:any[]=[];
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);
    if(!batch.length)continue;
    const rows=await fetchAll(()=>db.from("getlink_debt_ledger")
      .select("id,customer_account_id,amount_vnd,direction,occurred_at")
      .in("customer_account_id",batch)
      .order("occurred_at")
      .order("id"));
    ledger.push(...rows);
  }
  const balances=new Map<string,number>();
  const lastAt=new Map<string,string>();
  for(const row of ledger){
    const id=String(row.customer_account_id);
    balances.set(id,(balances.get(id)||0)+signedDebt(row));
    lastAt.set(id,String(row.occurred_at||""));
  }
  const debts=customerRows.map(row=>({
    customerId:row.id,customerName:row.name,username:row.username,
    balanceVnd:balances.get(row.id)||0,lastOccurredAt:lastAt.get(row.id)||null
  }));
  if(actor.kind==="admin")debts.sort((a,b)=>b.balanceVnd-a.balanceVnd||a.customerName.localeCompare(b.customerName,"vi"));
  return debts;
}

async function debtTimeline(actor:Identity,customerId:string){
  const id=actor.kind==="customer"?actor.id:customerId;
  if(actor.kind==="customer"&&customerId&&customerId!==actor.id)throw fail("forbidden",403);
  const customer=await selectedCustomer(id);
  const rows=await fetchAll(()=>db.from("getlink_debt_ledger")
    .select("id,customer_account_id,order_id,event_type,amount_vnd,direction,note,occurred_at,created_by_account_id")
    .eq("customer_account_id",id)
    .order("occurred_at")
    .order("id"));
  const orderIds=Array.from(new Set(rows.map((row:any)=>String(row.order_id||"")).filter(Boolean)));
  const orderNos=new Map<string,number>();
  for(let i=0;i<orderIds.length;i+=100){
    const batch=orderIds.slice(i,i+100);
    const {data,error}=await db.from("getlink_sales_orders").select("id,order_no").in("id",batch);
    if(error)throw error;
    for(const row of data||[])orderNos.set(String(row.id),Number(row.order_no||0));
  }
  let balance=0;
  const timeline=rows.map((row:any)=>{
    balance+=signedDebt(row);
    return {
      id:String(row.id),eventType:String(row.event_type),direction:String(row.direction),
      amountVnd:Number(row.amount_vnd||0),orderId:row.order_id?String(row.order_id):null,
      orderNo:row.order_id?(orderNos.get(String(row.order_id))||null):null,
      note:clean(row.note),occurredAt:row.occurred_at,balanceAfterVnd:balance
    };
  });
  return {customer,balanceVnd:balance,timeline};
}

async function recordPayment(req:Request,actor:Identity,customerId:string){
  const customer=await selectedCustomer(customerId);
  const body=await req.json().catch(()=>({}));
  const amountVnd=Math.round(Number(body?.amountVnd||0));
  if(!Number.isFinite(amountVnd)||amountVnd<=0)throw fail("Số tiền thanh toán không hợp lệ");
  const note=clean(body?.note);
  const {data,error}=await db.rpc("getlink_sales_record_payment",{
    p_customer_id:customer.id,p_amount_vnd:amountVnd,p_actor_id:actor.id,p_note:note
  });
  if(error)throw error;
  return {id:String(data||""),customerId:customer.id,amountVnd};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  if(!publicKeyAuthorized(req))return json(req,{error:"unauthorized"},401);
  try{
    const path=routePath(req);
    const actor=await chatIdentity(req);
    if(!actor)return json(req,{error:"login_required"},401);

    if(req.method==="GET"&&path==="/me"){
      return json(req,{ok:true,account:{id:actor.id,name:actor.name,username:actor.username,role:actor.role}});
    }
    if(req.method==="GET"&&path==="/customers"){
      if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      return json(req,{ok:true,customers:await listCustomers()});
    }
    if(req.method==="GET"&&path==="/orders"){
      return json(req,{ok:true,role:actor.kind,orders:await listOrders(actor)});
    }
    if(req.method==="POST"&&path==="/orders"){
      const order=await createOrder(req,actor);
      return json(req,{ok:true,order},201);
    }
    if(req.method==="GET"&&path==="/debts"){
      return json(req,{ok:true,role:actor.kind,debts:await listDebtSummaries(actor)});
    }

    const debtMatch=path.match(/^\/debts\/([^/]+)$/);
    if(req.method==="GET"&&debtMatch){
      const customerId=decodeURIComponent(debtMatch[1]);
      return json(req,{ok:true,...await debtTimeline(actor,customerId)});
    }
    const paymentMatch=path.match(/^\/debts\/([^/]+)\/payments$/);
    if(req.method==="POST"&&paymentMatch){
      if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      const payment=await recordPayment(req,actor,decodeURIComponent(paymentMatch[1]));
      return json(req,{ok:true,payment},201);
    }

    const match=path.match(/^\/orders\/([^/]+)\/(deliver|return)$/);
    if(req.method==="POST"&&match){
      if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      const id=decodeURIComponent(match[1]);
      if(match[2]==="deliver")await deliverOrder(id,actor);else await returnOrder(id,actor);
      return json(req,{ok:true});
    }
    const deleteMatch=path.match(/^\/orders\/([^/]+)$/);
    if(req.method==="DELETE"&&deleteMatch){
      if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      await deletePendingOrder(decodeURIComponent(deleteMatch[1]),actor);
      return json(req,{ok:true});
    }
    return json(req,{error:"not_found"},404);
  }catch(e:any){
    console.error("getlink-orders",e);
    return json(req,{error:errorText(e)},Number(e?.status||500));
  }
});
