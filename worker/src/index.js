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
  const configured=String(
    env.ALLOWED_ORIGINS||"https://get.taphoa.xyz,https://1sl2tp.github.io"
  ).split(",").map(x=>x.trim()).filter(Boolean);
  return configured.includes(origin)?origin:null;
}

function canonicalBhx(raw){
  const u=new URL(String(raw||""));
  const host=u.hostname.toLowerCase();
  if(host!=="bachhoaxanh.com"&&host!=="www.bachhoaxanh.com"){
    throw new Error("invalid_bhx_url");
  }
  const path=(u.pathname||"/").replace(/\/+/g,"/").replace(/\/+$/,"")||"/";
  return "https://bachhoaxanh.com"+path;
}

function browserBhxUrl(raw){
  const u=new URL(canonicalBhx(raw));
  return "https://www.bachhoaxanh.com"+u.pathname;
}

function pathParts(url){
  return new URL(url).pathname.split("/").filter(Boolean);
}

function heuristicType(url){
  return pathParts(url).length<=1?"category":"product";
}

function cleanText(v){
  return String(v||"").replace(/\s+/g," ").trim();
}

function parseMoney(v){
  if(v===null||v===undefined||v==="")return null;
  if(typeof v==="number")return v>0?Math.round(v):null;
  const digits=String(v).replace(/[^0-9]/g,"");
  if(!digits)return null;
  const n=Number(digits);
  return Number.isFinite(n)&&n>0?n:null;
}

function vnDate(iso){
  const d=iso?new Date(iso):new Date();
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Ho_Chi_Minh",
    year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(d);
  const map=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return map.year+"-"+map.month+"-"+map.day;
}

function parseSize(text){
  const s=cleanText(text).toLowerCase().replace(/,/g,".");
  const m=s.match(/(\d+(?:\.\d+)?)\s*(ml|lít|lit|l|kg|g)\b/i);
  if(!m)return {value:null,unit:""};
  const value=Number(m[1]);
  const unit=m[2].toLowerCase();
  if(!Number.isFinite(value)||value<=0)return {value:null,unit:""};
  if(unit==="l"||unit==="lit"||unit==="lít"){
    return {value:Math.round(value*1000),unit:"ml"};
  }
  if(unit==="kg"){
    return {value:Math.round(value*1000),unit:"g"};
  }
  return {value,unit};
}

function comparisonData({name,featureText,packCount,packUnit,current,sysPrice,discount,promoText}){
  const quantity=Number(packCount)>0?Number(packCount):1;
  const regular=Number(sysPrice)>0?Number(sysPrice):(Number(current)||null);
  const currentPrice=Number(current)||null;
  const promoActive=Boolean(
    Number(discount)>0||
    (regular&&currentPrice&&currentPrice<regular)||
    cleanText(promoText)
  );
  const promo=promoActive?currentPrice:null;
  const size=parseSize([name,featureText].filter(Boolean).join(" "));
  return {
    pack_quantity:quantity,
    pack_unit:cleanText(packUnit||""),
    size_value:size.value,
    size_unit:size.unit,
    regular_pack_price:regular,
    promo_pack_price:promo,
    regular_unit_price:regular?Math.round(regular/quantity):null,
    promo_unit_price:promo?Math.round(promo/quantity):null,
    promotion_active:promoActive,
    promotion_text:cleanText(promoText||""),
    price_kind:promoActive?"promotion":"regular"
  };
}

async function loadFreshCache(env,url,maxAgeMs=86400000){
  const row=await env.DB.prepare(
    "SELECT result_json,updated_at FROM jobs WHERE canonical_url=? AND status='complete' AND result_json IS NOT NULL ORDER BY updated_at DESC LIMIT 1"
  ).bind(url).first();
  if(!row||!row.result_json||!row.updated_at)return null;
  const checked=Date.parse(row.updated_at);
  if(!Number.isFinite(checked))return null;
  const ageMs=Date.now()-checked;
  if(ageMs<0||ageMs>=maxAgeMs)return null;
  try{
    return {
      payload:JSON.parse(row.result_json),
      age_seconds:Math.max(0,Math.round(ageMs/1000))
    };
  }catch{
    return null;
  }
}

