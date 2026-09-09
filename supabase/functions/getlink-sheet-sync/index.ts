
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { JWT } from "npm:google-auth-library@9.15.1";

const sb=createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {auth:{persistSession:false,autoRefreshToken:false}}
);

const MANAGER_ID="1hGqAzIEqTMmULIeh5sCmed2R3XaiA9QZavtGRdNvyyU";
const SOURCES=[
  {key:"hang-u",name:"Hàng U",prefix:"HU-",ncc:"1gzTLCx575q6pFtpIU5RU8D8SUmxCMft6_jrBOVRDIY8",nccSheet:"1",mgrSheet:"Hàng U",basis:"carton"},
  {key:"thuoc-la",name:"Thuốc lá",prefix:"TL-",ncc:"1dKwYp6LAR8Lb9YLy4xnf5CP2FA_VyENfZ9-1rEc3wa8",nccSheet:"1",mgrSheet:"Thuốc lá",basis:"retail"},
  {key:"sua",name:"Sữa",prefix:"SUA-",ncc:"15A3wy0YXlVajFWTTeLXCUh580QhwIlwaBIyn9RdR2XU",nccSheet:"1",mgrSheet:"Sữa",basis:"carton"},
  {key:"masan",name:"Hàng masan",prefix:"MAS-",ncc:"1IcjJA_EF3gY0htAS97ClUQF5VZpgZFId7IYPExNgKzM",nccSheet:"1",mgrSheet:"Hàng masan",basis:"carton"},
  {key:"hang-thuong",name:"Hàng thường",prefix:"HT-",ncc:"1i1ge5hOPmWi7oxjE5F5hD96f9Zvvp_0HQzwgawZiFgs",nccSheet:"1",mgrSheet:"Hàng thường",basis:"carton"}
] as const;

type Pair={code:string,row:number,name:string,price:number|null,active:boolean};
type State={ncc_name:string|null,ncc_price_sheet:number|null,manager_name:string|null,manager_price_sheet:number|null};

let jwt:JWT|null=null;

function clean(v:unknown){return String(v??"").trim();}
function num(v:unknown):number|null{
  if(v===null||v===undefined||clean(v)==="")return null;
  if(typeof v==="number")return Number.isFinite(v)?v:null;
  let s=clean(v).replace(/\s+/g,"");
  if(/^[-+]?\d+(?:[.,]\d+)?$/.test(s)){
    if(s.includes(",")&&!s.includes("."))s=s.replace(",",".");
    const n=Number(s); return Number.isFinite(n)?n:null;
  }
  const n=Number(s.replace(/[^0-9.-]/g,""));
  return Number.isFinite(n)?n:null;
}
function eqPair(a:Pair|null,b:{name:string|null,price:number|null}|null){
  if(!a||!a.active)return !b||!clean(b.name);
  if(!b||!clean(b.name))return false;
  return clean(a.name)===clean(b.name)&&String(a.price??"")===String(b.price??"");
}
function qsheet(name:string){return "'"+name.replace(/'/g,"''")+"'";}
function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}

async function token(){
  if(!jwt){
    const raw=Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if(!raw)throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_missing");
    const c=JSON.parse(raw);
    jwt=new JWT({
      email:c.client_email,
      key:c.private_key,
      scopes:[
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.metadata.readonly"
      ]
    });
  }
  const t=await jwt.authorize();
  if(!t.access_token)throw new Error("google_access_token_missing");
  return t.access_token;
}

async function gfetch(url:string,init:RequestInit={}){
  const h=new Headers(init.headers||{});
  h.set("authorization","Bearer "+await token());
  const r=await fetch(url,{...init,headers:h});
  if(!r.ok){
    const body=await r.text();
    throw new Error("google_http_"+r.status+":"+body.slice(0,500));
  }
  return r;
}

async function readSheet(id:string,sheet:string,range:string){
  const full=qsheet(sheet)+"!"+range;
  const url="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(id)+
    "/values/"+encodeURIComponent(full)+
    "?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING";
  const d=await (await gfetch(url)).json();
  return Array.isArray(d.values)?d.values:[];
}

async function batchWrite(id:string,data:{range:string,values:any[][]}[]){
  if(!data.length)return;
  const url="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(id)+"/values:batchUpdate";
  await gfetch(url,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({valueInputOption:"USER_ENTERED",data})
  });
}

