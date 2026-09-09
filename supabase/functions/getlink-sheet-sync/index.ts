
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { JWT } from "npm:google-auth-library@9.15.1";

declare const EdgeRuntime:{waitUntil(promise:Promise<unknown>):void};

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

// Integration lock:
 // - Apps Script owns NCC <-> management-file synchronization.
 // - This Edge Function only watches the management file and mirrors real file
 //   changes into Supabase/Web.
 // - Legacy NCC Drive/API sync code stays in this file for rollback, but is
 //   deliberately not scheduled or reachable from the normal worker path.
const LEGACY_NCC_DRIVE_SYNC_ENABLED=false;
const MANAGER_CHANGE_SYNC_ENABLED=true;
const LEGACY_NCC_WATCH_FILES=SOURCES.map(s=>({fileId:s.ncc,sourceKey:s.key,kind:"ncc" as const}));
const WATCH_FILES=[
  {fileId:MANAGER_ID,sourceKey:null,kind:"manager" as const}
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
          a=await writePairToNcc(source,a,b,code);m2n++;conflicts++;
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
        // both ended at the same value
      }else{
        // If both sides changed before the same scan, management is the tie-breaker.
        a=await writePairToNcc(source,a,b,code); m2n++; conflicts++;
        if(!b?.active)deleted++;
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


function vnDateTime(value:unknown){
  if(!value)return "";
  const d=new Date(String(value));
  if(Number.isNaN(d.getTime()))return "";
  return new Intl.DateTimeFormat("vi-VN",{
    timeZone:"Asia/Ho_Chi_Minh",
    day:"2-digit",month:"2-digit",year:"numeric",
    hour:"2-digit",minute:"2-digit",
    hour12:false
  }).format(d).replace(",", "");
}

async function refreshManagerDerived(source:any,managerRows:any[][]){
  const {data,error}=await sb.from("getlink_supplier_products")
    .select("product_code,input_price_vnd,input_price_basis,applied_profit_vnd,display_price_vnd,units_per_carton,stock_status,is_active,previous_input_price_vnd,supplier_price_delta_vnd,supplier_price_direction,supplier_price_changed_at")
    .eq("source_key",source.key);
  if(error)throw error;

  const db=new Map((data||[]).map((x:any)=>[clean(x.product_code).toUpperCase(),x]));
  const updates:{range:string,values:any[][]}[]=[];

  for(let i=1;i<managerRows.length;i++){
    const row=managerRows[i]||[];
    const code=clean(row[15]).toUpperCase();
    const name=clean(row[0]);
    if(!code||!name)continue;
    const d:any=db.get(code);
    if(!d)continue;

    const input=d.input_price_vnd===null||d.input_price_vnd===undefined?null:Number(d.input_price_vnd);
    const profit=d.applied_profit_vnd===null||d.applied_profit_vnd===undefined?0:Number(d.applied_profit_vnd);
    const display=d.display_price_vnd===null||d.display_price_vnd===undefined?null:Number(d.display_price_vnd);
    const units=d.units_per_carton===null||d.units_per_carton===undefined?null:Number(d.units_per_carton);

    let status="Có giá";
    if(!d.is_active)status="Ngừng dùng";
    else if(clean(d.stock_status)==="out_of_stock")status="Đang hết";
    else if(input===null)status="Chưa có giá";

    const percent=input&&input>0?profit/input:null;
    const profitSheet=profit/1000;

    let carton:any="";
    let retail:any="";
    if(display!==null){
      if(clean(d.input_price_basis)==="retail"){
        retail=display/1000;
        if(units&&units>1)carton=Math.round(display*units)/1000;
      }else{
        carton=display/1000;
        if(units&&units>1)retail=Math.round(display/units)/1000;
      }
    }

    const prev=d.previous_input_price_vnd===null||d.previous_input_price_vnd===undefined
      ?""
      :Number(d.previous_input_price_vnd)/1000;
    const delta=d.supplier_price_delta_vnd===null||d.supplier_price_delta_vnd===undefined
      ?null
      :Number(d.supplier_price_delta_vnd)/1000;

    let movement="";
    if(delta!==null&&delta!==0){
      movement=delta>0
        ?"Tăng +"+Math.abs(delta)
        :"Giảm -"+Math.abs(delta);
    }

    const values=[
      status,
      row[3]??"",
      percent??"",
      percent===null?"":profitSheet,
      row[6]??profitSheet,
      "Lãi áp dụng",
      carton,
      retail,
      row[10]??"",
      row[11]??"",
      prev,
      movement,
      vnDateTime(d.supplier_price_changed_at)
    ];

    const current=row.slice(2,15);
    const same=current.length===values.length&&current.every((v:any,idx:number)=>{
      const a=v===null||v===undefined?"":String(v);
      const b=values[idx]===null||values[idx]===undefined?"":String(values[idx]);
      return a===b;
    });
    if(!same){
      updates.push({
        range:qsheet(source.mgrSheet)+"!C"+(i+1)+":O"+(i+1),
        values:[values]
      });
    }
  }

  for(let i=0;i<updates.length;i+=200){
    await batchWrite(MANAGER_ID,updates.slice(i,i+200));
  }
}


async function lockLegacyNccWatches(){
  if(LEGACY_NCC_DRIVE_SYNC_ENABLED)return {locked:0};
  const ids=LEGACY_NCC_WATCH_FILES.map(x=>x.fileId);
  if(!ids.length)return {locked:0};
  const {data,error}=await sb.from("getlink_sheet_watch_channels")
    .select("*")
    .eq("active",true)
    .in("file_id",ids);
  if(error)throw error;
  const rows=Array.isArray(data)?data:[];
  for(const old of rows){
    await stopWatchChannel(clean(old.channel_id),clean(old.resource_id));
    await sb.from("getlink_sheet_watch_channels")
      .update({active:false,updated_at:new Date().toISOString()})
      .eq("channel_id",old.channel_id);
  }
  return {locked:rows.length};
}

async function managerSyncState(){
  const {data,error}=await sb.from("getlink_manager_sync_state")
    .select("*").eq("id",1).maybeSingle();
  if(error)throw error;
  return data||null;
}

async function setManagerSyncState(patch:Record<string,unknown>){
  const payload={id:1,file_id:MANAGER_ID,updated_at:new Date().toISOString(),...patch};
  const {error}=await sb.from("getlink_manager_sync_state")
    .upsert(payload,{onConflict:"id"});
  if(error)throw error;
}

async function syncManagerToDatabase(reason="drive-change",force=false){
  if(!MANAGER_CHANGE_SYNC_ENABLED)return {ok:true,status:"locked",reason};
  const modifiedMs=await modified(MANAGER_ID);
  const modifiedAt=modifiedMs?new Date(modifiedMs).toISOString():null;
  const state=await managerSyncState();

  if(!force&&modifiedAt&&state?.last_modified_at&&
      new Date(modifiedAt).getTime()<=new Date(state.last_modified_at).getTime()){
    return {ok:true,status:"unchanged",reason,modified_at:modifiedAt};
  }

  await setManagerSyncState({
    last_status:"running",
    last_trigger:reason,
    last_error:null
  });

  try{
    const results:any[]=[];
    for(const source of SOURCES){
      const rows=await readSheet(MANAGER_ID,source.mgrSheet,"A:P");
      const db=await ingestManager(source,rows);
      results.push({source:source.key,...db});
    }
    const now=new Date().toISOString();
    await setManagerSyncState({
      last_modified_at:modifiedAt,
      last_synced_at:now,
      last_trigger:reason,
      last_status:"success",
      last_error:null
    });
    return {ok:true,status:"synced",reason,modified_at:modifiedAt,synced_at:now,results};
  }catch(e){
    const detail=String((e as any)?.message||e).slice(0,1500);
    await setManagerSyncState({
      last_trigger:reason,
      last_status:"error",
      last_error:detail
    }).catch(()=>{});
    throw e;
  }
}

function watchCallbackUrl(){
  return clean(Deno.env.get("SUPABASE_URL")).replace(/\/$/,"")+
    "/functions/v1/getlink-sheet-sync/webhook";
}

async function stopWatchChannel(channelId:string,resourceId:string){
  if(!channelId||!resourceId)return;
  try{
    await gfetch("https://www.googleapis.com/drive/v3/channels/stop",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({id:channelId,resourceId})
    });
  }catch{
    // Expired/stale channels can safely be left for Google to expire.
  }
}

