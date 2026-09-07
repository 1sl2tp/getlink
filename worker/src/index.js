const BAD_PATH=["tin-tuc","blog","khuyen-mai","kinh-nghiem-hay"];
const PROMO_WORDS=["ưu đãi","khuyến mãi","giảm","tặng","mua ","combo","quà"];
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
  const configured=String(env.ALLOWED_ORIGINS||"https://get.taphoa.xyz,https://1sl2tp.github.io")
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

function pathParts(url){
  return new URL(url).pathname.split("/").filter(Boolean);
}

function browserBhxUrl(url){
  const canonical=canonicalBhx(url);
  const u=new URL(canonical);
  return "https://www.bachhoaxanh.com"+u.pathname;
}


function heuristicType(url){
  return pathParts(url).length<=1?"category":"product";
}

function idForUrl(url){
  const bytes=new TextEncoder().encode(url);
  return crypto.subtle.digest("SHA-256",bytes).then(buf=>
    Array.from(new Uint8Array(buf)).slice(0,12).map(x=>x.toString(16).padStart(2,"0")).join("")
  );
}

async function dispatchGithub(env,url,requestId){
  if(!env.GITHUB_TOKEN)throw new Error("github_token_missing");
  return fetch("https://api.github.com/repos/"+OWNER+"/"+REPO+"/actions/workflows/"+WORKFLOW+"/dispatches",{
    method:"POST",
    headers:{
      "accept":"application/vnd.github+json",
      "authorization":"Bearer "+env.GITHUB_TOKEN,
      "content-type":"application/json",
      "x-github-api-version":"2026-03-10",
      "user-agent":"getlink-worker"
    },
    body:JSON.stringify({ref:"main",inputs:{url,request_id:requestId}})
  });
}

async function readGithubJob(requestId){
  const safe=String(requestId||"").replace(/[^A-Za-z0-9_-]/g,"");
  if(!safe)return null;
  const raw="https://raw.githubusercontent.com/"+OWNER+"/"+REPO+"/main/data/jobs/"+safe+".json?ts="+Date.now();
  const r=await fetch(raw,{headers:{"user-agent":"getlink-worker"}});
  if(r.status===404)return null;
  if(!r.ok)throw new Error("github_result_"+r.status);
  return r.json();
}

function cleanText(v){
  return String(v||"").replace(/\s+/g," ").trim();
}

function decodeEntities(v){
  return String(v||"")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)||32));
}

function stripTags(v){
  return cleanText(decodeEntities(String(v||"").replace(/<[^>]*>/g," ")));
}

function slugTitle(url){
  try{
    const parts=pathParts(url);
    const slug=parts[parts.length-1]||"Danh mục";
    return slug.split("-").filter(Boolean).map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(" ");
  }catch{return "Danh mục";}
}

function firstH1(html){
  const m=String(html||"").match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return m?stripTags(m[1]):"";
}

function metaContent(html,key){
  const escaped=String(key||"");
  const a=new RegExp("<meta[^>]+(?:property|name|itemprop)=[\"']"+escaped+"[\"'][^>]+content=[\"']([^\"']+)[\"']","i");
  const b=new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name|itemprop)=[\"']"+escaped+"[\"']","i");
  const m=String(html||"").match(a)||String(html||"").match(b);
  return m?decodeEntities(m[1]).trim():"";
}

function jsonLdRoots(html){
  const out=[];
  const re=/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while((m=re.exec(String(html||"")))){
    const raw=m[1].trim();
    if(!raw)continue;
    try{
      const parsed=JSON.parse(raw);
      if(Array.isArray(parsed))out.push(...parsed);
      else out.push(parsed);
    }catch{}
  }
  return out;
}

function collectType(value,wanted,out=[]){
  if(Array.isArray(value)){
    for(const x of value)collectType(x,wanted,out);
    return out;
  }
  if(!value||typeof value!=="object")return out;
  const kind=value["@type"];
  const kinds=Array.isArray(kind)?kind:[kind];
  if(kinds.includes(wanted))out.push(value);
  for(const child of Object.values(value))collectType(child,wanted,out);
  return out;
}

