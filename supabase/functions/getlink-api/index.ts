import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PUBLISHABLES = (() => {
  try { return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}"); }
  catch { return {}; }
})();
const PUBLIC_KEY = String(PUBLISHABLES.default || Deno.env.get("SUPABASE_ANON_KEY") || "");
const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const ALLOWED_ORIGINS = new Set([
  "https://get.taphoa.xyz",
  "https://1sl2tp.github.io",
  "http://localhost",
  "http://127.0.0.1"
]);

function clean(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}
function plain(v: unknown): string {
  return clean(v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d").toLowerCase();
}
function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
function parseSize(text: unknown) {
  const s = clean(text).toLowerCase().replace(/,/g, ".");
  const m = s.match(/(\d+(?:\.\d+)?)\s*(ml|lít|lit|l|kg|g)\b/i);
  if (!m) return { value: null as number | null, unit: "" };
  let value = Number(m[1]);
  let unit = m[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return { value: null, unit: "" };
  if (["l","lit","lít"].includes(unit)) { value = Math.round(value * 1000); unit = "ml"; }
  if (unit === "kg") { value = Math.round(value * 1000); unit = "g"; }
  return { value, unit };
}
function pathParts(url: string) {
  return new URL(url).pathname.split("/").filter(Boolean);
}
function sourceKey(raw: string) {
  const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  if (host === "bachhoaxanh.com") return "bachhoaxanh";
  if (host === "winmart.vn") return "winmart";
  if (host === "sieuthi-go.vn") return "go";
  throw new Error("unsupported_source_url");
}
function sourceObject(key: string) {
  if (key === "winmart") return { key, name: "WinMart", host: "winmart.vn" };
  if (key === "go") return { key, name: "GO!", host: "sieuthi-go.vn" };
  return { key: "bachhoaxanh", name: "Bách Hóa XANH", host: "bachhoaxanh.com" };
}
function sourceName(key: string) {
  return sourceObject(key).name;
}
function canonicalBhx(raw: string) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "bachhoaxanh.com") throw new Error("invalid_bhx_url");
  const path = (u.pathname || "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  return "https://bachhoaxanh.com" + path;
}
function canonicalWinmart(raw: string) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "winmart.vn") throw new Error("invalid_winmart_url");
  const path = (u.pathname || "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  const out = new URL("https://winmart.vn" + path);
  const store = clean(u.searchParams.get("storeCode"));
  const cate2 = clean(u.searchParams.get("cate2"));
  if (store) out.searchParams.set("storeCode", store);
  if (cate2) out.searchParams.set("cate2", cate2);
  return out.toString().replace(/\?$/, "");
}
function canonicalGo(raw: string) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "sieuthi-go.vn") throw new Error("invalid_go_url");
  const path = (u.pathname || "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  return "https://sieuthi-go.vn" + path;
}
function canonical(raw: string) {
  const key = sourceKey(raw);
  if (key === "winmart") return canonicalWinmart(raw);
  if (key === "go") return canonicalGo(raw);
  return canonicalBhx(raw);
}
function heuristicType(url: string) {
  const key = sourceKey(url);
  if (key === "winmart") {
    const u = new URL(url);
    const last = pathParts(url).slice(-1)[0] || "";
    return /--c\d+$/i.test(last) || u.searchParams.has("cate2") ? "category" : "product";
  }
  if (key === "go") return new URL(url).pathname.includes("/product/") ? "product" : "category";
  return pathParts(url).length <= 1 ? "category" : "product";
}
async function idFor(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).slice(0, 12)
    .map(x => x.toString(16).padStart(2, "0")).join("");
}
function slugTitle(url: string) {
  const slug = pathParts(url).slice(-1)[0] || "Danh mục";
  return slug.split("-").filter(Boolean).map(x => x[0]?.toUpperCase() + x.slice(1)).join(" ");
}
function normalizeUnit(raw: string) {
  const key = plain(raw);
  const map: Record<string,string> = {
    "chai":"Chai","lon":"Lon","hop":"Hộp","goi":"Gói","tui":"Túi","bich":"Bịch",
    "hu":"Hũ","lo":"Lọ","can":"Can","mieng":"Miếng","thanh":"Thanh","vien":"Viên",
    "loc":"Lốc","khay":"Khay","vi":"Vỉ","thung":"Thùng"
  };
  for (const [k,v] of Object.entries(map)) {
    if (new RegExp("\\b" + k + "\\b").test(key)) return v;
  }
  return clean(raw);
}
function hierarchyFromRaw(name: string, packaging: string, count?: unknown, unit?: unknown) {
  const text = clean([name, packaging, count, unit].filter(Boolean).join(" "));
  const p = plain(text);
  const h = { label1:"", qty1:0, label2:"", qty2:0, label3:"", qty3:0, evidence:"source", locked:false };

  const pairRe = /(\d+)\s*(thung|loc|khay|vi|chai|lon|hop|goi|tui|bich|hu|lo|can|mieng|thanh|vien)\b/g;
  const pairs: {qty:number,key:string,label:string}[] = [];
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(p))) {
    pairs.push({ qty:Number(m[1])||0, key:m[2], label:normalizeUnit(m[2]) });
  }

  if (/\bthung\b/.test(p) || plain(unit) === "thung") {
    h.label1 = "Thùng"; h.qty1 = 1;
    const middle = pairs.find(x => ["loc","khay","vi"].includes(x.key));
    const leaf = [...pairs].reverse().find(x => !["thung","loc","khay","vi"].includes(x.key));
    if (middle) { h.label2 = middle.label; h.qty2 = middle.qty; }
    if (leaf) { h.label3 = leaf.label; h.qty3 = leaf.qty; }
    else {
      const u = normalizeUnit(clean(unit || packaging));
      if (u && u !== "Thùng") { h.label3 = u; h.qty3 = Number(count)||1; }
    }
    return h;
  }

  const middleWord = p.match(/\b(loc|khay|vi)\b\s*(\d+)?/) || p.match(/\b(goi|hop)\b\s*(\d+)\b/);
  if (middleWord && middleWord[2]) {
    h.label2 = normalizeUnit(middleWord[1]);
    h.qty2 = Number(middleWord[2])||1;
    const leaf = [...pairs].reverse().find(x => !["loc","khay","vi","goi","hop"].includes(x.key));
    if (leaf) { h.label3 = leaf.label; h.qty3 = leaf.qty; }
    return h;
  }

  let leaf = normalizeUnit(clean(unit || packaging));
  if (!leaf || /\d/.test(leaf)) {
    const known = p.match(/\b(chai|lon|hop|goi|tui|bich|hu|lo|can|mieng|thanh|vien)\b/);
    leaf = known ? normalizeUnit(known[1]) : "";
  }
  if (leaf && leaf !== "Thùng") {
    h.label3 = leaf;
    h.qty3 = 1;
  }
  return h;
}
function comparisonFrom(current: number | null, original: number | null, h: any, packaging: string, name: string) {
  const size = parseSize([name, packaging].join(" "));
  const promo = Boolean(original && current && original > current);
  let packKind = "leaf";
  if (h.label1) packKind = "carton";
  else if (h.label2) packKind = "middle";
  const packUnit = h.label1 || h.label2 || h.label3 || normalizeUnit(packaging);
  let packQty = 1;
  if (h.label1) packQty = Number(h.qty3 || h.qty2 || 1);
  else if (h.label2) packQty = Number(h.qty3 || h.qty2 || 1);
  return {
    pack_kind:packKind,
    pack_quantity:packQty,
    pack_unit:packUnit || "",
    size_value:size.value,
    size_unit:size.unit,
    regular_pack_price:current,
    promo_pack_price:null,
    regular_unit_price:current && packQty > 1 ? current / packQty : current,
    promo_unit_price:null,
    promotion_active:promo
  };
}
function matchIdentity(name: string, brand: string, barcode: string, size: any) {
  const nm = plain(name).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const br = plain(brand).replace(/[^a-z0-9]/g, "");
  if (barcode) return { match_name:nm, match_key:"barcode:"+barcode, match_basis:"barcode" };
  if (br && size?.value && size?.unit && nm) {
    return {
      match_name:nm,
      match_key:["fingerprint",br,String(size.value)+size.unit,nm].join(":"),
      match_basis:"brand_size_name"
    };
  }
  return { match_name:nm, match_key:"", match_basis:"" };
}