function slugTitle(url){
  try{
    const parts=pathParts(url);
    const slug=parts[parts.length-1]||"Danh mục";
    return slug.split("-").filter(Boolean)
      .map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(" ");
  }catch{
    return "Danh mục";
  }
}

function sameBhxUrl(a,b){
  try{return canonicalBhx(a)===canonicalBhx(b);}
  catch{return false;}
}

async function idForUrl(value){
  const bytes=new TextEncoder().encode(String(value||""));
  const buf=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(buf)).slice(0,12)
    .map(x=>x.toString(16).padStart(2,"0")).join("");
}

async function dispatchGithub(env,url,requestId){
  if(!env.GITHUB_TOKEN)throw new Error("github_token_missing");
  return fetch(
    "https://api.github.com/repos/"+OWNER+"/"+REPO+
    "/actions/workflows/"+WORKFLOW+"/dispatches",
    {
      method:"POST",
      headers:{
        "accept":"application/vnd.github+json",
        "authorization":"Bearer "+env.GITHUB_TOKEN,
        "content-type":"application/json",
        "x-github-api-version":"2026-03-10",
        "user-agent":"getlink-worker"
      },
      body:JSON.stringify({
        ref:"main",
        inputs:{url,request_id:requestId}
      })
    }
  );
}

async function readGithubJob(requestId){
  const safe=String(requestId||"").replace(/[^A-Za-z0-9_-]/g,"");
  if(!safe)return null;
  const raw=
    "https://raw.githubusercontent.com/"+OWNER+"/"+REPO+
    "/main/data/jobs/"+safe+".json?ts="+Date.now();
  const r=await fetch(raw,{
    headers:{"user-agent":"getlink-worker"},
    cf:{cacheTtl:0,cacheEverything:false}
  });
  if(r.status===404)return null;
  if(!r.ok)throw new Error("github_result_"+r.status);
  return r.json();
}

function apiProductToPayloadProduct(raw){
  if(!raw||typeof raw!=="object"||!raw.url)return null;
  let url;
  try{
    url=canonicalBhx(
      new URL(String(raw.url),"https://www.bachhoaxanh.com").toString()
    );
  }catch{
    return null;
  }

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

  return {
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    group,
    branch,
    name:cleanText(raw.fullName||raw.name||slugTitle(url)),
    packaging:{text:cleanText(raw.canonical||raw.unit||"")},
    comparison:comparisonData({
      name:cleanText(raw.fullName||raw.name||slugTitle(url)),
      featureText:"",
      packCount:raw.packageItemCount,
      packUnit:raw.packageItemUnit||raw.unit,
      current,
      sysPrice:sys,
      discount,
      promoText
    }),
    price:{current,original},
    promotion:{
      active:Boolean(promoText||discount>0),
      price:discount>0?current:null,
      text:promoText
    },
    url,
    image:String(raw.avatar||""),
    breadcrumbs:[group,branch].filter(Boolean),
    last_checked_at:new Date().toISOString()
  };
}

