const BHX_HOSTS = new Set(["bachhoaxanh.com","www.bachhoaxanh.com"]);
const API_HOST = "api.bachhoaxanh.com";
const PAGE_SIZE = 10;
const CONTEXT = { provinceId:1027, wardId:0, districtId:0, storeId:2546 };

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "access-control-allow-origin":"*",
      "access-control-allow-methods":"GET,POST,OPTIONS",
      "access-control-allow-headers":"content-type"
    }
  });
}
function clean(v){ return String(v??"").replace(/\s+/g," ").trim(); }
function canonicalBhx(raw){
  const u=new URL(clean(raw));
  if(!BHX_HOSTS.has(u.hostname.toLowerCase()))throw new Error("invalid_bhx_url");
  const parts=u.pathname.split("/").filter(Boolean);
  if(parts.length!==1)throw new Error("bhx_category_url_required");
  return "https://www.bachhoaxanh.com/"+parts[0];
}
function slugFrom(url){ return new URL(url).pathname.split("/").filter(Boolean)[0]||""; }
function headers(referer){
  return {
    "accept":"application/json, text/plain, */*",
    "accept-language":"vi-VN,vi;q=0.9,en;q=0.7",
    "origin":"https://www.bachhoaxanh.com",
    "referer":referer
  };
}
async function bhxJson(url,referer,body){
  const init=body===undefined
    ? {method:"GET",headers:headers(referer)}
    : {method:"POST",headers:{...headers(referer),"content-type":"application/json"},body:JSON.stringify(body)};
  let last="";
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(url,init);
      if(!r.ok){ last="http_"+r.status; continue; }
      const data=await r.json();
      if(data&&Number(data.code)===0&&data.data!=null)return data;
      last="code_"+String(data&&data.code);
    }catch(e){
      last=String(e&&e.message||e).slice(0,300);
    }
  }
  throw new Error("bhx_transport_failed:"+last);
}
function productId(item){
  return Number(item&&(item.id||item.productId||item.productID||item.ProductId||item.ProductID)||0)||0;
}
function productKey(item){
  const id=productId(item);
  if(id>0)return "id:"+id;
  const code=clean(item&&item.productCode);
  if(code)return "code:"+code;
  return "url:"+clean(item&&item.url);
}
function isProduct(item){
  return Boolean(
    item&&typeof item==="object"&&item.url&&
    (Array.isArray(item.productPrices)||item.price!=null||item.avatar||item.fullName||item.productCode||item.skuInfo)
  );
}
function collect(payload,categoryUrl){
  const slug=slugFrom(categoryUrl).toLowerCase();
  const map=new Map();
  const walk=(value)=>{
    if(Array.isArray(value)){
      for(const item of value){
        if(isProduct(item)){
          try{
            const u=new URL(String(item.url),"https://www.bachhoaxanh.com/");
            const first=u.pathname.split("/").filter(Boolean)[0]||"";
            if(first.toLowerCase()===slug)map.set(productKey(item),item);
          }catch{}
        }
        walk(item);
      }
    }else if(value&&typeof value==="object"){
      for(const child of Object.values(value))walk(child);
    }
  };
  walk(payload);
  return [...map.values()];
}
function directProducts(payload,categoryUrl){
  const products=payload&&payload.data&&payload.data.products;
  if(Array.isArray(products)){
    const map=new Map();
    for(const item of products)if(isProduct(item))map.set(productKey(item),item);
    if(map.size)return [...map.values()];
  }
  return collect(payload,categoryUrl);
}
function categoryId(payload,products){
  const infoId=Number(payload&&payload.data&&payload.data.info&&payload.data.info.id)||0;
  if(infoId>0)return infoId;
  for(const item of products){
    const c=item&&item.category&&typeof item.category==="object"?item.category:{};
    for(const v of [item&&item.categoryId,item&&item.categoryID,c.id,c.categoryId,c.categoryID]){
      const n=Number(v)||0;
      if(n>0)return n;
    }
  }
  return 0;
}
function priorityIds(payload){
  const ids=payload&&payload.data&&payload.data.info&&payload.data.info.priorityProductIds;
  return Array.isArray(ids)?ids.map(x=>Number(x)||0).filter(Boolean).join(","):clean(ids);
}
async function category(rawUrl){
  const referer=canonicalBhx(rawUrl);
  const slug=slugFrom(referer);
  const firstUrl=new URL("https://"+API_HOST+"/gw/Category/V2/GetCate");
  for(const [k,v] of Object.entries({
    provinceId:String(CONTEXT.provinceId),
    wardId:String(CONTEXT.wardId),
    districtId:String(CONTEXT.districtId),
    storeId:String(CONTEXT.storeId),
    categoryUrl:slug,
    isMobile:"true",
    isV2:"true",
    pageSize:String(PAGE_SIZE)
  }))firstUrl.searchParams.set(k,v);

  const started=Date.now();
  const firstBody=await bhxJson(firstUrl.toString(),referer);
  const first=directProducts(firstBody,referer);
  const id=categoryId(firstBody,first);
  if(!id)throw new Error("bhx_category_id_missing");

  const total=Math.max(0,Number(firstBody&&firstBody.data&&firstBody.data.total)||0);
  const info=(firstBody&&firstBody.data&&firstBody.data.info)||{};
  const priority=priorityIds(firstBody);
  const map=new Map();
  for(const item of first)map.set(productKey(item),item);

  let lastShowProductId=productId(first[first.length-1]);
  let pages=1;
  const maxPage=Math.min(100,Math.max(3,total?Math.ceil(total/PAGE_SIZE)+2:50));
  const ajaxUrl="https://"+API_HOST+"/gw/Category/AjaxProduct";

  for(let page=2;page<=maxPage;page++){
    if(total>0&&map.size>=total)break;
    const body=await bhxJson(ajaxUrl,referer,{
      ...CONTEXT,
      CategoryId:id,
      SelectedBrandId:"",
      PropertyIdList:"",
      PageIndex:page,
      PageSize:PAGE_SIZE,
      SortStr:"",
      PriorityProductIds:priority,
      PropertySelected:[],
      LastShowProductId:lastShowProductId
    });
    const batch=directProducts(body,referer);
    pages=page;
    if(!batch.length)break;
    const before=map.size;
    for(const item of batch)map.set(productKey(item),item);
    const next=productId(batch[batch.length-1]);
    if(next>0)lastShowProductId=next;
    if(map.size===before)break;
  }

  return {
    code:0,
    data:{
      products:[...map.values()],
      total,
      info:{
        id,
        name:clean(info.name)||slug,
        url:clean(info.url)||("/"+slug),
        priorityProductIds:Array.isArray(info.priorityProductIds)?info.priorityProductIds:[]
      },
      transport:{
        engine:"cloudflare-stateless-bhx",
        pages,
        pageSize:PAGE_SIZE,
        ms:Date.now()-started
      }
    }
  };
}