async function appendRow(id:string,sheet:string,range:string,values:any[]){
  const full=qsheet(sheet)+"!"+range;
  const url="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(id)+
    "/values/"+encodeURIComponent(full)+":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";
  await gfetch(url,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({values:[values]})
  });
}

async function modified(id:string){
  const r=await gfetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(id)+"?fields=modifiedTime");
  const d=await r.json();
  return Date.parse(clean(d.modifiedTime))||0;
}

function mapRows(rows:any[][],codeCol:number){
  const m=new Map<string,Pair>();
  const blankCodeRows:{row:number,name:string,price:number|null}[]=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i]||[];
    const name=clean(r[0]);
    const price=num(r[1]);
    const code=clean(r[codeCol]).toUpperCase();
    if(!code){
      if(name)blankCodeRows.push({row:i+1,name,price});
      continue;
    }
    const active=Boolean(name);
    m.set(code,{code,row:i+1,name,price,active});
  }
  return {map:m,blankCodeRows};
}

function codeNo(code:string,prefix:string){
  if(!code.startsWith(prefix))return 0;
  const tail=code.slice(prefix.length);
  return /^\d+$/.test(tail)?Number(tail):0;
}

async function loadStates(sourceKey:string){
  const {data,error}=await sb.from("getlink_supplier_pair_state")
    .select("product_code,ncc_name,ncc_price_sheet,manager_name,manager_price_sheet")
    .eq("source_key",sourceKey);
  if(error)throw error;
  return new Map((data||[]).map((x:any)=>[clean(x.product_code).toUpperCase(),x as State]));
}

async function loadDb(sourceKey:string){
  const {data,error}=await sb.from("getlink_supplier_products")
    .select("*").eq("source_key",sourceKey);
  if(error)throw error;
  return data||[];
}

async function saveStates(sourceKey:string,ncc:Map<string,Pair>,mgr:Map<string,Pair>){
  const codes=new Set([...ncc.keys(),...mgr.keys()]);
  const rows=[...codes].map(code=>{
    const a=ncc.get(code), b=mgr.get(code);
    return {
      source_key:sourceKey,
      product_code:code,
      ncc_name:a?.active?a.name:null,
      ncc_price_sheet:a?.active?a.price:null,
      manager_name:b?.active?b.name:null,
      manager_price_sheet:b?.active?b.price:null,
      resolved_name:b?.active?b.name:(a?.active?a.name:null),
      resolved_price_sheet:b?.active?b.price:(a?.active?a.price:null),
      synced_at:new Date().toISOString()
    };
  });
  for(let i=0;i<rows.length;i+=200){
    const {error}=await sb.from("getlink_supplier_pair_state")
      .upsert(rows.slice(i,i+200),{onConflict:"source_key,product_code"});
    if(error)throw error;
  }
}

async function assignMissingCodes(source:any,nccRows:any[][],mgrRows:any[][]){
  const n=mapRows(nccRows,2), m=mapRows(mgrRows,15);
  const db=await loadDb(source.key);
  let max=0;
  for(const code of [...n.map.keys(),...m.map.keys(),...db.map((x:any)=>clean(x.product_code).toUpperCase())]){
    max=Math.max(max,codeNo(code,source.prefix));
  }
  const nWrites:any[]=[];
  const mWrites:any[]=[];
  for(const x of n.blankCodeRows){
    max++; const code=source.prefix+String(max).padStart(6,"0");
    nWrites.push({range:qsheet(source.nccSheet)+"!C"+x.row,values:[[code]]});
    n.map.set(code,{code,row:x.row,name:x.name,price:x.price,active:true});
  }
  for(const x of m.blankCodeRows){
    max++; const code=source.prefix+String(max).padStart(6,"0");
    mWrites.push({range:qsheet(source.mgrSheet)+"!P"+x.row,values:[[code]]});
    m.map.set(code,{code,row:x.row,name:x.name,price:x.price,active:true});
  }
  await batchWrite(source.ncc,nWrites);
  await batchWrite(MANAGER_ID,mWrites);
  return {ncc:n.map,mgr:m.map,generated:nWrites.length+mWrites.length};
}