function apiBoxBuyToProduct(raw,data){
  if(!raw||typeof raw!=="object"||!raw.url)return null;
  let url;
  try{
    url=canonicalBhx(
      new URL(String(raw.url),"https://www.bachhoaxanh.com").toString()
    );
  }catch{
    return null;
  }

  const prices=Array.isArray(raw.productPrices)?raw.productPrices:[];
  const priceRow=prices[0]&&typeof prices[0]==="object"?prices[0]:{};
  const current=parseMoney(priceRow.price);
  const sysPrice=parseMoney(priceRow.sysPrice);
  const discount=Number(priceRow.discountPercent||0);
  const promoText=cleanText(
    raw.promotionText||
    (Array.isArray(data&&data.promotionTexts)?data.promotionTexts.join(" · "):"")
  );
  const packaging=cleanText(
    raw.title||
    [raw.packageItemCount,raw.packageItemUnit].filter(Boolean).join(" ")||
    raw.textAvgPriceUnit||
    ""
  );
  const name=cleanText(raw.name||slugTitle(url));
  const comparison=comparisonData({
    name,
    featureText:data&&data.productBo&&data.productBo.featureSpecification||"",
    packCount:raw.packageItemCount,
    packUnit:raw.packageItemUnit,
    current,
    sysPrice,
    discount,
    promoText
  });

  return {
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    group:cleanText(data&&data.categoryName||""),
    branch:cleanText(data&&data.brandUrl||data&&data.categoryName||""),
    name,
    packaging:{text:packaging},
    comparison,
    price:{current,original:null,sys_price:sysPrice},
    promotion:{
      active:Boolean(promoText||discount>0),
      price:discount>0?current:null,
      text:promoText
    },
    url,
    image:String(raw.avatar||""),
    breadcrumbs:[data&&data.categoryName,data&&data.brandUrl].filter(Boolean),
    last_checked_at:new Date().toISOString(),
    variant:{
      bhx_product_id:Number(raw.id)||null,
      product_code:String(raw.productCode||""),
      title:cleanText(raw.title||""),
      package_item_count:Number(raw.packageItemCount)||null,
      package_item_unit:cleanText(raw.packageItemUnit||""),
      sys_price:sysPrice,
      discount_percent:discount,
      stock:Number(priceRow.quantity)||0,
      is_can_buy:Boolean(priceRow.isCanBuy),
      text_status:cleanText(priceRow.textStatus||""),
      store_id:Number(priceRow.storeId)||null,
      po_date:String(priceRow.poDate||""),
      raw
    }
  };
}

function productDetailPayload(inputUrl,requestId,data){
  const canonical=canonicalBhx(inputUrl);
  const variants=(Array.isArray(data&&data.boxBuys)?data.boxBuys:[])
    .map(x=>apiBoxBuyToProduct(x,data))
    .filter(Boolean);

  if(!variants.length)throw new Error("bhx_detail_empty");

  const exact=variants.find(v=>sameBhxUrl(v.url,canonical))||variants[0];
  return {
    schema_version:3,
    request_id:requestId,
    input_url:canonical,
    input_type:"product",
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    checked_at:new Date().toISOString(),
    category_name:cleanText(data&&data.categoryName||exact.group||""),
    category_id:Number(data&&data.categoryId)||null,
    parent_category_ids:Array.isArray(data&&data.categoryParentIds)
      ?data.categoryParentIds:[],
    product:exact,
    products:[exact],
    variants,
    discovered_links:variants.map(v=>v.url)
  };
}