type Product = {
  source:any; group:string; branch:string; name:string; packaging:{text:string};
  hierarchy:any; comparison:any; price:{current:number|null;original:number|null};
  promotion:any; url:string; image:string; breadcrumbs:string[];
  source_identity:any; last_checked_at:string;
};

const BHX_HTTP1_CLIENT = Deno.createHttpClient({
  http1: true,
  http2: false,
  poolMaxIdlePerHost: 4,
  poolIdleTimeout: 30
});

function bhxHeaders(referer: string) {
  return {
    "accept":"application/json, text/plain, */*",
    "accept-language":"vi-VN,vi;q=0.9,en;q=0.7",
    "origin":"https://www.bachhoaxanh.com",
    "referer":referer || "https://www.bachhoaxanh.com/"
  };
}
async function bhxJson(url: string, referer: string, body?: unknown) {
  let last = "";
  for (let i=0;i<2;i++) {
    try {
      const r = await fetch(url, body === undefined ? {
        method:"GET",
        headers:bhxHeaders(referer),
        client:BHX_HTTP1_CLIENT
      } : {
        method:"POST",
        headers:{...bhxHeaders(referer),"content-type":"application/json"},
        body:JSON.stringify(body),
        client:BHX_HTTP1_CLIENT
      });
      if (!r.ok) { last="http_"+r.status; continue; }
      const data = await r.json();
      if (data && Number(data.code)===0 && data.data != null) return data;
      last = "code_"+String(data?.code);
    } catch (e) { last=String(e).slice(0,300); }
  }
  throw new Error("bhx_api_failed:"+last);
}
function collectBhx(payload: any, categoryUrl: string) {
  const slug = pathParts(categoryUrl)[0] || "";
  const map = new Map<string,any>();
  const walk = (v:any) => {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item==="object" && item.url && (item.name||item.fullName||item.productPrices||item.avatar)) {
          try {
            const u = new URL(String(item.url), "https://www.bachhoaxanh.com/");
            const parts = pathParts(u.toString());
            if (parts[0]?.toLowerCase() === slug.toLowerCase()) {
              map.set(String(item.url||item.id||item.productCode||item.productId), item);
            }
          } catch {}
        }
        walk(item);
      }
    } else if (v && typeof v==="object") {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(payload);
  return [...map.values()];
}
function bhxCategoryId(items:any[]) {
  for (const item of items) {
    const cat = item?.category && typeof item.category==="object" ? item.category : {};
    for (const v of [item?.categoryId,item?.categoryID,cat.id,cat.categoryId,cat.categoryID]) {
      const n=Number(v)||0; if (n>0) return n;
    }
  }
  return 0;
}
function bhxProductId(item:any) {
  return Number(item?.id||item?.productId||item?.productID||item?.ProductId||item?.ProductID||0)||0;
}
async function bhxProductDetail(url:string) {
  const c=canonicalBhx(url); const parts=pathParts(c); if(parts.length<2)throw new Error("bhx_product_url_required");
  const api=new URL("https://api.bachhoaxanh.com/gw/Product/GetProductDetail");
  for (const [k,v] of Object.entries({provinceId:"1027",wardId:"0",districtId:"0",storeId:"2546",CategoryUrl:parts[0],ProductUrl:parts[1]})) api.searchParams.set(k,v);
  const body=await bhxJson(api.toString(),c);
  if(!Array.isArray(body.data?.boxBuys)||!body.data.boxBuys.length)throw new Error("bhx_product_empty");
  return body.data;
}
async function bhxCategoryRaw(url:string) {
  const c=canonicalBhx(url); const slug=pathParts(c)[0]||""; if(!slug)throw new Error("bhx_category_slug_missing");
  const v2=new URL("https://api.bachhoaxanh.com/gw/Category/V2/GetCate");
  for(const [k,v] of Object.entries({provinceId:"1027",wardId:"0",districtId:"0",storeId:"2546",categoryUrl:slug,isMobile:"true",isV2:"true",pageSize:"500"}))v2.searchParams.set(k,v);
  const v2body=await bhxJson(v2.toString(),c);
  const v2items=collectBhx(v2body,c);
  let categoryId=bhxCategoryId(v2items);
  if(!categoryId && v2items[0]?.url){
    try { categoryId=Number((await bhxProductDetail(new URL(v2items[0].url,"https://www.bachhoaxanh.com").toString())).categoryId)||0; } catch {}
  }
  if(!categoryId)throw new Error("bhx_category_id_missing");

  const veg=new URL("https://api.bachhoaxanh.com/gw/Category/GetCateVegetable");
  for(const [k,v] of Object.entries({provinceId:"1027",wardId:"0",districtId:"0",storeId:"2546",cateId:String(categoryId),customerId:"0"}))veg.searchParams.set(k,v);
  const ajaxUrl="https://api.bachhoaxanh.com/gw/Category/AjaxProduct";
  const [vegBody,ajax1]=await Promise.all([
    bhxJson(veg.toString(),c),
    bhxJson(ajaxUrl,c,{provinceId:1027,wardId:0,districtId:0,storeId:2546,CategoryId:categoryId,SelectedBrandId:"",PropertyIdList:"",PageIndex:1,PageSize:10,SortStr:"",PriorityProductIds:"",PropertySelected:[],LastShowProductId:0})
  ]);
  const vegItems=collectBhx(vegBody,c);
  const ajaxItems=[...collectBhx(ajax1,c)];
  let last=collectBhx(ajax1,c), page=1;
  while(last.length===10 && page<50){
    page++;
    const lastId=bhxProductId(last[last.length-1]);
    const body=await bhxJson(ajaxUrl,c,{provinceId:1027,wardId:0,districtId:0,storeId:2546,CategoryId:categoryId,SelectedBrandId:"",PropertyIdList:"",PageIndex:page,PageSize:10,SortStr:"",PriorityProductIds:"",PropertySelected:[],LastShowProductId:lastId});
    last=collectBhx(body,c); ajaxItems.push(...last);
    if(!last.length)break;
  }
  const map=new Map<string,any>();
  for(const item of [...v2items,...vegItems,...ajaxItems]) map.set(String(item.url||item.id||item.productCode||item.productId),item);
  return {items:[...map.values()],categoryId};
}
async function bhxRegionProbe(url:string){
  const c=canonicalBhx(url);
  const slug=pathParts(c)[0]||"";
  if(!slug)throw new Error("bhx_category_slug_missing");
  const api=new URL("https://api.bachhoaxanh.com/gw/Category/V2/GetCate");
  for(const [k,v] of Object.entries({
    provinceId:"1027",wardId:"0",districtId:"0",storeId:"2546",
    categoryUrl:slug,isMobile:"true",isV2:"true",pageSize:"500"
  }))api.searchParams.set(k,v);
  const t=Date.now();
  const body=await bhxJson(api.toString(),c);
  const items=collectBhx(body,c);
  return {
    ok:true,
    region:Deno.env.get("SB_REGION")||"",
    ms:Date.now()-t,
    products:items.length,
    category_id:bhxCategoryId(items)||null
  };
}

