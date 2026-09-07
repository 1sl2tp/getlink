const OWNER="1sl2tp";
const REPO="getlink";
const WORKFLOW="scrape.yml";

function json(data,status=200,origin=""){
  const headers={
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "access-control-allow-methods":"GET,POST,OPTIONS",
    "access-control-allow-headers":"content-type"
  };
  if(origin)headers["access-control-allow-origin"]=origin;
  return new Response(JSON.stringify(data),{status,headers});
}

function allowedOrigin(request,env){
  const origin=request.headers.get("origin")||"";
  if(!origin)return "";
  const configured=String(env.ALLOWED_ORIGINS||"https://1sl2tp.github.io")
    .split(",").map(x=>x.trim()).filter(Boolean);
  return configured.includes(origin)?origin:null;
}

function canonicalBhx(raw){
  const u=new URL(String(raw||""));
  const host=u.hostname.toLowerCase();
  if(host!=="bachhoaxanh.com"&&host!=="www.bachhoaxanh.com")throw new Error("invalid_bhx_url");
  const path=(u.pathname||"/").replace(/\/+/g,"/").replace(/\/+$/,"")||"/";
  return "https://bachhoaxanh.com"+path;
}

function inferType(url){
  const u=new URL(url);
  const parts=u.pathname.split("/").filter(Boolean);
  return parts.length>=2?"product":"category";
}

function idForUrl(url){
  const bytes=new TextEncoder().encode(url);
  return crypto.subtle.digest("SHA-256",bytes).then(buf=>
    Array.from(new Uint8Array(buf)).slice(0,12).map(x=>x.toString(16).padStart(2,"0")).join("")
  );
}

async function ghFetch(env,path,options={}){
  const headers=new Headers(options.headers||{});
  headers.set("accept","application/vnd.github+json");
  headers.set("authorization","Bearer "+env.GITHUB_TOKEN);
  headers.set("x-github-api-version","2022-11-28");
  headers.set("user-agent","getlink-worker");
  return fetch("https://api.github.com/repos/"+OWNER+"/"+REPO+path,{...options,headers});
}

async function dispatch(env,url,requestId){
  return ghFetch(env,"/actions/workflows/"+WORKFLOW+"/dispatches",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({ref:"main",inputs:{url,request_id:requestId}})
  });
}