function sameBhxUrl(a,b){
  try{return canonicalBhx(a)===canonicalBhx(b);}catch{return false;}
}

function matchingProduct(roots,url,h1){
  const products=[];
  for(const root of roots)collectType(root,"Product",products);
  for(const p of products){
    const candidates=[p.url,p["@id"],p.mainEntityOfPage&&p.mainEntityOfPage["@id"]].filter(Boolean);
    if(candidates.some(x=>sameBhxUrl(x,url)))return p;
  }
  if(products.length===1){
    const name=cleanText(products[0].name||"");
    if(name&&h1&&name.toLowerCase()===h1.toLowerCase())return products[0];
  }
  return null;
}

function breadcrumbs(roots){
  const found=[];
  for(const root of roots)collectType(root,"BreadcrumbList",found);
  const list=found[0]&&Array.isArray(found[0].itemListElement)?found[0].itemListElement:[];
  const out=[];
  for(const item of list){
    if(!item||typeof item!=="object")continue;
    let name=item.name;
    if(!name&&item.item&&typeof item.item==="object")name=item.item.name;
    name=cleanText(name||"");
    if(name&&!out.includes(name))out.push(name);
  }
  return out;
}

function parseMoney(v){
  if(v===null||v===undefined||v==="")return null;
  if(typeof v==="number")return v>0?Math.round(v):null;
  const digits=String(v).replace(/[^0-9]/g,"");
  if(!digits)return null;
  const n=Number(digits);
  return Number.isFinite(n)&&n>0?n:null;
}

function offerPrice(product){
  let offers=product&&product.offers;
  if(Array.isArray(offers))offers=offers[0];
  if(!offers||typeof offers!=="object")return null;
  for(const k of ["price","lowPrice","highPrice"]){
    const n=parseMoney(offers[k]);
    if(n)return n;
  }
  return null;
}