function normalizeBhx(raw:any, rootGroup:string, checked:string): Product | null {
  if(!raw||typeof raw!=="object"||!raw.url)return null;
  let url=""; try{url=canonicalBhx(new URL(String(raw.url),"https://www.bachhoaxanh.com").toString());}catch{return null;}
  const pr=Array.isArray(raw.productPrices)?raw.productPrices[0]||{}:{};
  const current=money(pr.price||raw.price);
  if(!current)return null;
  const sys=money(pr.sysPrice);
  const original=sys&&sys>current?sys:null;
  const category=raw.category&&typeof raw.category==="object"?raw.category:{};
  const group=clean(rootGroup||category.name||"");
  const brand=clean(raw.brandName||"");
  const name=clean(raw.fullName||raw.name||slugTitle(url));
  const packaging=clean(raw.title||raw.canonical||[raw.packageItemCount,raw.packageItemUnit].filter(Boolean).join(" ")||raw.unit||"");
  const h=hierarchyFromRaw(name,packaging,raw.packageItemCount,raw.packageItemUnit||raw.unit);
  const cmp=comparisonFrom(current,original,h,packaging,name);
  const size={value:cmp.size_value,unit:cmp.size_unit};
  const ident=matchIdentity(name,brand,clean(raw.barcode||""),size);
  return {
    source:sourceObject("bachhoaxanh"), group, branch:brand, name, packaging:{text:packaging},
    hierarchy:h, comparison:cmp, price:{current,original},
    promotion:{active:Boolean(original&&original>current),price:null,text:clean(raw.promotionText||raw.promotionTextFS||"")},
    url,image:clean(raw.avatar||""),breadcrumbs:[group,brand].filter(Boolean),
    source_identity:{
      source_product_id:clean(raw.id||""), source_code:clean(raw.productCode||""), barcode:clean(raw.barcode||""), sku:"",
      brand, category:clean(category.name||group), raw_name:clean(raw.name||name),
      raw_description:clean([raw.fullName,raw.canonical].filter(Boolean).join(" · ")),
      ...ident
    }, last_checked_at:checked
  };
}
function normalizeBhxDetail(data:any, inputUrl:string, checked:string): Product {
  const raw=Array.isArray(data?.boxBuys)?data.boxBuys[0]:null;
  if(!raw)throw new Error("bhx_detail_empty");
  const copy={...raw,url:inputUrl,category:{name:clean(data.categoryName||"")},brandName:clean(data.brandUrl||raw.brandName||"")};
  const p=normalizeBhx(copy,clean(data.categoryName||""),checked);
  if(!p)throw new Error("bhx_detail_invalid");
  p.url=canonicalBhx(inputUrl);
  return p;
}