function categoryPayload(inputUrl,requestId,data){
  const canonical=canonicalBhx(inputUrl);
  const rawProducts=Array.isArray(data&&data.products)?data.products:[];
  const products=rawProducts.map(apiProductToPayloadProduct).filter(Boolean);
  if(!products.length)throw new Error("bhx_category_empty");

  const categoryName=cleanText(
    (rawProducts[0]&&rawProducts[0].category&&rawProducts[0].category.name)||
    slugTitle(canonical)
  );

  return {
    schema_version:3,
    request_id:requestId,
    input_url:canonical,
    input_type:"category",
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    checked_at:new Date().toISOString(),
    category_name:categoryName,
    product:null,
    products,
    variants:[],
    discovered_links:products.map(p=>p.url)
  };
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
    id,row.canonical_url,row.source||"Bách Hóa XANH",row.link_type,
    row.parent_url||null,row.group_name||"",row.branch_name||"",row.name||"",
    row.packaging||"",row.current_price??null,row.original_price??null,
    row.promotion_price??null,row.promotion_text||"",
    row.last_checked_at||new Date().toISOString(),
    row.last_status||"ok",row.last_request_id||"",
    row.created_at||new Date().toISOString(),new Date().toISOString()
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
        link_id,request_id,checked_at,current_price,original_price,
        promotion_price,promotion_text,result_json
      ) VALUES(?,?,?,?,?,?,?,?)
    `).bind(
      id,requestId,p.last_checked_at||checked,
      Number(price.current)||null,Number(price.original)||null,
      Number(promo.price)||null,promo.text||"",JSON.stringify(p)
    ).run();
  }
  return id;
}


async function persistDailyVariant(env,variantId,p,parentUrl,checked){
  const cmp=p&&p.comparison||{};
  const meta=p&&p.variant||{};
  const snapshotDate=vnDate(checked);
  const dailyId=await idForUrl(variantId+"|"+snapshotDate);
  const now=new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO daily_variant_prices(
      id,variant_id,parent_url,snapshot_date,product_name,packaging,
      pack_quantity,pack_unit,size_value,size_unit,
      regular_pack_price,promo_pack_price,regular_unit_price,promo_unit_price,
      promotion_active,promotion_text,checked_at,raw_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(variant_id,snapshot_date) DO UPDATE SET
      product_name=excluded.product_name,
      packaging=excluded.packaging,
      pack_quantity=excluded.pack_quantity,
      pack_unit=excluded.pack_unit,
      size_value=excluded.size_value,
      size_unit=excluded.size_unit,
      regular_pack_price=excluded.regular_pack_price,
      promo_pack_price=excluded.promo_pack_price,
      regular_unit_price=excluded.regular_unit_price,
      promo_unit_price=excluded.promo_unit_price,
      promotion_active=excluded.promotion_active,
      promotion_text=excluded.promotion_text,
      checked_at=excluded.checked_at,
      raw_json=excluded.raw_json,
      updated_at=excluded.updated_at
  `).bind(
    dailyId,variantId,parentUrl,snapshotDate,p.name||"",
    p.packaging&&p.packaging.text||"",
    Number(cmp.pack_quantity)||Number(meta.package_item_count)||1,
    cmp.pack_unit||meta.package_item_unit||"",
    cmp.size_value??null,cmp.size_unit||"",
    cmp.regular_pack_price??null,cmp.promo_pack_price??null,
    cmp.regular_unit_price??null,cmp.promo_unit_price??null,
    cmp.promotion_active?1:0,cmp.promotion_text||"",
    checked,JSON.stringify({comparison:cmp,variant:meta}),now,now
  ).run();
}

