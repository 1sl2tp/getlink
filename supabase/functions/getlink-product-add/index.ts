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
    "access-control-allow-methods":"POST,OPTIONS",
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

async function adminIdentity(req:Request){
  const token=bearer(req);
  if(!token)return null;
  const {data:userData,error:userError}=await db.auth.getUser(token);
  if(userError||!userData?.user?.id)return null;
  const {data:account,error}=await db.from("v21_accounts")
    .select("id,role,deleted_at,locked_at")
    .eq("auth_user_id",userData.user.id)
    .eq("role","admin")
    .is("deleted_at",null)
    .is("locked_at",null)
    .maybeSingle();
  if(error)throw error;
  return account||null;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  if(req.method!=="POST")return json(req,{error:"method_not_allowed"},405);
  const supplied=clean(req.headers.get("apikey"));
  if(!PUBLIC_KEY||!supplied||!constantTimeEqual(supplied,PUBLIC_KEY))return json(req,{error:"unauthorized"},401);

  try{
    const actor=await adminIdentity(req);
    if(!actor||actor.role!=="admin")return json(req,{error:"admin_required"},403);
    const body=await req.json().catch(()=>({}));
    const sourceKey=clean(body?.sourceKey||body?.source_key);
    const productName=clean(body?.name||body?.productName||body?.product_name);
    const priceVnd=Math.round(Number(body?.priceVnd??body?.price_vnd??0));
    if(!sourceKey)return json(req,{error:"missing_source"},400);
    if(productName.length<2||productName.length>120)return json(req,{error:"invalid_name"},400);
    if(!Number.isFinite(priceVnd)||priceVnd<1||priceVnd>1000000000)return json(req,{error:"invalid_price"},400);

    const {data,error}=await db.rpc("getlink_sales_create_manual_product",{
      p_source_key:sourceKey,
      p_product_name:productName,
      p_price_vnd:priceVnd,
      p_actor_id:String(actor.id)
    });
    if(error){
      const detail=errorText(error);
      if(detail.includes("already exists"))return json(req,{error:"product_exists",detail},409);
      if(detail.includes("Invalid supplier source"))return json(req,{error:"invalid_source",detail},400);
      if(detail.includes("Invalid product"))return json(req,{error:"invalid_product",detail},400);
      throw error;
    }
    return json(req,{product:data},201);
  }catch(error){
    return json(req,{error:"server_error",detail:errorText(error).slice(0,500)},500);
  }
});