async function registerFileWatch(fileId:string,sourceKey:string|null){
  const channelId=crypto.randomUUID();
  const channelToken=crypto.randomUUID().replace(/-/g,"")+
    crypto.randomUUID().replace(/-/g,"");
  const expiration=Date.now()+23*60*60*1000;
  const url="https://www.googleapis.com/drive/v3/files/"+
    encodeURIComponent(fileId)+"/watch?supportsAllDrives=true";
  const res=await gfetch(url,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      id:channelId,
      type:"web_hook",
      address:watchCallbackUrl(),
      token:channelToken,
      expiration
    })
  });
  const body=await res.json();
  const expiresAt=body?.expiration
    ?new Date(Number(body.expiration)).toISOString()
    :new Date(expiration).toISOString();

  const {error}=await sb.from("getlink_sheet_watch_channels").insert({
    channel_id:channelId,
    file_id:fileId,
    source_key:sourceKey,
    channel_token:channelToken,
    resource_id:clean(body?.resourceId),
    resource_uri:clean(body?.resourceUri),
    expires_at:expiresAt,
    active:true,
    updated_at:new Date().toISOString()
  });
  if(error)throw error;

  return {
    file_id:fileId,
    source_key:sourceKey,
    channel_id:channelId,
    expires_at:expiresAt
  };
}