function winmartSlug(url:string){
  const u=new URL(canonicalWinmart(url));
  return clean(u.searchParams.get("cate2")||pathParts(u.toString()).slice(-1)[0]||"");
}
function winmartStore(url:string){
  const u=new URL(canonicalWinmart(url)); return clean(u.searchParams.get("storeCode")||"1535")||"1535";
}
async function winmartCategory(url:string){
  const c=canonicalWinmart(url), slug=winmartSlug(c), store=winmartStore(c); if(!slug)throw new Error("winmart_slug_missing");
  const fetchPage=async(page:number)=>{
    const api=new URL("https://api-crownx.winmart.vn/it/api/web/v3/item/category");
    for(const [k,v] of Object.entries({storeCode:store,slug,pageNumber:String(page),pageSize:"500",orderByDesc:"true",storeGroupCode:"1998"}))api.searchParams.set(k,v);
    const r=await fetch(api,{headers:{"accept":"application/json","x-api-merchant":"WCM","origin":"https://winmart.vn","referer":"https://winmart.vn/"}});
    if(!r.ok)throw new Error("winmart_http_"+r.status);
    const body=await r.json(); const data=body?.data||{}, items=Array.isArray(data.items)?data.items:[];
    const paging=body?.paging||data?.paging||{};
    return {data,items,paging};
  };
  const first=await fetchPage(1); const pages=Math.max(1,Number(first.paging?.totalPages)||1);
  const all=[...first.items];
  if(pages>1){
    for(let start=2;start<=pages;start+=8){
      const nums=Array.from({length:Math.min(8,pages-start+1)},(_,i)=>start+i);
      const rows=await Promise.all(nums.map(fetchPage)); for(const row of rows)all.push(...row.items);
    }
  }
  return {items:all,rootName:clean(first.data?.name||slug),store};
}
function winmartImage(item:any){
  const visit=(v:any):string=>{
    if(typeof v==="string"){const t=v.trim();if(t.startsWith("//"))return"https:"+t;if(/^https?:\/\//i.test(t))return t;return"";}
    if(Array.isArray(v)){for(const x of v){const r=visit(x);if(r)return r;}return"";}
    if(v&&typeof v==="object"){for(const k of ["url","src","image","imageUrl","mediaUrl","thumbnail","thumbnailUrl","original"]){const r=visit(v[k]);if(r)return r;}for(const x of Object.values(v)){const r=visit(x);if(r)return r;}}
    return"";
  };
  for(const k of ["mediaUrl","mediaItems","imageUrl","thumbnailUrl","thumbnail","image","images","productImage","avatar","picture"]){const r=visit(item?.[k]);if(r)return r;}
  return"";
}
function normalizeWinmart(item:any, rootName:string, store:string, checked:string): Product | null {
  const name=clean(item?.name||item?.productName||item?.title||""); if(!name)return null;
  const regular=money(item?.price||item?.listPrice||item?.originalPrice);
  const sale=money(item?.salePrice||item?.sellingPrice||item?.finalPrice||item?.currentPrice);
  const current=sale||regular; if(!current)return null;
  const original=regular&&current&&regular>current?regular:null;
  const type=clean(item?.uomName||item?.unitName||item?.unit||item?.packageUnit||item?.packingUnit||item?.measureUnit||item?.uom||"");
  const seo=clean(item?.seoName||item?.seo_name||"");
  const url=seo?("https://winmart.vn/products/"+seo.replace(/^\/+|\/+$/g,"")+"?storeCode="+encodeURIComponent(store)):"";
  if(!url)return null;
  const brand=clean(item?.brandName||item?.brand||"");
  const child=clean(item?.categoryName||item?.category_name||"");
  const size=parseSize([name,item?.description,item?.shortDescription].filter(Boolean).join(" "));
  const ident=matchIdentity(name,brand,clean(item?.barcode||""),size);
  return {
    source:sourceObject("winmart"),group:rootName,branch:brand,name,packaging:{text:type},
    hierarchy:{label1:"",qty1:0,label2:"",qty2:0,label3:"",qty3:0,evidence:"",locked:false},
    comparison:{pack_kind:"",pack_quantity:1,pack_unit:"",size_value:size.value,size_unit:size.unit,regular_pack_price:current,promo_pack_price:null,regular_unit_price:null,promo_unit_price:null,promotion_active:Boolean(original&&original>current)},
    price:{current,original},promotion:{active:Boolean(original&&original>current),price:null,text:""},url,image:winmartImage(item),breadcrumbs:[rootName,child,brand].filter(Boolean),
    source_identity:{
      source_product_id:clean(item?.id||""),source_code:clean(item?.itemNo||""),barcode:clean(item?.barcode||""),sku:clean(item?.sku||""),
      brand,category:child,raw_name:name,raw_description:clean([item?.description,item?.shortDescription].filter(Boolean).join(" · ")),...ident
    },last_checked_at:checked
  };
}

function goCategoryId(url:string){
  const m=new URL(url).pathname.match(/-i\.(\d+)$/i); return m?Number(m[1]):0;
}
async function goCategory(url:string){
  const c=canonicalGo(url), category=goCategoryId(c); if(!category)throw new Error("go_category_id_missing");
  // GO's source API is public. Default store/site context used by the site can
  // change, so try a small set of known/default payloads and keep the first success.
  const endpoint="https://sieuthi-go.vn/api/order2_listProduct";
  const candidates=[
    {store:null,sitecode:null},
    {store:"",sitecode:""}
  ];
  let first:any=null, base:any=null;
  for(const ctx of candidates){
    const payload:any={page:1,category,filter_brand:[],filter_subfamily:[],search:null,platform:2,lang:"vi"};
    if(ctx.store!==null)payload.store=ctx.store;
    if(ctx.sitecode!==null)payload.sitecode=ctx.sitecode;
    try{
      const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","accept":"application/json","origin":"https://sieuthi-go.vn","referer":c},body:JSON.stringify(payload)});
      const b=await r.json();
      if(r.ok&&b?.status==="success"&&Array.isArray(b.products)){first=b;base=payload;break;}
    }catch{}
  }
  if(!first||!base)throw new Error("go_direct_context_required");
  const pages=Math.max(1,Number(first.pagination?.total_pages)||1), all=[...first.products];
  for(let start=2;start<=pages;start+=8){
    const nums=Array.from({length:Math.min(8,pages-start+1)},(_,i)=>start+i);
    const rows=await Promise.all(nums.map(async page=>{
      const payload={...base,page};
      const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","accept":"application/json","origin":"https://sieuthi-go.vn","referer":c},body:JSON.stringify(payload)});
      const b=await r.json(); if(!r.ok||b?.status!=="success")throw new Error("go_page_"+page); return b.products||[];
    }));
    for(const row of rows)all.push(...row);
  }
  return {items:all,rootName:slugTitle(c)};
}
function goDetailValue(product:any, label:string){
  const re=new RegExp(label,"i");
  for(const item of product?.detail||[]){if(item&&re.test(clean(item.name)))return clean(item.value);}
  return"";
}
function normalizeGo(item:any, rootName:string, checked:string): Product | null {
  const rawName=clean(item?.name||item?.meta?.title||""); if(!rawName)return null;
  const name=rawName.replace(/\s*[-–|]\s*GO!.*$/i,"").trim();
  const current=money(item?.price); if(!current)return null;
  const promo=money(item?.promotion_price), original=promo&&promo>current?promo:null;
  const alias=clean(item?.alias).replace(/^\/+|\/+$/g,"");
  const url=alias?"https://sieuthi-go.vn/product/"+alias:(item?.id?"https://sieuthi-go.vn/product/go-item-"+item.id:""); if(!url)return null;
  const brand=goDetailValue(item,"Thương\\s*hiệu").replace(/\s*\([^)]*\)\s*$/,"").trim();
  const spec=goDetailValue(item,"Trọng\\s*lượng|Dung\\s*tích");
  const packaging=clean(spec);
  const h=hierarchyFromRaw(name,packaging);
  const cmp=comparisonFrom(current,original,h,packaging,name);
  const size={value:cmp.size_value,unit:cmp.size_unit};
  const barcode=clean(item?.barcode||""); const ident=matchIdentity(name,brand,barcode,size);
  const thumbs=Array.isArray(item?.thumbnail)?item.thumbnail:[item?.thumbnail].filter(Boolean);
  const image=clean(thumbs.find(Boolean)||item?.meta?.image||"");
  return {
    source:sourceObject("go"),group:rootName,branch:brand,name,packaging:{text:packaging},hierarchy:h,comparison:cmp,
    price:{current,original},promotion:{active:Boolean(original&&original>current),price:null,text:""},url,image,breadcrumbs:[rootName,brand].filter(Boolean),
    source_identity:{source_product_id:clean(item?.id||""),source_code:"",barcode,sku:"",brand,category:rootName,raw_name:rawName,raw_description:spec,...ident},
    last_checked_at:checked
  };
}

async function fetchSource(input:string, requestId:string){
  const url=canonical(input), key=sourceKey(url), kind=heuristicType(url), checked=new Date().toISOString();
  if(key==="winmart"){
    if(kind!=="category")throw new Error("winmart_category_link_required");
    const raw=await winmartCategory(url);
    const products=raw.items.map((x:any)=>normalizeWinmart(x,raw.rootName,raw.store,checked)).filter(Boolean) as Product[];
    return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"category",source:sourceObject(key),checked_at:checked,category_name:raw.rootName,products,variants:[],discovered_links:products.map(p=>p.url)},engine:"supabase-edge-winmart"};
  }
  if(key==="bachhoaxanh"){
    if(kind==="product"){
      const data=await bhxProductDetail(url), product=normalizeBhxDetail(data,url,checked);
      return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"product",source:sourceObject(key),checked_at:checked,category_name:product.group,product,products:[product],variants:[],discovered_links:[product.url]},engine:"supabase-edge-bhx"};
    }
    const raw=await bhxCategoryRaw(url);
    const root=clean(raw.items[0]?.category?.name||slugTitle(url));
    const products=raw.items.map((x:any)=>normalizeBhx(x,root,checked)).filter(Boolean) as Product[];
    return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"category",source:sourceObject(key),checked_at:checked,category_name:root,category_id:raw.categoryId,products,variants:[],discovered_links:products.map(p=>p.url)},engine:"supabase-edge-bhx"};
  }
  if(key==="go"){
    if(kind!=="category")throw new Error("go_category_link_required");
    const raw=await goCategory(url);
    const products=raw.items.map((x:any)=>normalizeGo(x,raw.rootName,checked)).filter(Boolean) as Product[];
    return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"category",source:sourceObject(key),checked_at:checked,category_name:raw.rootName,products,variants:[],discovered_links:products.map(p=>p.url)},engine:"supabase-edge-go"};
  }
  throw new Error("unsupported_source");
}