function visibleLines(html){
  let s=String(html||"")
    .replace(/<script\b[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[\s\S]*?<\/style>/gi," ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi," ");
  s=s.replace(/<\/?(?:div|p|li|section|article|header|footer|main|span|br|h[1-6])\b[^>]*>/gi,"\n");
  s=decodeEntities(s.replace(/<[^>]*>/g," "));
  return s.split(/\n+/).map(cleanText).filter(Boolean);
}

function moneyCandidates(text){
  const out=[];
  const re=/(?:^|[^0-9])(\d{1,3}(?:[.\s]\d{3})+|\d{4,9})\s*(?:₫|đ|vnđ)/gi;
  let m;
  while((m=re.exec(String(text||"")))){
    const n=parseMoney(m[1]);
    if(n&&!out.includes(n))out.push(n);
  }
  return out;
}

function promotionInfo(lines,current){
  const found=[];
  const values=[];
  for(const line of lines){
    const low=line.toLowerCase();
    if(!PROMO_WORDS.some(w=>low.includes(w)))continue;
    if(line.length>240)continue;
    if(!found.includes(line))found.push(line);
    for(const n of moneyCandidates(line))if(!values.includes(n))values.push(n);
    if(found.length>=4)break;
  }
  const plausible=values.filter(x=>x>=1000);
  const below=current?plausible.filter(x=>x<=current):plausible;
  return {
    active:found.length>0,
    price:(below[0]||plausible[0]||null),
    text:found.slice(0,3).join(" · ")
  };
}

function packagingInfo(name){
  const text=cleanText(name).toLowerCase();
  const pack=text.match(/\b(thùng|lốc|hộp|túi|khay|combo)\s*(\d+)\s*(gói|chai|lon|hộp|túi|cái|viên|ly|hũ|thùng|lốc|khay|can)?\b/i);
  const size=text.match(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|lít|lit|l|ml)\b/i);
  const parts=[];
  if(pack)parts.push(cleanText(pack[1]+" "+pack[2]+" "+(pack[3]||"")));
  if(size)parts.push(cleanText(size[0]));
  return {text:parts.join(" × ")};
}

function classifyGroup(url,crumbs,name){
  const filtered=crumbs.filter(x=>!["trang chủ","bách hóa xanh"].includes(x.toLowerCase()));
  if(filtered.length&&name&&filtered[filtered.length-1].toLowerCase()===name.toLowerCase())filtered.pop();
  const fallback=(pathParts(url)[0]||"").split("-").map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(" ");
  if(filtered.length>=2)return {group:filtered[0],branch:filtered[filtered.length-1]};
  if(filtered.length===1)return {group:filtered[0],branch:fallback||filtered[0]};
  return {group:fallback,branch:fallback};
}

function parseProduct(url,html,roots){
  const h1=firstH1(html)||metaContent(html,"og:title");
  const product=matchingProduct(roots,url,h1);
  const metaPrice=parseMoney(metaContent(html,"price"));
  let current=offerPrice(product)||metaPrice;
  const lines=visibleLines(html);
  if(!current){
    const prices=moneyCandidates(lines.slice(0,180).join(" "));
    current=prices[0]||null;
  }
  if(!product&&!(h1&&current))return null;
  const name=cleanText((product&&product.name)||h1||slugTitle(url));
  const crumbs=breadcrumbs(roots);
  const cls=classifyGroup(url,crumbs,name);
  let image=product&&product.image||metaContent(html,"og:image")||"";
  if(Array.isArray(image))image=image[0]||"";
  if(image&&typeof image==="object")image=image.url||"";
  const promo=promotionInfo(lines,current);
  return {
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    group:cls.group,
    branch:cls.branch,
    name,
    packaging:packagingInfo(name),
    price:{current,original:null},
    promotion:promo,
    url:canonicalBhx(url),
    image:String(image||""),
    breadcrumbs:crumbs,
    last_checked_at:new Date().toISOString()
  };
}

function anchorAttr(attrs,name){
  const re=new RegExp("\\b"+name+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i");
  const m=String(attrs||"").match(re);
  return m?(m[1]||m[2]||m[3]||""):"";
}

function discoverChildren(inputUrl,html,categoryName){
  const base=canonicalBhx(inputUrl);
  const baseFirst=pathParts(base)[0]||"";
  const out=[];
  const seen=new Set();
  const re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(String(html||"")))){
    const href=anchorAttr(m[1],"href");
    if(!href)continue;
    let absolute;
    try{absolute=new URL(decodeEntities(href),base).toString();}catch{continue;}
    let url;
    try{url=canonicalBhx(absolute);}catch{continue;}
    if(url===base||seen.has(url))continue;
    const parts=pathParts(url);
    if(parts.length<2||parts[0]!==baseFirst)continue;
    if(BAD_PATH.some(x=>parts.includes(x)))continue;
    let name=stripTags(m[2]);
    if(name.length<3)name=slugTitle(url);
    if(name.length>180)name=name.slice(0,177)+"...";
    const price=moneyCandidates(name)[0]||null;
    seen.add(url);
    out.push({
      source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
      link_type:"product",
      group:categoryName,
      branch:categoryName,
      name,
      packaging:{text:""},
      price:{current:price,original:null},
      promotion:{active:false,price:null,text:""},
      url,
      image:"",
      breadcrumbs:[],
      last_checked_at:new Date().toISOString()
    });
    if(out.length>=60)break;
  }
  return out;
}


function bhxApiHeaders(categorySlug){
  const deviceToken=crypto.randomUUID().replace(/-/g,"").toUpperCase();
  const deviceId=crypto.randomUUID();
  const referer="https://www.bachhoaxanh.com/"+categorySlug;
  return {
    "accept":"application/json, text/plain, */*",
    "content-type":"application/json",
    "authorization":"Bearer "+deviceToken,
    "deviceid":deviceId,
    "xapikey":"bhx-api-core-2022",
    "platform":"webnew",
    "reversehost":"http://bhxapi.live",
    "origin":"https://www.bachhoaxanh.com",
    "referer":referer,
    "referer-url":referer,
    "customer-id":"",
    "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
  };
}