async function inspectWeb(rawUrl){
  const url=canonicalBhx(rawUrl);
  const r=await fetch(url,{
    headers:{
      "accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language":"vi-VN,vi;q=0.9,en;q=0.7",
      "user-agent":"Mozilla/5.0"
    }
  });
  const text=await r.text();
  const scripts=[...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map(m=>m[1]).slice(0,40);
  const tokenLike=[...new Set(
    [...text.matchAll(/[A-F0-9]{32}/g)].map(m=>m[0])
  )].slice(0,20);
  return {
    status:r.status,
    setCookie:r.headers.get("set-cookie")||"",
    length:text.length,
    scripts,
    tokenLike
  };
}

export default {
  async fetch(request){
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{
      "access-control-allow-origin":"*",
      "access-control-allow-methods":"GET,POST,OPTIONS",
      "access-control-allow-headers":"content-type"
    }});
    const u=new URL(request.url);
    if(request.method==="GET"&&u.pathname==="/health"){
      return json({ok:true,mode:"stateless-bhx-transport",storage:"none"});
    }
    if(request.method==="POST"&&u.pathname==="/inspect"){
      try{
        const body=await request.json();
        return json(await inspectWeb(body&&body.url));
      }catch(e){
        return json({error:"inspect_error",detail:String(e&&e.message||e).slice(0,1000)},502);
      }
    }
    if(request.method==="POST"&&u.pathname==="/category"){
      try{
        const body=await request.json();
        return json(await category(body&&body.url));
      }catch(e){
        return json({error:"bhx_transport_error",detail:String(e&&e.message||e).slice(0,1000)},502);
      }
    }
    return json({error:"not_found"},404);
  }
};