async function must<T>(promise: PromiseLike<{data:T,error:any}>) {
  const {data,error}=await promise; if(error)throw error; return data;
}
async function persistPayload(payload:any, engine:string){
  const now=new Date().toISOString(), requestId=payload.request_id, input=payload.input_url, key=payload.source.key;
  const products:Product[]=Array.isArray(payload.products)?payload.products:[];
  const categoryId=await idFor(input);
  const rows:any[]=[{
    id:categoryId,canonical_url:input,source:sourceName(key),link_type:payload.input_type,
    parent_url:payload.input_type==="product"?(key==="bachhoaxanh"?"https://bachhoaxanh.com/"+pathParts(input)[0]:null):null,
    group_name:payload.category_name||"",branch_name:"",name:payload.input_type==="category"?(payload.category_name||slugTitle(input)):(payload.product?.name||""),
    packaging:payload.input_type==="product"?(payload.product?.packaging?.text||""):"",
    current_price:payload.input_type==="product"?(payload.product?.price?.current||null):null,
    original_price:payload.input_type==="product"?(payload.product?.price?.original||null):null,
    promotion_price:null,promotion_text:payload.input_type==="product"?(payload.product?.promotion?.text||""):"",
    last_checked_at:payload.checked_at,last_status:"ok",last_request_id:requestId,created_at:now,updated_at:now
  }];
  const assets:any[]=[], comps:any[]=[], hier:any[]=[], identities:any[]=[], snaps:any[]=[];
  for(const p of products){
    const id=await idFor(p.url), cmp=p.comparison||{}, h=p.hierarchy||{}, si=p.source_identity||{};
    rows.push({
      id,canonical_url:p.url,source:sourceName(p.source.key),link_type:"product",parent_url:payload.input_type==="category"?input:(key==="bachhoaxanh"?"https://bachhoaxanh.com/"+pathParts(p.url)[0]:null),
      group_name:p.group||"",branch_name:p.branch||"",name:p.name||"",packaging:p.packaging?.text||"",
      current_price:p.price?.current||null,original_price:p.price?.original||null,promotion_price:p.promotion?.price||null,promotion_text:p.promotion?.text||"",
      last_checked_at:p.last_checked_at||payload.checked_at,last_status:"ok",last_request_id:requestId,created_at:now,updated_at:now
    });
    if(p.image)assets.push({link_url:p.url,image_url:p.image,updated_at:now});
    comps.push({link_url:p.url,pack_kind:cmp.pack_kind||"",pack_quantity:Number(cmp.pack_quantity)||1,pack_unit:cmp.pack_unit||"",size_value:cmp.size_value??null,size_unit:cmp.size_unit||"",regular_pack_price:cmp.regular_pack_price??p.price?.current??null,promo_pack_price:cmp.promo_pack_price??null,regular_unit_price:cmp.regular_unit_price??null,promo_unit_price:cmp.promo_unit_price??null,promotion_active:Boolean(cmp.promotion_active),updated_at:now});
    hier.push({link_url:p.url,label1:h.label1||"",qty1:Number(h.qty1)||0,label2:h.label2||"",qty2:Number(h.qty2)||0,label3:h.label3||"",qty3:Number(h.qty3)||0,evidence:h.evidence||"",updated_at:now});
    identities.push({link_url:p.url,source_name:sourceName(p.source.key),source_product_id:clean(si.source_product_id),source_code:clean(si.source_code),barcode:clean(si.barcode),sku:clean(si.sku),brand:clean(si.brand||p.branch),category:clean(si.category||p.group),raw_name:clean(si.raw_name||p.name),raw_description:clean(si.raw_description),size_value:cmp.size_value??null,size_unit:cmp.size_unit||"",pack_label_1:h.label1||"",pack_qty_1:Number(h.qty1)||0,pack_label_2:h.label2||"",pack_qty_2:Number(h.qty2)||0,pack_label_3:h.label3||"",pack_qty_3:Number(h.qty3)||0,match_name:clean(si.match_name),match_key:clean(si.match_key),match_basis:clean(si.match_basis),updated_at:now});
    snaps.push({link_id:id,request_id:requestId,checked_at:p.last_checked_at||payload.checked_at,current_price:p.price?.current||null,original_price:p.price?.original||null,promotion_price:p.promotion?.price||null,promotion_text:p.promotion?.text||"",result_json:p});
  }
  await must(sb.from("getlink_links").upsert(rows,{onConflict:"canonical_url"}));
  if(assets.length)await must(sb.from("getlink_link_assets").upsert(assets,{onConflict:"link_url"}));
  if(comps.length)await must(sb.from("getlink_link_comparison").upsert(comps,{onConflict:"link_url"}));
  if(hier.length)await must(sb.from("getlink_link_pack_hierarchy").upsert(hier,{onConflict:"link_url"}));
  if(identities.length)await must(sb.from("getlink_source_product_identity").upsert(identities,{onConflict:"link_url"}));
  if(snaps.length)await must(sb.from("getlink_price_snapshots").upsert(snaps,{onConflict:"link_id,request_id"}));

  await must(sb.from("getlink_jobs").update({link_type:payload.input_type,status:"complete",result_json:payload,error:null,updated_at:now}).eq("request_id",requestId));
  const {count}=await sb.from("getlink_links").select("*",{count:"exact",head:true});
  return {payload,registry_count:Number(count||0),engine};
}