async function persistVariant(env,p,parentUrl,requestId,checked){
  const meta=p&&p.variant||{};
  const variantUrl=canonicalBhx(p.url);
  const key=[
    parentUrl,variantUrl,String(meta.product_code||""),
    String(meta.bhx_product_id||"")
  ].join("|");
  const id=await idForUrl(key);
  const now=new Date().toISOString();
  const price=p.price||{};

  await env.DB.prepare(`
    INSERT INTO product_variants(
      id,parent_url,variant_url,bhx_product_id,product_code,name,title,packaging,
      package_item_count,package_item_unit,current_price,sys_price,discount_percent,
      stock,is_can_buy,text_status,store_id,po_date,image,raw_json,
      last_checked_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      parent_url=excluded.parent_url,
      variant_url=excluded.variant_url,
      bhx_product_id=excluded.bhx_product_id,
      product_code=excluded.product_code,
      name=excluded.name,
      title=excluded.title,
      packaging=excluded.packaging,
      package_item_count=excluded.package_item_count,
      package_item_unit=excluded.package_item_unit,
      current_price=excluded.current_price,
      sys_price=excluded.sys_price,
      discount_percent=excluded.discount_percent,
      stock=excluded.stock,
      is_can_buy=excluded.is_can_buy,
      text_status=excluded.text_status,
      store_id=excluded.store_id,
      po_date=excluded.po_date,
      image=excluded.image,
      raw_json=excluded.raw_json,
      last_checked_at=excluded.last_checked_at,
      updated_at=excluded.updated_at
  `).bind(
    id,parentUrl,variantUrl,meta.bhx_product_id??null,
    String(meta.product_code||""),p.name||"",meta.title||"",
    p.packaging&&p.packaging.text||"",meta.package_item_count??null,
    meta.package_item_unit||"",Number(price.current)||null,
    meta.sys_price??null,meta.discount_percent??0,meta.stock??0,
    meta.is_can_buy?1:0,meta.text_status||"",meta.store_id??null,
    meta.po_date||"",p.image||"",JSON.stringify(meta.raw||{}),
    p.last_checked_at||checked,now,now
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO variant_price_snapshots(
      variant_id,request_id,checked_at,current_price,sys_price,
      discount_percent,stock,is_can_buy,po_date,raw_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `).bind(
    id,requestId,p.last_checked_at||checked,
    Number(price.current)||null,meta.sys_price??null,
    meta.discount_percent??0,meta.stock??0,
    meta.is_can_buy?1:0,meta.po_date||"",JSON.stringify(meta.raw||{})
  ).run();

  await persistDailyVariant(
    env,id,p,parentUrl,p.last_checked_at||checked
  );

  return id;
}

async function persistPayload(env,payload){
  const checked=payload.checked_at||new Date().toISOString();
  const inputUrl=canonicalBhx(payload.input_url);

  if(payload.input_type==="product"&&payload.product){
    const parts=pathParts(inputUrl);
    const categoryParent=parts.length
      ?"https://bachhoaxanh.com/"+parts[0]
      :null;

    await persistEntry(
      env,{...payload.product,url:inputUrl},
      categoryParent,payload.request_id,checked,"product"
    );

    const variants=Array.isArray(payload.variants)?payload.variants:[];
    for(const variant of variants){
      await persistVariant(env,variant,inputUrl,payload.request_id,checked);
      const variantUrl=canonicalBhx(variant.url);
      if(variantUrl!==inputUrl){
        await persistEntry(
          env,variant,inputUrl,payload.request_id,checked,"product"
        );
      }
    }
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
      await persistEntry(
        env,child,inputUrl,payload.request_id,checked,
        child.link_type==="category"?"category":"product"
      );
    }
  }

  const resultJson=JSON.stringify(payload);
  await env.DB.prepare(
    "UPDATE jobs SET link_type=?,status='complete',result_json=?,error=NULL,updated_at=? WHERE request_id=?"
  ).bind(
    payload.input_type,resultJson,new Date().toISOString(),payload.request_id
  ).run();

  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first();
  return {
    payload,
    registry_count:Number(count&&count.n||0)
  };
}

async function handleCreate(request,env,origin){
  let body;
  try{body=await request.json();}
  catch{return json({error:"invalid_json"},400,origin);}

  let url;
  try{url=canonicalBhx(body.url);}
  catch{return json({error:"invalid_bhx_url"},400,origin);}

  const cached=await loadFreshCache(env,url);
  if(cached){
    const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first();
    return json({
      request_id:cached.payload.request_id||"",
      status:"complete",
      input_url:url,
      link_type:cached.payload.input_type||heuristicType(url),
      registry_count:Number(count&&count.n||0),
      payload:cached.payload,
      engine:"d1-cache",
      cache_hit:true,
      cache_age_seconds:cached.age_seconds
    },200,origin);
  }

  const requestId=crypto.randomUUID().replace(/-/g,"");
  const now=new Date().toISOString();
  const initialType=heuristicType(url);

  await env.DB.prepare(`
    INSERT INTO jobs(
      request_id,input_url,canonical_url,link_type,status,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?)
  `).bind(
    requestId,url,url,initialType,"queued",now,now
  ).run();

  await upsertLink(env,{
    canonical_url:url,
    source:"Bách Hóa XANH",
    link_type:initialType,
    parent_url:initialType==="product"
      ?"https://bachhoaxanh.com/"+(pathParts(url)[0]||"")
      :null,
    name:"",
    last_checked_at:now,
    last_status:"queued",
    last_request_id:requestId
  });

  if(!env.GITHUB_TOKEN){
    const detail="GETLINK Worker chưa có GITHUB_TOKEN dispatcher.";
    await env.DB.prepare(
      "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
    ).bind(detail,new Date().toISOString(),requestId).run();
    return json({
      error:"github_dispatcher_missing",
      detail,
      request_id:requestId
    },503,origin);
  }

  try{
    const r=await dispatchGithub(env,browserBhxUrl(url),requestId);
    if(!r.ok){
      const detail=(await r.text()).slice(0,900);
      throw new Error("github_dispatch_"+r.status+":"+detail);
    }

    return json({
      request_id:requestId,
      status:"queued",
      input_url:url,
      link_type:initialType,
      engine:"brightdata-browser-api"
    },202,origin);
  }catch(error){
    const detail=String(error&&error.message||error).slice(0,1000);
    await env.DB.prepare(
      "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
    ).bind(detail,new Date().toISOString(),requestId).run();
    await env.DB.prepare(
      "UPDATE links SET last_status='error',updated_at=? WHERE canonical_url=?"
    ).bind(new Date().toISOString(),url).run();

    return json({
      error:"github_dispatch_failed",
      detail,
      request_id:requestId
    },502,origin);
  }
}


function callbackAuthorized(request,env){
  const expected=String(env.GITHUB_TOKEN||"");
  if(!expected)return false;
  const got=String(request.headers.get("authorization")||"");
  return got==="Bearer "+expected;
}

async function handleComplete(request,env){
  if(!callbackAuthorized(request,env)){
    return json({error:"unauthorized"},401,"");
  }

  let raw;
  try{raw=await request.json();}
  catch{return json({error:"invalid_json"},400,"");}

  const id=String(raw&&raw.request_id||"").replace(/[^A-Za-z0-9_-]/g,"");
  if(!id)return json({error:"missing_request_id"},400,"");

  const job=await env.DB.prepare(
    "SELECT * FROM jobs WHERE request_id=?"
  ).bind(id).first();
  if(!job)return json({error:"not_found"},404,"");

  if(raw.status==="error"){
    const message=String(
      raw.error||raw.detail||"Bright Data chưa lấy được API Bách Hóa XANH"
    ).slice(0,1200);
    await env.DB.prepare(
      "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
    ).bind(message,new Date().toISOString(),id).run();
    await env.DB.prepare(
      "UPDATE links SET last_status='error',updated_at=? WHERE canonical_url=?"
    ).bind(new Date().toISOString(),job.canonical_url).run();
    return json({status:"error",error:message},200,"");
  }

  if(!raw.bhx_response||!raw.bhx_response.data){
    return json({error:"missing_bhx_response"},400,"");
  }

  const inputUrl=raw.input_url||job.input_url||job.canonical_url;
  const kind=raw.kind||job.link_type;
  const normalized=kind==="product"
    ?productDetailPayload(inputUrl,id,raw.bhx_response.data)
    :categoryPayload(inputUrl,id,raw.bhx_response.data);

  normalized.capture_engine=raw.engine||"brightdata-browser-api";
  normalized.capture_country=raw.country||"";
  normalized.response_url=raw.response_url||"";

  const saved=await persistPayload(env,normalized);
  return json({
    status:"complete",
    ...saved,
    engine:normalized.capture_engine,
    country:normalized.capture_country
  },200,"");
}

async function handleResult(url,env,origin){
  const id=String(url.searchParams.get("id")||"")
    .replace(/[^A-Za-z0-9_-]/g,"");
  if(!id)return json({error:"missing_id"},400,origin);

  const job=await env.DB.prepare(
    "SELECT * FROM jobs WHERE request_id=?"
  ).bind(id).first();
  if(!job)return json({error:"not_found"},404,origin);

  if(job.status==="complete"&&job.result_json){
    const count=await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM links"
    ).first();
    return json({
      status:"complete",
      payload:JSON.parse(job.result_json),
      registry_count:Number(count&&count.n||0)
    },200,origin);
  }

  try{
    const raw=await readGithubJob(id);
    if(raw){
      if(raw.status==="error"){
        const message=String(
          raw.error||raw.detail||
          "Bright Data chưa lấy được API Bách Hóa XANH"
        ).slice(0,1200);

        await env.DB.prepare(
          "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
        ).bind(message,new Date().toISOString(),id).run();

        await env.DB.prepare(
          "UPDATE links SET last_status='error',updated_at=? WHERE canonical_url=?"
        ).bind(new Date().toISOString(),job.canonical_url).run();

        return json({
          status:"error",
          error:message,
          detail:raw.detail||""
        },200,origin);
      }

      if(raw.bhx_response&&raw.bhx_response.data){
        const inputUrl=raw.input_url||job.input_url||job.canonical_url;
        const kind=raw.kind||job.link_type;
        const normalized=kind==="product"
          ?productDetailPayload(inputUrl,id,raw.bhx_response.data)
          :categoryPayload(inputUrl,id,raw.bhx_response.data);

        normalized.capture_engine=
          raw.engine||"brightdata-browser-api";
        normalized.capture_country=raw.country||"";
        normalized.response_url=raw.response_url||"";

        const saved=await persistPayload(env,normalized);
        return json({
          status:"complete",
          ...saved,
          engine:raw.engine||"brightdata-browser-api",
          country:raw.country||""
        },200,origin);
      }
    }
  }catch(error){
    return json({
      status:job.status||"queued",
      request_id:id,
      detail:String(error&&error.message||error).slice(0,700)
    },200,origin);
  }

  if(job.status==="error"){
    return json({
      status:"error",
      error:job.error||"unknown"
    },200,origin);
  }

  return json({
    status:job.status||"queued",
    request_id:id
  },200,origin);
}

async function handleLinks(url,env,origin){
  const limit=Math.min(
    200,Math.max(1,Number(url.searchParams.get("limit")||50))
  );
  const type=String(url.searchParams.get("type")||"");
  const q=String(url.searchParams.get("q")||"").trim();
  const parent=String(url.searchParams.get("parent")||"").trim();

  let sql=`
    SELECT l.*,
      (SELECT COUNT(*) FROM links c WHERE c.parent_url=l.canonical_url)
        AS child_count
    FROM links l
    WHERE 1=1
  `;
  const binds=[];

  if(type==="product"||type==="category"){
    sql+=" AND l.link_type=?";
    binds.push(type);
  }
  if(parent){
    sql+=" AND l.parent_url=?";
    binds.push(canonicalBhx(parent));
  }
  if(q){
    sql+=`
      AND (
        l.name LIKE ? OR l.group_name LIKE ? OR
        l.branch_name LIKE ? OR l.canonical_url LIKE ?
      )
    `;
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
    if(origin===null){
      return json({error:"origin_not_allowed"},403,"");
    }

    if(request.method==="OPTIONS"){
      return new Response(null,{
        status:204,
        headers:{
          "access-control-allow-origin":origin||"*",
          "access-control-allow-methods":"GET,POST,OPTIONS",
          "access-control-allow-headers":"content-type"
        }
      });
    }

    const url=new URL(request.url);
    try{
      if(request.method==="POST"&&url.pathname==="/api/get-price"){
        return handleCreate(request,env,origin||"*");
      }
      if(request.method==="POST"&&url.pathname==="/api/complete"){
        return handleComplete(request,env);
      }
      if(request.method==="GET"&&url.pathname==="/api/result"){
        return handleResult(url,env,origin||"*");
      }
      if(request.method==="GET"&&url.pathname==="/api/links"){
        return handleLinks(url,env,origin||"*");
      }
      if(request.method==="GET"&&url.pathname==="/health"){
        const count=await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM links"
        ).first();
        return json({
          ok:true,
          mode:"brightdata-browser-api",
          dispatcher:Boolean(env.GITHUB_TOKEN),
          links:Number(count&&count.n||0)
        },200,origin||"*");
      }
      return json({error:"not_found"},404,origin||"*");
    }catch(error){
      return json({
        error:"server_error",
        detail:String(error&&error.message||error)
      },500,origin||"*");
    }
  }
};