async function ensureWatches(force=false){
  // Keep only the management-file watch alive. Supplier/NCC watches are locked;
  // Apps Script owns that side of the pipeline.
  const legacy=await lockLegacyNccWatches();
  const renewBefore=new Date(Date.now()+2*60*60*1000).toISOString();
  const {data,error}=await sb.from("getlink_sheet_watch_channels")
    .select("*").eq("active",true);
  if(error)throw error;
  const active=Array.isArray(data)?data:[];
  const registered:any[]=[];
  const kept:any[]=[];

  for(const item of WATCH_FILES){
    const candidates=active.filter((x:any)=>clean(x.file_id)===item.fileId);
    const valid=candidates.find((x:any)=>
      x.expires_at&&String(x.expires_at)>renewBefore
    );
    if(valid&&!force){
      kept.push({
        file_id:item.fileId,
        source_key:item.sourceKey,
        expires_at:valid.expires_at
      });
      continue;
    }

    for(const old of candidates){
      await stopWatchChannel(clean(old.channel_id),clean(old.resource_id));
      await sb.from("getlink_sheet_watch_channels")
        .update({active:false,updated_at:new Date().toISOString()})
        .eq("channel_id",old.channel_id);
    }
    registered.push(await registerFileWatch(item.fileId,item.sourceKey));
  }

  return {
    ok:true,
    mode:"manager-change-only",
    legacy_ncc_sync_enabled:LEGACY_NCC_DRIVE_SYNC_ENABLED,
    legacy_watches_locked:legacy.locked,
    registered,
    kept,
    total:registered.length+kept.length
  };
}

async function noteWebhook(
  channelId:string,
  tokenValue:string,
  messageNumber:number|null,
  resourceState:string
){
  const {data,error}=await sb.from("getlink_sheet_watch_channels")
    .select("*")
    .eq("channel_id",channelId)
    .eq("active",true)
    .maybeSingle();
  if(error||!data)return {ok:false as const,reason:"unknown_channel"};
  if(clean(data.channel_token)!==tokenValue){
    return {ok:false as const,reason:"token_mismatch"};
  }
  const last=Number(data.last_message_number||0);
  if(messageNumber!==null&&Number.isFinite(messageNumber)&&messageNumber<=last){
    return {ok:false as const,reason:"duplicate"};
  }
  await sb.from("getlink_sheet_watch_channels").update({
    last_message_number:messageNumber,
    last_resource_state:resourceState,
    last_notified_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  }).eq("channel_id",channelId);
  return {ok:true as const,row:data};
}