async function fetchAll(table:string, select="*", filter?:(q:any)=>any){
  const out:any[]=[]; const size=1000;
  for(let start=0;;start+=size){
    let q:any=sb.from(table).select(select).range(start,start+size-1);
    if(filter)q=filter(q);
    const {data,error}=await q; if(error)throw error;
    const rows=data||[]; out.push(...rows); if(rows.length<size)break;
  }
  return out;
}
async function libraryRows(includeHidden=true){
  const [links,prefs,assets,comps,hier,ids]=await Promise.all([
    fetchAll("getlink_links","*",(q:any)=>q.eq("link_type","product").neq("last_status","unlisted").order("name",{ascending:true})),
    fetchAll("getlink_link_preferences"),
    fetchAll("getlink_link_assets"),
    fetchAll("getlink_link_comparison"),
    fetchAll("getlink_link_pack_hierarchy"),
    fetchAll("getlink_source_product_identity")
  ]);
  const pref=new Map(prefs.map((x:any)=>[x.link_url,x])), asset=new Map(assets.map((x:any)=>[x.link_url,x])),
    cmp=new Map(comps.map((x:any)=>[x.link_url,x])), hm=new Map(hier.map((x:any)=>[x.link_url,x])), im=new Map(ids.map((x:any)=>[x.link_url,x]));
  const categories=await fetchAll("getlink_links","canonical_url,name,source,last_request_id",(q:any)=>q.eq("link_type","category"));
  const rootByReq=new Map(categories.filter((x:any)=>String(x.source).includes("WinMart")).map((x:any)=>[x.last_request_id,x.name]));
  const rows:any[]=[];
  for(const l of links){
    if(!l.name || (!l.current_price&&!l.promotion_price))continue;
    const p=pref.get(l.canonical_url)||{}, a=asset.get(l.canonical_url)||{}, c=cmp.get(l.canonical_url)||{}, h=hm.get(l.canonical_url)||{}, id=im.get(l.canonical_url)||{};
    const state=p.state||"normal"; if(!includeHidden&&state==="hidden")continue;
    const isW=String(l.source||"").toLowerCase().includes("winmart");
    const isCarton=Boolean(h.label1), isMiddle=!isCarton&&Boolean(h.label2);
    const levelPrice=Number(l.current_price||l.promotion_price||0);
    rows.push({
      ...l,brand_name:l.branch_name||"",preference_state:state,auto_refresh:p.auto_refresh?1:0,refresh_hours:Number(p.refresh_hours)||24,
      image:a.image_url||"",pack_kind:c.pack_kind||"",pack_quantity:Number(c.pack_quantity)||1,pack_unit:c.pack_unit||"",
      size_value:c.size_value??id.size_value??null,size_unit:c.size_unit||id.size_unit||"",
      regular_pack_price:c.regular_pack_price??l.current_price??null,promo_pack_price:c.promo_pack_price??null,
      regular_unit_price:c.regular_unit_price??null,promo_unit_price:c.promo_unit_price??null,promotion_active:c.promotion_active?1:0,has_promo:c.promotion_active?1:0,
      pack_label_1:h.label1||"",pack_qty_1:Number(h.qty1)||0,pack_label_2:h.label2||"",pack_qty_2:Number(h.qty2)||0,pack_label_3:h.label3||"",pack_qty_3:Number(h.qty3)||0,pack_evidence:h.evidence||"",hierarchy_locked:0,
      source_product_id:id.source_product_id||"",source_code:id.source_code||"",barcode:id.barcode||"",sku:id.sku||"",
      source_raw_name:id.raw_name||l.name,source_raw_description:id.raw_description||"",match_key:id.match_key||"",match_basis:id.match_basis||"",
      source_category_name:id.category||"",source_root_name:isW?(rootByReq.get(l.last_request_id)||l.group_name):"",
      web_carton_price:!isW&&isCarton?levelPrice:null,promo_carton_price:null,
      web_middle_price:!isW&&isMiddle?levelPrice:null,promo_middle_price:null,
      web_leaf_price:!isW&&!isCarton&&!isMiddle?levelPrice:null,promo_leaf_price:null,
      unit_price:c.promo_unit_price||c.regular_unit_price||null
    });
  }
  return rows;
}
async function reconstructItem(url:string){
  const rows=await libraryRows(true); const row=rows.find((x:any)=>canonical(x.canonical_url)===canonical(url)); if(!row)return null;
  const source=String(row.source||"").includes("WinMart")?sourceObject("winmart"):String(row.source||"").includes("GO")?sourceObject("go"):sourceObject("bachhoaxanh");
  const h={label1:row.pack_label_1||"",qty1:Number(row.pack_qty_1)||0,label2:row.pack_label_2||"",qty2:Number(row.pack_qty_2)||0,label3:row.pack_label_3||"",qty3:Number(row.pack_qty_3)||0,evidence:row.pack_evidence||"",locked:false};
  const cmp={pack_kind:row.pack_kind||"",pack_quantity:Number(row.pack_quantity)||1,pack_unit:row.pack_unit||"",size_value:row.size_value??null,size_unit:row.size_unit||"",regular_pack_price:row.regular_pack_price??row.current_price,promo_pack_price:row.promo_pack_price??null,regular_unit_price:row.regular_unit_price??null,promo_unit_price:row.promo_unit_price??null,promotion_active:Boolean(row.promotion_active)};
  const product={source,group:row.group_name||"",branch:row.branch_name||"",name:row.name||"",packaging:{text:row.packaging||""},hierarchy:h,comparison:cmp,price:{current:row.current_price||null,original:row.original_price||null},promotion:{active:Boolean(row.promotion_active),price:row.promotion_price||null,text:row.promotion_text||""},url:row.canonical_url,image:row.image||"",breadcrumbs:[row.group_name,row.branch_name].filter(Boolean),last_checked_at:row.last_checked_at||row.updated_at};
  return {schema_version:20,request_id:row.last_request_id||"",input_url:row.canonical_url,input_type:"product",source,checked_at:row.last_checked_at||row.updated_at,category_name:row.group_name||"",product,products:[product],variants:[],discovered_links:[row.canonical_url]};
}