function apiProductToPayloadProduct(raw){
  if(!raw||typeof raw!=="object"||!raw.url)return null;
  let url;
  try{url=canonicalBhx(new URL(String(raw.url),"https://www.bachhoaxanh.com").toString());}
  catch{return null;}
  const prices=Array.isArray(raw.productPrices)?raw.productPrices:[];
  const priceRow=prices[0]&&typeof prices[0]==="object"?prices[0]:{};
  const current=parseMoney(priceRow.price||raw.price);
  const sys=parseMoney(priceRow.sysPrice);
  const original=sys&&current&&sys>current?sys:null;
  const category=raw.category&&typeof raw.category==="object"?raw.category:{};
  const group=cleanText(category.name||"");
  const branch=cleanText(raw.brandName||group);
  const promoText=cleanText(
    raw.promotionText||raw.promotionTextFS||raw.textPromtionNonBlue||""
  );
  const discount=Number(priceRow.discountPercent||0);
  const promoActive=Boolean(promoText||discount>0);
  return {
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    group,
    branch,
    name:cleanText(raw.fullName||raw.name||slugTitle(url)),
    packaging:{text:cleanText(raw.canonical||raw.unit||"")},
    price:{current,original},
    promotion:{
      active:promoActive,
      price:promoActive?current:null,
      text:promoText
    },
    url,
    image:String(raw.avatar||""),
    breadcrumbs:[group,branch].filter(Boolean),
    last_checked_at:new Date().toISOString()
  };
}

async function fetchBhxApiPayload(inputUrl,requestId){
  const canonical=canonicalBhx(inputUrl);
  const parts=pathParts(canonical);
  if(!parts.length)return null;
  const categorySlug=parts.length>=2?parts[0]:parts[0];
  const params=new URLSearchParams({
    provinceId:"1027",
    wardId:"0",
    districtId:"0",
    storeId:"2546",
    categoryUrl:categorySlug,
    isMobile:"true",
    isV2:"true",
    pageSize:"300"
  });
  const api="https://api.bachhoaxanh.com/gw/Category/V2/GetCate?"+params.toString();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  let response;
  try{
    response=await fetch(api,{
      headers:bhxApiHeaders(categorySlug),
      signal:controller.signal
    });
  }finally{
    clearTimeout(timer);
  }
  if(!response.ok)throw new Error("bhx_api_http_"+response.status);
  const data=await response.json();
  if(!data||Number(data.code)!==0||!data.data)throw new Error("bhx_api_invalid");
  const rawProducts=Array.isArray(data.data.products)?data.data.products:[];
  const products=rawProducts.map(apiProductToPayloadProduct).filter(Boolean);
  if(!products.length)throw new Error("bhx_api_empty");

  const checked=new Date().toISOString();
  if(parts.length>=2){
    const exact=products.find(p=>sameBhxUrl(p.url,canonical));
    if(!exact)throw new Error("bhx_api_product_not_found");
    return {
      schema_version:2,
      request_id:requestId,
      input_url:canonical,
      input_type:"product",
      source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
      checked_at:checked,
      category_name:exact.group||"",
      product:exact,
      products:[exact],
      discovered_links:[]
    };
  }

  const categoryName=cleanText(
    (rawProducts[0]&&rawProducts[0].category&&rawProducts[0].category.name)||
    slugTitle(canonical)
  );
  return {
    schema_version:2,
    request_id:requestId,
    input_url:canonical,
    input_type:"category",
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    checked_at:checked,
    category_name:categoryName,
    product:null,
    products,
    discovered_links:products.map(p=>p.url)
  };
}