async function writePairToManager(source:any,target:Pair|null,value:Pair|null,code:string){
  if(target){
    await batchWrite(MANAGER_ID,[{
      range:qsheet(source.mgrSheet)+"!A"+target.row+":B"+target.row,
      values:[[value?.active?value.name:"",value?.active?(value.price??""):""]]
    }]);
    target.name=value?.active?value.name:"";
    target.price=value?.active?value.price:null;
    target.active=Boolean(value?.active);
    return target;
  }
  if(!value?.active)return null;
  const row=new Array(16).fill("");
  row[0]=value.name; row[1]=value.price??""; row[15]=code;
  await appendRow(MANAGER_ID,source.mgrSheet,"A:P",row);
  return {code,row:999999,name:value.name,price:value.price,active:true} as Pair;
}

async function writePairToNcc(source:any,target:Pair|null,value:Pair|null,code:string){
  if(target){
    await batchWrite(source.ncc,[{
      range:qsheet(source.nccSheet)+"!A"+target.row+":B"+target.row,
      values:[[value?.active?value.name:"",value?.active?(value.price??""):""]]
    }]);
    target.name=value?.active?value.name:"";
    target.price=value?.active?value.price:null;
    target.active=Boolean(value?.active);
    return target;
  }
  if(!value?.active)return null;
  await appendRow(source.ncc,source.nccSheet,"A:C",[value.name,value.price??"",code]);
  return {code,row:999999,name:value.name,price:value.price,active:true} as Pair;
}

async function syncPair(source:any,nccRows:any[][],mgrRows:any[][]){
  const assigned=await assignMissingCodes(source,nccRows,mgrRows);
  const ncc=assigned.ncc, mgr=assigned.mgr;
  const states=await loadStates(source.key);
  const [nccMod,mgrMod]=await Promise.all([modified(source.ncc),modified(MANAGER_ID)]);
  const codes=new Set([...ncc.keys(),...mgr.keys(),...states.keys()]);
  let n2m=0,m2n=0,deleted=0,conflicts=0;

  for(const code of codes){
    let a=ncc.get(code)||null;
    let b=mgr.get(code)||null;
    const s=states.get(code)||null;
    const prevA=s?{name:s.ncc_name,price:s.ncc_price_sheet}:null;
    const prevB=s?{name:s.manager_name,price:s.manager_price_sheet}:null;

    const aChanged=s?!eqPair(a,prevA):false;
    const bChanged=s?!eqPair(b,prevB):false;

    if(!s){
      if(a?.active&&b?.active){
        if(!eqPair(a,{name:b.name,price:b.price})){
          if(mgrMod>=nccMod){a=await writePairToNcc(source,a,b,code);m2n++;conflicts++;}
          else {b=await writePairToManager(source,b,a,code);n2m++;conflicts++;}
        }
      }else if(a?.active&&!b?.active){
        b=await writePairToManager(source,b,a,code); n2m++;
      }else if(!a?.active&&b?.active){
        a=await writePairToNcc(source,a,b,code); m2n++;
      }
      if(a)ncc.set(code,a); if(b)mgr.set(code,b);
      continue;
    }

    if(aChanged&&!bChanged){
      b=await writePairToManager(source,b,a,code); n2m++;
      if(!a?.active)deleted++;
    }else if(!aChanged&&bChanged){
      a=await writePairToNcc(source,a,b,code); m2n++;
      if(!b?.active)deleted++;
    }else if(aChanged&&bChanged){
      if(eqPair(a,b?{name:b.name,price:b.price}:null)){
        // Both sides ended at the same value.
      }else if(mgrMod>=nccMod){
        a=await writePairToNcc(source,a,b,code); m2n++; conflicts++;
        if(!b?.active)deleted++;
      }else{
        b=await writePairToManager(source,b,a,code); n2m++; conflicts++;
        if(!a?.active)deleted++;
      }
    }

    if(a)ncc.set(code,a); if(b)mgr.set(code,b);
  }

  return {ncc,mgr,generated:assigned.generated,ncc_to_manager:n2m,manager_to_ncc:m2n,deleted,conflicts};
}

function statusInfo(raw:string,price:number|null){
  const s=clean(raw).toLowerCase();
  if(s==="ngừng dùng"||s==="ngung dung")return {active:false,status:"no_price",label:"Ngừng dùng"};
  if(s==="đang hết"||s==="dang het")return {active:true,status:"out_of_stock",label:"Đang hết"};
  if(price===null||s==="chưa có giá"||s==="chua co gia")return {active:true,status:"no_price",label:"Chưa có giá"};
  return {active:true,status:"available",label:""};
}