function cors(req:Request){
  const origin=req.headers.get("origin")||"";
  const allow=[...ALLOWED_ORIGINS].some(x=>origin===x||origin.startsWith(x+":"))?origin:"https://get.taphoa.xyz";
  return {"access-control-allow-origin":allow,"access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type,apikey","content-type":"application/json; charset=utf-8","cache-control":"no-store"};
}
function response(req:Request,data:any,status=200){return new Response(JSON.stringify(data),{status,headers:cors(req)});}
function authorized(req:Request){return Boolean(PUBLIC_KEY)&&req.headers.get("apikey")===PUBLIC_KEY;}
function routePath(req:Request){
  const p=new URL(req.url).pathname; const marker="/getlink-api"; const i=p.indexOf(marker); return i>=0?(p.slice(i+marker.length)||"/"):p;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  if(!authorized(req))return response(req,{error:"unauthorized"},401);
  const url=new URL(req.url), route=routePath(req);
  try{
    if(req.method==="GET"&&route==="/api/debug-bhx-region"){
      const raw=clean(url.searchParams.get("url"));
      if(!raw)return response(req,{error:"missing_url"},400);
      const data=await bhxRegionProbe(raw);
      return response(req,data,200);
    }
    if(req.method==="GET"&&route==="/health"){
      const {count,error}=await sb.from("getlink_links").select("*",{count:"exact",head:true}); if(error)throw error;
      return response(req,{ok:true,mode:"supabase-only",links:Number(count||0)});
    }
    if(req.method==="POST"&&route==="/api/get-price"){
      const body=await req.json(); const raw=clean(body?.url); if(!raw)return response(req,{error:"missing_url"},400);
      const input=canonical(raw), force=Boolean(body?.force);
      if(!force){
        const since=new Date(Date.now()-86400000).toISOString();
        const {data}=await sb.from("getlink_jobs").select("request_id,result_json,updated_at,link_type").eq("canonical_url",input).eq("status","complete").gte("updated_at",since).order("updated_at",{ascending:false}).limit(1).maybeSingle();
        if(data?.result_json){
          const {count}=await sb.from("getlink_links").select("*",{count:"exact",head:true});
          return response(req,{request_id:data.request_id,status:"complete",input_url:input,link_type:data.link_type,payload:data.result_json,registry_count:Number(count||0),engine:"supabase-cache",cache_hit:true});
        }
      }
      const requestId=crypto.randomUUID().replace(/-/g,""), now=new Date().toISOString(), kind=heuristicType(input);
      await must(sb.from("getlink_jobs").insert({request_id:requestId,input_url:input,canonical_url:input,link_type:kind,status:"running",created_at:now,updated_at:now}));
      try{
        const fetched=await fetchSource(input,requestId);
        const saved=await persistPayload(fetched.payload,fetched.engine);
        return response(req,{request_id:requestId,status:"complete",input_url:input,link_type:fetched.payload.input_type,...saved,cache_hit:false});
      }catch(e){
        const detail=String(e?.message||e).slice(0,1200);
        await sb.from("getlink_jobs").update({status:"error",error:detail,updated_at:new Date().toISOString()}).eq("request_id",requestId);
        return response(req,{error:"source_fetch_failed",detail,request_id:requestId},502);
      }
    }
    if(req.method==="GET"&&route==="/api/result"){
      const id=clean(url.searchParams.get("id")); if(!id)return response(req,{error:"missing_id"},400);
      const {data,error}=await sb.from("getlink_jobs").select("*").eq("request_id",id).maybeSingle(); if(error)throw error;if(!data)return response(req,{error:"not_found"},404);
      if(data.status==="complete")return response(req,{status:"complete",payload:data.result_json,request_id:id});
      if(data.status==="error")return response(req,{status:"error",error:data.error||"unknown",request_id:id});
      return response(req,{status:data.status||"running",request_id:id});
    }
    if(req.method==="GET"&&route==="/api/library"){
      const view=clean(url.searchParams.get("view")||"groups");
      if(view==="search"||view==="products"){
        const limit=Math.min(10000,Math.max(1,Number(url.searchParams.get("limit")||500)));
        let rows=await libraryRows(url.searchParams.get("include_hidden")==="1");
        if(view==="products"&&url.searchParams.get("parent")){
          const parent=canonical(clean(url.searchParams.get("parent"))); rows=rows.filter((x:any)=>x.parent_url===parent);
        }
        return response(req,{products:rows.slice(0,limit)});
      }
      if(view==="groups"){
        const rows=await libraryRows(false); const map=new Map<string,any>();
        for(const r of rows){const name=clean(r.group_name);if(!name)continue;const x=map.get(name)||{url:r.parent_url||"",name,product_count:0,updated_at:r.updated_at||""};x.product_count++;map.set(name,x);}
        return response(req,{groups:[...map.values()].sort((a,b)=>a.name.localeCompare(b.name,"vi"))});
      }
      if(view==="item"){
        const raw=clean(url.searchParams.get("url")); if(!raw)return response(req,{error:"invalid_url"},400); const itemUrl=canonical(raw);
        const {data}=await sb.from("getlink_jobs").select("result_json,updated_at").eq("canonical_url",itemUrl).eq("status","complete").order("updated_at",{ascending:false}).limit(1).maybeSingle();
        let payload=data?.result_json||null; if(!payload)payload=await reconstructItem(itemUrl); if(!payload)return response(req,{error:"not_found"},404);
        const {data:pref}=await sb.from("getlink_link_preferences").select("*").eq("link_url",itemUrl).maybeSingle();
        return response(req,{status:"complete",payload,source:"supabase",updated_at:data?.updated_at||"",preference:pref||{state:"normal",auto_refresh:false,refresh_hours:24,pinned:false}});
      }
      if(view==="matches"){
        const [ids,links]=await Promise.all([fetchAll("getlink_source_product_identity"),fetchAll("getlink_links","canonical_url,name,current_price,original_price,promotion_price,parent_url,last_status",(q:any)=>q.eq("link_type","product"))]);
        const lm=new Map(links.map((x:any)=>[x.canonical_url,x])), groups=new Map<string,any>();
        for(const i of ids){const l=lm.get(i.link_url);if(!l||l.last_status==="unlisted"||!i.match_key)continue;const key=i.match_key;if(!groups.has(key))groups.set(key,{match_key:key,match_basis:i.match_basis||"",items:[],sources:new Set()});const g=groups.get(key);g.sources.add(i.source_name);g.items.push({...i,...l});}
        const matches=[...groups.values()].filter(g=>g.sources.size>=2).map(g=>({match_key:g.match_key,match_basis:g.match_basis,source_count:g.sources.size,item_count:g.items.length,items:g.items}));
        return response(req,{matches,match_group_count:matches.length,rule:"barcode exact; otherwise strict brand + size + normalized name"});
      }
      return response(req,{error:"invalid_view"},400);
    }
    if(req.method==="POST"&&route==="/api/preference"){
      const body=await req.json(); const link=canonical(clean(body?.url)); const state=["normal","watch","hidden"].includes(body?.state)?body.state:"normal"; const now=new Date().toISOString();
      const row={link_url:link,state,auto_refresh:state==="watch",refresh_hours:Math.max(1,Number(body?.refresh_hours)||24),pinned:false,updated_at:now};
      await must(sb.from("getlink_link_preferences").upsert(row,{onConflict:"link_url"}));
      return response(req,{preference:row});
    }
    return response(req,{error:"not_found"},404);
  }catch(e){
    return response(req,{error:"server_error",detail:String(e?.message||e).slice(0,1500)},500);
  }
});