async function fetchSupabaseBhxPayload(inputUrl,requestId){
  const endpoint="https://gcnoahqsrquxkwkjbuxy.supabase.co/functions/v1/getlink-bhx-proxy";
  const key="sb_publishable_UY3gfQ9MsntDFCUJ_uV0UA__eTYXz_w";
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),18000);
  let response;
  try{
    response=await fetch(endpoint,{
      method:"POST",
      headers:{
        "content-type":"application/json",
        "apikey":key,
        "authorization":"Bearer "+key
      },
      body:JSON.stringify({url:browserBhxUrl(inputUrl)}),
      signal:controller.signal
    });
  }finally{
    clearTimeout(timer);
  }
  if(!response.ok)throw new Error("supabase_proxy_http_"+response.status);
  const envelope=await response.json();
  if(!envelope||envelope.ok!==true||!envelope.payload)throw new Error(
    "supabase_proxy_"+String(envelope&&envelope.status||envelope&&envelope.error||"failed")
  );
  const data=envelope.payload;
  if(!data||Number(data.code)!==0||!data.data)throw new Error("supabase_bhx_invalid");

  const canonical=canonicalBhx(inputUrl);
  const parts=pathParts(canonical);
  const rawProducts=Array.isArray(data.data.products)?data.data.products:[];
  const products=rawProducts.map(apiProductToPayloadProduct).filter(Boolean);
  if(!products.length)throw new Error("supabase_bhx_empty");
  const checked=new Date().toISOString();

  if(parts.length>=2){
    const exact=products.find(p=>sameBhxUrl(p.url,canonical));
    if(!exact)throw new Error("supabase_bhx_product_not_found");
    return {
      schema_version:2,
      request_id:requestId,
      input_url:canonical,
      input_type:"product",
      source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
      checked_at:checked,
      category_name:exact.group||"",
      product:exact,
      products:[exact],
      discovered_links:[]
    };
  }

  const categoryName=cleanText(
    (rawProducts[0]&&rawProducts[0].category&&rawProducts[0].category.name)||
    slugTitle(canonical)
  );
  return {
    schema_version:2,
    request_id:requestId,
    input_url:canonical,
    input_type:"category",
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    checked_at:checked,
    category_name:categoryName,
    product:null,
    products,
    discovered_links:products.map(p=>p.url)
  };
}


function mirrorRowToProduct(row){
  if(!row||typeof row!=="object"||!row.product_url)return null;
  let url;
  try{url=canonicalBhx(row.product_url);}catch{return null;}
  const current=parseMoney(row.price_vnd);
  const rawOriginal=parseMoney(row.original_price_vnd);
  const original=rawOriginal&&current&&rawOriginal>current?rawOriginal:null;
  const discount=Number(row.discount_pct||0);
  return {
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    group:cleanText(row.category_name||""),
    branch:cleanText(row.brand||row.category_name||""),
    name:cleanText(row.product_name||slugTitle(url)),
    packaging:{text:cleanText(row.canonical_weight_raw||row.unit_type||"")},
    price:{current,original},
    promotion:{
      active:discount>0,
      price:discount>0?current:null,
      text:discount>0?("Giảm "+discount+"%"):""
    },
    url,
    image:String(row.image_url||""),
    breadcrumbs:[row.category_name,row.brand].filter(Boolean),
    last_checked_at:String(row.scrape_ts||"2026-04-12T00:00:00+07:00"),
    snapshot_date:String(row.scrape_date||"2026-04-12")
  };
}

async function fetchMirrorSnapshotPayload(inputUrl,requestId){
  const canonical=canonicalBhx(inputUrl);
  const parts=pathParts(canonical);
  if(!parts.length)throw new Error("mirror_missing_category");
  const categorySlug=parts.length>=2?parts[0]:parts[0];
  const raw=
    "https://raw.githubusercontent.com/1sl2tp/getlink/main/"+
    "data/snapshots/bhx/2026-04-12/"+
    encodeURIComponent(categorySlug)+".json";
  const response=await fetch(raw,{
    headers:{"user-agent":"getlink-worker"},
    cf:{cacheTtl:3600,cacheEverything:true}
  });
  if(!response.ok)throw new Error("mirror_http_"+response.status);
  const rows=await response.json();
  if(!Array.isArray(rows)||!rows.length)throw new Error("mirror_empty");
  const products=rows.map(mirrorRowToProduct).filter(Boolean);
  if(!products.length)throw new Error("mirror_no_products");
  const snapshotDate=String(rows[0].scrape_date||"2026-04-12");

  if(parts.length>=2){
    const exact=products.find(p=>sameBhxUrl(p.url,canonical));
    if(!exact)throw new Error("mirror_product_not_found");
    return {
      schema_version:2,
      request_id:requestId,
      input_url:canonical,
      input_type:"product",
      source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
      checked_at:exact.last_checked_at,
      category_name:exact.group||"",
      product:exact,
      products:[exact],
      discovered_links:[],
      data_mode:"snapshot",
      snapshot_date:snapshotDate,
      snapshot_source:"public-bhx-mirror"
    };
  }

  const categoryName=products[0].group||slugTitle(canonical);
  return {
    schema_version:2,
    request_id:requestId,
    input_url:canonical,
    input_type:"category",
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    checked_at:products[0].last_checked_at,
    category_name:categoryName,
    product:null,
    products,
    discovered_links:products.map(p=>p.url),
    data_mode:"snapshot",
    snapshot_date:snapshotDate,
    snapshot_source:"public-bhx-mirror"
  };
}

