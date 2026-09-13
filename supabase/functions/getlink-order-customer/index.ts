import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL=String(Deno.env.get("SUPABASE_URL")||"");
const SERVICE_ROLE=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
const PUBLISHABLES=(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}")}catch{return {}}})();
const PUBLIC_KEY=String(PUBLISHABLES.default||Deno.env.get("SUPABASE_ANON_KEY")||"");
const db=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();

function clean(value:unknown){return String(value??"").replace(/\s+/g," ").trim()}
function constantTimeEqual(a:string,b:string){
  const x=enc.encode(a),y=enc.encode(b);
  if(!x.length||!y.length)return false;
  let diff=x.length^y.length;
  const n=Math.max(x.length,y.length);
  for(let i=0;i<n;i++)diff|=(x[i%x.length]||0)^(y[i%y.length]||0);
  return diff===0;
}
function cors(req:Request){
  const origin=clean(req.headers.get("origin"));
  const allowed=origin==="https://get.taphoa.xyz"||origin==="https://chat.taphoa.xyz"||origin==="https://1sl2tp.github.io"||origin.startsWith("http://localhost")||origin.startsWith("http://127.0.0.1");
  return {
    "content-type":"application/json; charset=utf-8",
    "access-control-allow-origin":allowed?origin:"https://get.taphoa.xyz",
    "access-control-allow-methods":"PUT,OPTIONS",
    "access-control-allow-headers":"apikey, authorization, content-type",
    "access-control-max-age":"86400",
    "vary":"Origin"
  };
}
function json(req:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:cors(req)})}
function bearer(req:Request){
  const auth=clean(req.headers.get("authorization"));
  return auth.toLowerCase().startsWith("bearer ")?clean(auth.slice(7)):"";
}
function errorText(error:unknown){return error instanceof Error?error.message:String(error||"Lỗi hệ thống")}

async function adminAccount(req:Request){
  const token=bearer(req);
  if(!token)return null;
  const {data:userData,error:userError}=await db.auth.getUser(token);
  if(userError||!userData?.user?.id)return null;
  const {data,error}=await db.from("v21_accounts")
    .select("id,role,deleted_at,locked_at")
    .eq("auth_user_id",userData.user.id)
    .eq("role","admin")
    .is("deleted_at",null)
    .is("locked_at",null)
    .maybeSingle();
  if(error)throw error;
  return data||null;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  if(req.method!=="PUT")return json(req,{error:"method_not_allowed"},405);

  const supplied=clean(req.headers.get("apikey"));
  if(!PUBLIC_KEY||!supplied||!constantTimeEqual(supplied,PUBLIC_KEY))return json(req,{error:"unauthorized"},401);

  try{
    const actor=await adminAccount(req);
    if(!actor)return json(req,{error:"admin_required"},403);

    const body=await req.json().catch(()=>({}));
    const orderId=clean(body?.orderId||body?.order_id);
    const customerId=clean(body?.customerId||body?.customer_id);
    if(!orderId||!customerId)return json(req,{error:"missing_order_or_customer"},400);

    const {data:customer,error:customerError}=await db.from("v21_accounts")
      .select("id,username,display_name,role,contact_group,deleted_at,locked_at")
      .eq("id",customerId)
      .eq("role","user")
      .eq("contact_group","customer")
      .is("deleted_at",null)
      .is("locked_at",null)
      .maybeSingle();
    if(customerError)throw customerError;
    if(!customer)return json(req,{error:"invalid_customer"},404);

    const {data,error}=await db.rpc("getlink_sales_reassign_order_customer",{
      p_id:orderId,
      p_customer_id:customerId,
      p_actor_id:String(actor.id)
    });
    if(error){
      const detail=errorText(error);
      if(detail.includes("Order not found"))return json(req,{error:"order_not_found",detail},404);
      if(detail.includes("Returned order"))return json(req,{error:"returned_order_locked",detail},409);
      if(detail.includes("Invalid customer"))return json(req,{error:"invalid_customer",detail},400);
      throw error;
    }

    return json(req,{
      ok:true,
      orderId:String(data||orderId),
      customer:{
        id:String(customer.id),
        name:clean(customer.display_name)||clean(customer.username)||"Khách hàng",
        username:clean(customer.username)
      }
    });
  }catch(error){
    console.error("getlink-order-customer",error);
    return json(req,{error:"server_error",detail:errorText(error).slice(0,500)},500);
  }
});