async function ingestManager(source:any,rows:any[][]){
  const incoming:any[]=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i]||[];
    const name=clean(r[0]);
    const code=clean(r[15]).toUpperCase();
    if(!name||!code)continue;
    const price=num(r[1]);
    const st=statusInfo(clean(r[2]),price);
    const basis=clean(r[3]).toLowerCase()==="lẻ"?"retail":"carton";
    const pct=num(r[4]);
    const profit=num(r[6]);
    const units=num(r[10]);
    const unit=clean(r[11])||(source.key==="thuoc-la"?"cây":"");
    incoming.push({
      source_key:source.key,
      source_row:i+1,
      product_name:name,
      input_price_vnd:price===null?null:Math.round(price*1000),
      input_price_basis:basis,
      expected_profit_percent:pct===null?null:pct*100,
      applied_profit_vnd:profit===null?0:Math.round(profit*1000),
      pricing_profit_mode:"applied",
      units_per_carton:units&&units>=1?units:null,
      retail_unit:unit,
      stock_status:st.status,
      stock_label:st.label,
      canonical_url:"https://get.taphoa.xyz/nguon-hang/"+source.key+"/"+code,
      raw_row:r,
      product_code:code,
      is_active:st.active,
      deleted_at:st.active?null:new Date().toISOString(),
      updated_at:new Date().toISOString()
    });
  }

  for(let i=0;i<incoming.length;i+=100){
    const {error}=await sb.from("getlink_supplier_products")
      .upsert(incoming.slice(i,i+100),{onConflict:"product_code"});
    if(error)throw error;
  }

  const {data:existing,error}=await sb.from("getlink_supplier_products")
    .select("product_code,is_active").eq("source_key",source.key);
  if(error)throw error;
  const keep=new Set(incoming.map(x=>x.product_code));
  const missing=(existing||[]).filter((x:any)=>x.is_active&&!keep.has(clean(x.product_code).toUpperCase()))
    .map((x:any)=>clean(x.product_code).toUpperCase());
  for(let i=0;i<missing.length;i+=100){
    const {error:e}=await sb.from("getlink_supplier_products")
      .update({is_active:false,deleted_at:new Date().toISOString(),stock_status:"no_price",stock_label:"Ngừng dùng",updated_at:new Date().toISOString()})
      .in("product_code",missing.slice(i,i+100));
    if(e)throw e;
  }
  return {active:incoming.filter(x=>x.is_active).length,inactive:missing.length};
}

async function authorized(req:Request){
  const provided=clean(req.headers.get("x-getlink-cron"));
  if(!provided)return false;
  const {data,error}=await sb.from("getlink_update_settings").select("cron_secret").eq("id",1).single();
  if(error)return false;
  return provided===clean(data?.cron_secret);
}

async function run(){
  const results:any[]=[];
  for(const source of SOURCES){
    const [nccRows,mgrRows]=await Promise.all([
      readSheet(source.ncc,source.nccSheet,"A:C"),
      readSheet(MANAGER_ID,source.mgrSheet,"A:P")
    ]);

    const pair=await syncPair(source,nccRows,mgrRows);
    const managerFresh=await readSheet(MANAGER_ID,source.mgrSheet,"A:P");
    const db=await ingestManager(source,managerFresh);
    const nccFresh=mapRows(await readSheet(source.ncc,source.nccSheet,"A:C"),2).map;
    const mgrFresh=mapRows(managerFresh,15).map;
    await saveStates(source.key,nccFresh,mgrFresh);

    results.push({source:source.key,...pair,db});
  }
  return {ok:true,at:new Date().toISOString(),results};
}

Deno.serve(async(req)=>{
  try{
    const url=new URL(req.url);
    if(req.method==="GET"&&url.pathname.endsWith("/health")){
      return json({ok:true,configured:Boolean(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")),service:"getlink-sheet-sync"});
    }
    if(req.method!=="POST")return json({error:"method_not_allowed"},405);
    if(!await authorized(req))return json({error:"unauthorized"},401);
    return json(await run());
  }catch(e){
    return json({ok:false,error:String(e?.message||e)},500);
  }
});