async function renderBhxHtml(env,url){
  if(!env.BROWSER||typeof env.BROWSER.quickAction!=="function")throw new Error("browser_binding_missing");
  const response=await env.BROWSER.quickAction("content",{
    url:browserBhxUrl(url),
    gotoOptions:{waitUntil:"networkidle2",timeout:30000},
    rejectResourceTypes:["image","media","font"]
  });
  if(!response.ok){
    const detail=(await response.text()).slice(0,500);
    throw new Error("browser_run_"+response.status+":"+detail);
  }
  const data=await response.json();
  if(!data||data.success!==true||typeof data.result!=="string")throw new Error("browser_run_invalid_result");
  return data.result;
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

async function persistEntry(env,p,parentUrl,requestId,checked,linkType){
  const url=canonicalBhx(p.url);
  const price=p.price||{};
  const promo=p.promotion||{};
  const id=await upsertLink(env,{
    canonical_url:url,
    source:p.source&&p.source.name||"Bách Hóa XANH",
    link_type:linkType,
    parent_url:parentUrl||null,
    group_name:p.group||"",
    branch_name:p.branch||"",
    name:p.name||"",
    packaging:p.packaging&&p.packaging.text||"",
    current_price:Number(price.current)||null,
    original_price:Number(price.original)||null,
    promotion_price:Number(promo.price)||null,
    promotion_text:promo.text||"",
    last_checked_at:p.last_checked_at||checked,
    last_status:"ok",
    last_request_id:requestId
  });
  if(linkType==="product"&&(Number(price.current)||Number(promo.price))){
    await env.DB.prepare(`
      INSERT OR IGNORE INTO price_snapshots(
        link_id,request_id,checked_at,current_price,original_price,promotion_price,promotion_text,result_json
      ) VALUES(?,?,?,?,?,?,?,?)
    `).bind(
      id,requestId,p.last_checked_at||checked,Number(price.current)||null,
      Number(price.original)||null,Number(promo.price)||null,promo.text||"",JSON.stringify(p)
    ).run();
  }
}

async function persistPayload(env,payload){
  const checked=payload.checked_at||new Date().toISOString();
  const inputUrl=canonicalBhx(payload.input_url);
  if(payload.input_type==="product"&&payload.product){
    await persistEntry(env,payload.product,null,payload.request_id,checked,"product");
  }else{
    await upsertLink(env,{
      canonical_url:inputUrl,
      source:"Bách Hóa XANH",
      link_type:"category",
      parent_url:null,
      group_name:payload.category_name||"",
      branch_name:"",
      name:payload.category_name||slugTitle(inputUrl),
      packaging:"",
      last_checked_at:checked,
      last_status:"ok",
      last_request_id:payload.request_id
    });
    for(const child of payload.products||[]){
      await persistEntry(env,child,inputUrl,payload.request_id,checked,child.link_type==="category"?"category":"product");
    }
  }
  const resultJson=JSON.stringify(payload);
  await env.DB.prepare(
    "UPDATE jobs SET link_type=?,status='complete',result_json=?,error=NULL,updated_at=? WHERE request_id=?"
  ).bind(payload.input_type,resultJson,new Date().toISOString(),payload.request_id).run();
  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first();
  return {payload,registry_count:Number(count&&count.n||0)};
}

async function handleCreate(request,env,origin){
  let body;
  try{body=await request.json();}catch{return json({error:"invalid_json"},400,origin);}
  let url;
  try{url=canonicalBhx(body.url);}catch{return json({error:"invalid_bhx_url"},400,origin);}
  const requestId=crypto.randomUUID().replace(/-/g,"");
  const now=new Date().toISOString();
  const initialType=heuristicType(url);

  await env.DB.prepare(`
    INSERT INTO jobs(request_id,input_url,canonical_url,link_type,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)
  `).bind(requestId,url,url,initialType,"running",now,now).run();

  await upsertLink(env,{
    canonical_url:url,
    source:"Bách Hóa XANH",
    link_type:initialType,
    parent_url:null,
    name:"",
    last_checked_at:now,
    last_status:"running",
    last_request_id:requestId
  });

  try{
    const apiPayload=await fetchBhxApiPayload(url,requestId);
    const apiSaved=await persistPayload(env,apiPayload);
    return json({
      request_id:requestId,
      status:"complete",
      input_url:url,
      link_type:apiPayload.input_type,
      registry_count:apiSaved.registry_count,
      payload:apiPayload,
      engine:"bhx-api"
    },200,origin);
  }catch(apiError){
    // BHX có thể chặn một số datacenter; thử qua Supabase edge trước.
  }

  try{
    const supaPayload=await fetchSupabaseBhxPayload(url,requestId);
    const supaSaved=await persistPayload(env,supaPayload);
    return json({
      request_id:requestId,
      status:"complete",
      input_url:url,
      link_type:supaPayload.input_type,
      registry_count:supaSaved.registry_count,
      payload:supaPayload,
      engine:"supabase-bhx-api"
    },200,origin);
  }catch(supabaseError){
    // Live API vẫn bị chặn; dùng snapshot công khai chỉ để có dữ liệu fallback minh bạch.
  }

  try{
    const mirrorPayload=await fetchMirrorSnapshotPayload(url,requestId);
    const mirrorSaved=await persistPayload(env,mirrorPayload);
    return json({
      request_id:requestId,
      status:"complete",
      input_url:url,
      link_type:mirrorPayload.input_type,
      registry_count:mirrorSaved.registry_count,
      payload:mirrorPayload,
      engine:"public-snapshot",
      snapshot_date:mirrorPayload.snapshot_date
    },200,origin);
  }catch(mirrorError){
    // Không có snapshot phù hợp thì tiếp tục Browser/GitHub fallback.
  }

  try{
    const html=await renderBhxHtml(env,url);
    const roots=jsonLdRoots(html);
    const product=parseProduct(url,html,roots);
    let payload;
    if(product){
      payload={
        schema_version:2,
        request_id:requestId,
        input_url:url,
        input_type:"product",
        source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
        checked_at:new Date().toISOString(),
        category_name:"",
        product,
        products:[product],
        discovered_links:[]
      };
    }else{
      const categoryName=firstH1(html)||metaContent(html,"og:title")||slugTitle(url);
      const children=discoverChildren(url,html,categoryName);
      payload={
        schema_version:2,
        request_id:requestId,
        input_url:url,
        input_type:"category",
        source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
        checked_at:new Date().toISOString(),
        category_name:categoryName,
        product:null,
        products:children,
        discovered_links:children.map(x=>x.url)
      };
    }
    const saved=await persistPayload(env,payload);
    return json({
      request_id:requestId,
      status:"complete",
      input_url:url,
      link_type:payload.input_type,
      registry_count:saved.registry_count
    },200,origin);
  }catch(error){
    const browserError=String(error&&error.message||error).slice(0,800);
    if(!env.GITHUB_TOKEN){
      const detail=browserError+"; github_fallback_not_configured";
      await env.DB.prepare(
        "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
      ).bind(detail,new Date().toISOString(),requestId).run();
      await env.DB.prepare(
        "UPDATE links SET last_status='error',updated_at=? WHERE canonical_url=?"
      ).bind(new Date().toISOString(),url).run();
      return json({error:"github_fallback_not_configured",detail:browserError,request_id:requestId},503,origin);
    }

    try{
      const r=await dispatchGithub(env,browserBhxUrl(url),requestId);
      if(!r.ok){
        const detail=(await r.text()).slice(0,700);
        throw new Error("github_dispatch_"+r.status+":"+detail);
      }
      await env.DB.prepare(
        "UPDATE jobs SET status='queued',error=NULL,updated_at=? WHERE request_id=?"
      ).bind(new Date().toISOString(),requestId).run();
      await env.DB.prepare(
        "UPDATE links SET last_status='queued',updated_at=? WHERE canonical_url=?"
      ).bind(new Date().toISOString(),url).run();
      return json({
        request_id:requestId,
        status:"queued",
        input_url:url,
        link_type:initialType,
        engine:"github",
        browser_error:browserError
      },202,origin);
    }catch(dispatchError){
      const detail=String(dispatchError&&dispatchError.message||dispatchError).slice(0,900);
      await env.DB.prepare(
        "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
      ).bind(detail,new Date().toISOString(),requestId).run();
      await env.DB.prepare(
        "UPDATE links SET last_status='error',updated_at=? WHERE canonical_url=?"
      ).bind(new Date().toISOString(),url).run();
      return json({error:"github_dispatch_failed",detail,request_id:requestId},502,origin);
    }
  }
}

async function handleResult(url,env,origin){
  const id=String(url.searchParams.get("id")||"").replace(/[^a-zA-Z0-9_-]/g,"");
  if(!id)return json({error:"missing_id"},400,origin);
  const job=await env.DB.prepare("SELECT * FROM jobs WHERE request_id=?").bind(id).first();
  if(!job)return json({error:"not_found"},404,origin);
  if(job.status==="complete"&&job.result_json){
    const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first();
    return json({
      status:"complete",
      payload:JSON.parse(job.result_json),
      registry_count:Number(count&&count.n||0)
    },200,origin);
  }
  if(job.status==="error")return json({status:"error",error:job.error||"unknown"},200,origin);

  try{
    const payload=await readGithubJob(id);
    if(payload){
      if(payload.status==="error"){
        const message=String(payload.error||payload.detail||"Không lấy được dữ liệu từ Bách Hóa XANH").slice(0,900);
        await env.DB.prepare(
          "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
        ).bind(message,new Date().toISOString(),id).run();
        return json({status:"error",error:message},200,origin);
      }
      if(!payload.request_id)payload.request_id=id;
      const saved=await persistPayload(env,payload);
      return json({status:"complete",...saved},200,origin);
    }
  }catch(error){
    return json({
      status:"running",
      request_id:id,
      detail:String(error&&error.message||error).slice(0,500)
    },200,origin);
  }
  return json({status:job.status||"running",request_id:id},200,origin);
}

async function handleLinks(url,env,origin){
  const limit=Math.min(200,Math.max(1,Number(url.searchParams.get("limit")||50)));
  const type=String(url.searchParams.get("type")||"");
  const q=String(url.searchParams.get("q")||"").trim();
  const parent=String(url.searchParams.get("parent")||"").trim();
  let sql=`
    SELECT l.*,
      (SELECT COUNT(*) FROM links c WHERE c.parent_url=l.canonical_url) AS child_count
    FROM links l WHERE 1=1
  `;
  const binds=[];
  if(type==="product"||type==="category"){sql+=" AND l.link_type=?";binds.push(type);}
  if(parent){sql+=" AND l.parent_url=?";binds.push(canonicalBhx(parent));}
  if(q){
    sql+=" AND (l.name LIKE ? OR l.group_name LIKE ? OR l.branch_name LIKE ? OR l.canonical_url LIKE ?)";
    const like="%"+q+"%";
    binds.push(like,like,like,like);
  }
  sql+=" ORDER BY l.updated_at DESC LIMIT ?";
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
      if(request.method==="GET"&&url.pathname==="/health"){
        const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first();
        return json({ok:true,browser:Boolean(env.BROWSER),github_fallback:Boolean(env.GITHUB_TOKEN),links:Number(count&&count.n||0)},200,origin||"*");
      }
      return json({error:"not_found"},404,origin||"*");
    }catch(error){
      return json({error:"server_error",detail:String(error&&error.message||error)},500,origin||"*");
    }
  }
};