function decodeGithubContent(content){
  const clean=String(content||"").replace(/\s+/g,"");
  const bin=atob(clean);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function readJobResult(env,requestId){
  const path="/contents/data/jobs/"+encodeURIComponent(requestId)+".json?ref=main";
  const r=await ghFetch(env,path);
  if(r.status===404)return null;
  if(!r.ok)throw new Error("github_result_"+r.status);
  const meta=await r.json();
  return JSON.parse(decodeGithubContent(meta.content));
}

async function upsertLink(env,row){
  const id=await idForUrl(row.canonical_url);
  await env.DB.prepare(`
    INSERT INTO links(
      id,canonical_url,source,link_type,parent_url,group_name,branch_name,name,
      packaging,current_price,original_price,promotion_price,promotion_text,
      last_checked_at,last_status,last_request_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(canonical_url) DO UPDATE SET
      source=excluded.source,
      link_type=excluded.link_type,
      parent_url=COALESCE(excluded.parent_url,links.parent_url),
      group_name=COALESCE(NULLIF(excluded.group_name,''),links.group_name),
      branch_name=COALESCE(NULLIF(excluded.branch_name,''),links.branch_name),
      name=COALESCE(NULLIF(excluded.name,''),links.name),
      packaging=COALESCE(NULLIF(excluded.packaging,''),links.packaging),
      current_price=COALESCE(excluded.current_price,links.current_price),
      original_price=COALESCE(excluded.original_price,links.original_price),
      promotion_price=COALESCE(excluded.promotion_price,links.promotion_price),
      promotion_text=COALESCE(NULLIF(excluded.promotion_text,''),links.promotion_text),
      last_checked_at=excluded.last_checked_at,
      last_status=excluded.last_status,
      last_request_id=excluded.last_request_id,
      updated_at=excluded.updated_at
  `).bind(
    id,row.canonical_url,row.source||"Bách Hóa XANH",row.link_type,row.parent_url||null,
    row.group_name||"",row.branch_name||"",row.name||"",row.packaging||"",
    row.current_price??null,row.original_price??null,row.promotion_price??null,
    row.promotion_text||"",row.last_checked_at||new Date().toISOString(),
    row.last_status||"ok",row.last_request_id||"",row.created_at||new Date().toISOString(),
    new Date().toISOString()
  ).run();
  return id;
}

async function persistPayload(env,payload){
  const checked=payload.checked_at||new Date().toISOString();
  const inputUrl=canonicalBhx(payload.input_url);
  const kind=payload.input_type==="category"?"category":"product";
  const products=Array.isArray(payload.products)?payload.products:[];
  let rootProduct=payload.product||null;

  if(kind==="product"&&rootProduct){
    await persistProduct(env,rootProduct,null,payload.request_id,checked);
  }else{
    const first=products[0]||{};
    await upsertLink(env,{
      canonical_url:inputUrl,source:"Bách Hóa XANH",link_type:"category",
      parent_url:null,group_name:first.group||"",branch_name:"",
      name:payload.category_name||first.group||new URL(inputUrl).pathname.split("/").filter(Boolean).pop()||"Danh mục",
      packaging:"",last_checked_at:checked,last_status:"ok",last_request_id:payload.request_id
    });
    for(const p of products)await persistProduct(env,p,inputUrl,payload.request_id,checked);
  }

  const resultJson=JSON.stringify(payload);
  await env.DB.prepare(
    "UPDATE jobs SET status='complete',result_json=?,updated_at=? WHERE request_id=?"
  ).bind(resultJson,new Date().toISOString(),payload.request_id).run();
  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first();
  return {payload,registry_count:Number(count&&count.n||0)};
}

async function persistProduct(env,p,parentUrl,requestId,checked){
  const url=canonicalBhx(p.url);
  const price=p.price||{};
  const promo=p.promotion||{};
  const linkId=await upsertLink(env,{
    canonical_url:url,source:p.source&&p.source.name||"Bách Hóa XANH",
    link_type:"product",parent_url:parentUrl||null,group_name:p.group||"",
    branch_name:p.branch||"",name:p.name||"",packaging:p.packaging&&p.packaging.text||"",
    current_price:Number(price.current)||null,original_price:Number(price.original)||null,
    promotion_price:Number(promo.price)||null,promotion_text:promo.text||"",
    last_checked_at:p.last_checked_at||checked,last_status:"ok",last_request_id:requestId
  });
  await env.DB.prepare(`
    INSERT OR IGNORE INTO price_snapshots(
      link_id,request_id,checked_at,current_price,original_price,promotion_price,promotion_text,result_json
    ) VALUES(?,?,?,?,?,?,?,?)
  `).bind(
    linkId,requestId,p.last_checked_at||checked,Number(price.current)||null,
    Number(price.original)||null,Number(promo.price)||null,promo.text||"",JSON.stringify(p)
  ).run();
}

async function handleCreate(request,env,origin){
  let body;
  try{body=await request.json();}catch{return json({error:"invalid_json"},400,origin);}
  let url;
  try{url=canonicalBhx(body.url);}catch{return json({error:"invalid_bhx_url"},400,origin);}
  const requestId=crypto.randomUUID().replace(/-/g,"");
  const type=inferType(url);
  const now=new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO jobs(request_id,input_url,canonical_url,link_type,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)
  `).bind(requestId,url,url,type,"queued",now,now).run();

  await upsertLink(env,{
    canonical_url:url,source:"Bách Hóa XANH",link_type:type,parent_url:null,
    name:"",last_checked_at:now,last_status:"queued",last_request_id:requestId
  });

  const r=await dispatch(env,url,requestId);
  if(r.status!==204){
    const detail=(await r.text()).slice(0,500);
    await env.DB.prepare(
      "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
    ).bind("dispatch_"+r.status+":"+detail,new Date().toISOString(),requestId).run();
    return json({error:"github_dispatch_failed",status:r.status},502,origin);
  }
  return json({request_id:requestId,status:"queued",input_url:url,link_type:type},202,origin);
}

async function handleResult(url,env,origin){
  const id=String(url.searchParams.get("id")||"").replace(/[^a-zA-Z0-9_-]/g,"");
  if(!id)return json({error:"missing_id"},400,origin);
  const job=await env.DB.prepare("SELECT * FROM jobs WHERE request_id=?").bind(id).first();
  if(!job)return json({error:"not_found"},404,origin);
  if(job.status==="complete"&&job.result_json){
    const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first();
    return json({status:"complete",payload:JSON.parse(job.result_json),registry_count:Number(count&&count.n||0)},200,origin);
  }
  if(job.status==="error")return json({status:"error",error:job.error||"unknown"},200,origin);

  try{
    const payload=await readJobResult(env,id);
    if(!payload)return json({status:"running",request_id:id},200,origin);
    const saved=await persistPayload(env,payload);
    return json({status:"complete",...saved},200,origin);
  }catch(error){
    return json({status:"running",request_id:id,detail:String(error&&error.message||error)},200,origin);
  }
}

async function handleLinks(url,env,origin){
  const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit")||30)));
  const type=String(url.searchParams.get("type")||"");
  const q=String(url.searchParams.get("q")||"").trim();
  let sql="SELECT * FROM links WHERE 1=1";
  const binds=[];
  if(type==="product"||type==="category"){sql+=" AND link_type=?";binds.push(type);}
  if(q){sql+=" AND (name LIKE ? OR group_name LIKE ? OR branch_name LIKE ? OR canonical_url LIKE ?)";const like="%"+q+"%";binds.push(like,like,like,like);}
  sql+=" ORDER BY updated_at DESC LIMIT ?";
  binds.push(limit);
  const result=await env.DB.prepare(sql).bind(...binds).all();
  return json({links:result.results||[]},200,origin);
}

export default {
  async fetch(request,env){
    const origin=allowedOrigin(request,env);
    if(origin===null)return json({error:"origin_not_allowed"},403,"");
    if(request.method==="OPTIONS"){
      return new Response(null,{status:204,headers:{
        "access-control-allow-origin":origin||"*",
        "access-control-allow-methods":"GET,POST,OPTIONS",
        "access-control-allow-headers":"content-type"
      }});
    }
    const url=new URL(request.url);
    try{
      if(request.method==="POST"&&url.pathname==="/api/get-price")return handleCreate(request,env,origin||"*");
      if(request.method==="GET"&&url.pathname==="/api/result")return handleResult(url,env,origin||"*");
      if(request.method==="GET"&&url.pathname==="/api/links")return handleLinks(url,env,origin||"*");
      if(request.method==="GET"&&url.pathname==="/health")return json({ok:true},200,origin||"*");
      return json({error:"not_found"},404,origin||"*");
    }catch(error){
      return json({error:"server_error",detail:String(error&&error.message||error)},500,origin||"*");
    }
  }
};