async function runSources(sourceKeys?:string[],ensureWatch=false){
  const wanted=sourceKeys&&sourceKeys.length
    ?new Set(sourceKeys)
    :null;
  const results:any[]=[];
  let watch:any=null;

  if(ensureWatch){
    try{
      watch=await ensureWatches(false);
    }catch(e){
      watch={ok:false,error:String((e as any)?.message||e)};
    }
  }

  for(const source of SOURCES){
    if(wanted&&!wanted.has(source.key))continue;

    const [nccRows,mgrRows]=await Promise.all([
      readSheet(source.ncc,source.nccSheet,"A:C"),
      readSheet(MANAGER_ID,source.mgrSheet,"A:P")
    ]);

    const pair=await syncPair(source,nccRows,mgrRows);
    const managerFresh=await readSheet(MANAGER_ID,source.mgrSheet,"A:P");
    const db=await ingestManager(source,managerFresh);
    await refreshManagerDerived(source,managerFresh);

    const nccFresh=mapRows(await readSheet(source.ncc,source.nccSheet,"A:C"),2).map;
    const managerAfter=await readSheet(MANAGER_ID,source.mgrSheet,"A:P");
    const mgrFresh=mapRows(managerAfter,15).map;
    await saveStates(source.key,nccFresh,mgrFresh);

    results.push({source:source.key,...pair,db});
  }

  return {ok:true,at:new Date().toISOString(),watch,results};
}

async function handleDriveWebhook(req:Request){
  const channelId=clean(req.headers.get("x-goog-channel-id"));
  const tokenValue=clean(req.headers.get("x-goog-channel-token"));
  const state=clean(req.headers.get("x-goog-resource-state")).toLowerCase();
  const rawNo=clean(req.headers.get("x-goog-message-number"));
  const messageNumber=rawNo&&/^\d+$/.test(rawNo)?Number(rawNo):null;

  if(!channelId||!tokenValue)return new Response(null,{status:204});
  const noted=await noteWebhook(
    channelId,tokenValue,messageNumber,state
  );
  if(!noted.ok)return new Response(null,{status:204});
  if(state==="sync")return new Response(null,{status:204});

  // Only the management file is watched in normal operation.
  // A Drive event is a cheap change signal; only then do we read the manager
  // workbook and mirror it to Supabase. No NCC API sync and no write-back here,
  // so this path cannot create a Drive -> DB -> Drive loop.
  EdgeRuntime.waitUntil(
    syncManagerToDatabase("drive-webhook",false).catch(e=>{
      console.error("manager_sheet_change_sync_failed",String((e as any)?.message||e));
    })
  );
  return new Response(null,{status:204});
}

async function authorized(req:Request){
  const proxy=clean(req.headers.get("x-getlink-proxy"));
  if(proxy==="getlink-api-v1")return true;

  const provided=clean(req.headers.get("x-getlink-cron"));
  if(!provided)return false;
  const {data,error}=await sb.from("getlink_update_settings")
    .select("cron_secret").eq("id",1).single();
  if(error)return false;
  return provided===clean(data?.cron_secret);
}

async function run(){
  // Default/manual worker path is intentionally manager-only.
  // Legacy runSources() remains available in source for rollback, but is locked.
  await ensureWatches(false);
  return await syncManagerToDatabase("manual",true);
}

Deno.serve(async(req)=>{
  try{
    const url=new URL(req.url);

    if(req.method==="POST"&&url.pathname.endsWith("/webhook")){
      return await handleDriveWebhook(req);
    }

    if(req.method==="GET"&&url.pathname.endsWith("/health")){
      const {count}=await sb.from("getlink_sheet_watch_channels")
        .select("channel_id",{count:"exact",head:true})
        .eq("active",true)
        .gt("expires_at",new Date().toISOString());
      const state=await managerSyncState().catch(()=>null);
      return json({
        ok:true,
        configured:Boolean(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")),
        service:"getlink-sheet-sync",
        mode:"manager-change-only",
        manager_file_id:MANAGER_ID,
        active_watches:count||0,
        legacy_ncc_sync_enabled:LEGACY_NCC_DRIVE_SYNC_ENABLED,
        manager_sync_state:state
      });
    }

    if(req.method!=="POST")return json({error:"method_not_allowed"},405);
    if(!await authorized(req))return json({error:"unauthorized"},401);

    if(url.pathname.endsWith("/register-watches")){
      return json(await ensureWatches(true));
    }

    return json(await run());
  }catch(e){
    return json({ok:false,error:String((e as any)?.message||e)},500);
  }
});
