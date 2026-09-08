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

type BhxGroupRef = {
  url:string;
  group:string;
  name:string;
  brand:string;
  brand_key:string;
  barcode:string;
  tokens:Set<string>;
  sizes:Set<string>;
};

const GROUP_MATCH_NOISE = new Set([
  "thung","loc","combo","goi","chai","hop","tui","bich","ly","lon","hu","khay",
  "cai","cay","bo","doi","vi","huong","quy","cach","size","san","pham","cao","cap",
  "chinh","hang","acecook","vina"
]);

function groupBrandKey(v:unknown) {
  return plain(v).replace(/[^a-z0-9]/g,"");
}
function groupSizeSignatures(v:unknown) {
  const out=new Set<string>();
  const text=plain(v).replace(/,/g,".");
  const re=/(\d+(?:\.\d+)?)\s*(kg|g|ml|lit|l)\b/g;
  for(const m of text.matchAll(re)){
    let value=Number(m[1]), unit=m[2];
    if(!Number.isFinite(value)||value<=0)continue;
    if(unit==="kg"){value*=1000;unit="g";}
    if(unit==="l"||unit==="lit"){value*=1000;unit="ml";}
    out.add(String(Math.round(value*100)/100)+unit);
  }
  return out;
}
function groupNameTokens(name:unknown,brand:unknown) {
  const brandTokens=new Set(plain(brand).replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(Boolean));
  const out=new Set<string>();
  const words=plain(name).replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(Boolean);
  for(const word of words){
    if(/^\d+(?:\.\d+)?(?:kg|g|ml|l|lit)?$/.test(word))continue;
    if(word.length<2||GROUP_MATCH_NOISE.has(word)||brandTokens.has(word))continue;
    out.add(word);
  }
  return out;
}
function setIntersectionSize(a:Set<string>,b:Set<string>) {
  let n=0;
  for(const x of a)if(b.has(x))n++;
  return n;
}
function groupMatchScore(input:any,ref:BhxGroupRef) {
  const barcode=clean(input?.barcode||"");
  if(barcode&&ref.barcode&&barcode===ref.barcode)return 1.5;
  const brandKey=groupBrandKey(input?.brand||"");
  if(!brandKey||brandKey!==ref.brand_key)return 0;

  const a=groupNameTokens(input?.name||"",input?.brand||"");
  const b=ref.tokens;
  if(!a.size||!b.size)return 0;
  const common=setIntersectionSize(a,b);
  if(!common)return 0;

  const minSize=Math.min(a.size,b.size);
  const containment=common/minSize;
  const dice=(2*common)/(a.size+b.size);
  const aSizes=groupSizeSignatures(input?.name||"");
  const bSizes=ref.sizes;
  const bothSized=aSizes.size>0&&bSizes.size>0;
  const sizeMatch=bothSized&&setIntersectionSize(aSizes,bSizes)>0;

  let score=containment*0.66+dice*0.24+(sizeMatch?0.10:0);
  if(bothSized&&!sizeMatch)score-=0.05;
  if(common<2&&minSize>=2)score-=0.20;
  return Math.max(0,Math.min(1.5,score));
}
function chooseBhxGroup(input:any,refs:BhxGroupRef[]) {
  const brandKey=groupBrandKey(input?.brand||"");
  const barcode=clean(input?.barcode||"");
  if(!brandKey&&!barcode)return null;

  const byGroup=new Map<string,{score:number,ref:BhxGroupRef}>();
  for(const ref of refs){
    if(barcode&&ref.barcode&&barcode===ref.barcode){
      return {group:ref.group,score:1.5,margin:1.5,ref,basis:"barcode"};
    }
    if(!brandKey||ref.brand_key!==brandKey)continue;
    const score=groupMatchScore(input,ref);
    if(score<=0)continue;
    const prev=byGroup.get(ref.group);
    if(!prev||score>prev.score)byGroup.set(ref.group,{score,ref});
  }

  const ranked=[...byGroup.entries()]
    .map(([group,x])=>({group,score:x.score,ref:x.ref}))
    .sort((a,b)=>b.score-a.score);
  const best=ranked[0], second=ranked[1];
  if(!best||best.score<0.72)return null;
  const margin=best.score-(second?.score||0);
  if(second&&margin<0.08)return null;
  return {group:best.group,score:best.score,margin,ref:best.ref,basis:"brand_name_size"};
}
async function loadBhxGroupRefs() {
  const [links,ids]=await Promise.all([
    fetchAll("getlink_links","canonical_url,group_name,name,branch_name,last_status",(q:any)=>q.eq("link_type","product").eq("source","Bách Hóa XANH").neq("last_status","unlisted")),
    fetchAll("getlink_source_product_identity","link_url,brand,barcode,raw_name,source_name",(q:any)=>q.eq("source_name","Bách Hóa XANH"))
  ]);
  const identityByUrl=new Map(ids.map((x:any)=>[x.link_url,x]));
  const refs:BhxGroupRef[]=[];
  for(const l of links){
    const id=identityByUrl.get(l.canonical_url)||{};
    const group=clean(l.group_name);
    const brand=clean(id.brand||l.branch_name);
    const name=clean(id.raw_name||l.name);
    const brandKey=groupBrandKey(brand);
    if(!group||!brandKey||!name)continue;
    refs.push({
      url:l.canonical_url,group,name,brand,brand_key:brandKey,
      barcode:clean(id.barcode||""),
      tokens:groupNameTokens(name,brand),
      sizes:groupSizeSignatures(name)
    });
  }
  return refs;
}
async function mapIncomingWinmartGroups(products:Product[]) {
  if(!products.length)return;
  const refs=await loadBhxGroupRefs();
  for(const p of products){
    const si=p.source_identity||{};
    const match=chooseBhxGroup({
      name:clean(si.raw_name||p.name),
      brand:clean(si.brand||p.branch),
      barcode:clean(si.barcode||"")
    },refs);
    if(match)p.group=match.group;
  }
}
async function syncExistingWinmartGroups(apply:boolean) {
  const refs=await loadBhxGroupRefs();
  const [links,ids]=await Promise.all([
    fetchAll("getlink_links","*",(q:any)=>q.eq("link_type","product").eq("source","WinMart").neq("last_status","unlisted")),
    fetchAll("getlink_source_product_identity","link_url,brand,barcode,raw_name,category,source_name",(q:any)=>q.eq("source_name","WinMart"))
  ]);
  const identityByUrl=new Map(ids.map((x:any)=>[x.link_url,x]));
  const updates:any[]=[];
  const samples:any[]=[];
  let matched=0,changed=0,unresolved=0;

  for(const l of links){
    const id=identityByUrl.get(l.canonical_url)||{};
    const match=chooseBhxGroup({
      name:clean(id.raw_name||l.name),
      brand:clean(id.brand||l.branch_name),
      barcode:clean(id.barcode||"")
    },refs);
    if(!match){unresolved++;continue;}
    matched++;
    if(clean(l.group_name)===match.group)continue;
    changed++;
    updates.push({...l,group_name:match.group,updated_at:new Date().toISOString()});
    if(samples.length<40)samples.push({
      name:l.name,brand:id.brand||l.branch_name||"",
      old_group:l.group_name,new_group:match.group,
      bhx_name:match.ref.name,score:Number(match.score.toFixed(3)),
      margin:Number(match.margin.toFixed(3)),basis:match.basis,
      source_category:id.category||""
    });
  }

  if(apply&&updates.length){
    const chunk=400;
    for(let i=0;i<updates.length;i+=chunk){
      await must(sb.from("getlink_links").upsert(updates.slice(i,i+chunk),{onConflict:"canonical_url"}));
    }
  }
  return {apply,total_winmart:links.length,matched,changed,unresolved,samples};
}

function getlinkNameKey(v: unknown) {
  return plain(v).replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function isNumericBrandException(name: string, brand: string) {
  const n=getlinkNameKey(name), b=getlinkNameKey(brand);
  if(!/^\d+\s*[a-z]/.test(n))return false;
  if(!b||!/^\d+\s*[a-z]/.test(b))return false;
  const nc=n.replace(/[^a-z0-9]/g,"");
  const bc=b.replace(/[^a-z0-9]/g,"");
  return bc.length>=2 && nc.startsWith(bc);
}
function keepGetlinkProduct(p: Product) {
  const name=clean(p?.name||"");
  const brand=clean(p?.source_identity?.brand||p?.branch||"");
  const comboHay=getlinkNameKey([
    name,
    p?.url||"",
    p?.source_identity?.raw_name||""
  ].join(" "));
  if(/(^|\s)combo(\s|$)/.test(comboHay))return false;
  const nameKey=getlinkNameKey(name);
  if(/^\d+\s*[a-z]/.test(nameKey)&&!isNumericBrandException(name,brand))return false;
  return true;
}
function filterGetlinkProducts(products: Product[]) {
  return products.filter(keepGetlinkProduct);
}

function sanitizeCatalogPayload(payload:any) {
  if(!payload || typeof payload!=="object") return payload;
  if(payload.input_type==="product" && payload.product && !keepGetlinkProduct(payload.product)) return null;
  const out={...payload};
  if(Array.isArray(payload.products)){
    out.products=filterGetlinkProducts(payload.products);
    out.discovered_links=out.products.map((p:Product)=>p.url);
  }
  return out;
}

const BHX_HTTP1_CLIENT = Deno.createHttpClient({
  http1: true,
  http2: false,
  poolMaxIdlePerHost: 4,
  poolIdleTimeout: 30
});

const BHX_XAPIKEY = clean(Deno.env.get("BHX_XAPIKEY") || "bhx-api-core-2022");
const BHX_BEARER_TOKEN = clean(Deno.env.get("BHX_BEARER_TOKEN") || "");
const BHX_DEVICE_ID = clean(Deno.env.get("BHX_DEVICE_ID") || "");
const BHX_PAGE_SIZE = 10;
const BHX_TRANSPORT_URL = clean(Deno.env.get("BHX_TRANSPORT_URL") || "https://getlink-bhx-relay.taphoa-4ab8161d.workers.dev");

function bhxWebReferer(referer: string) {
  try {
    const u = new URL(referer || "https://www.bachhoaxanh.com/");
    u.protocol = "https:";
    u.hostname = "www.bachhoaxanh.com";
    return u.toString();
  } catch {
    return "https://www.bachhoaxanh.com/";
  }
}
function bhxHeaders(referer: string) {
  const webReferer = bhxWebReferer(referer);
  const headers: Record<string,string> = {
    "accept":"application/json, text/plain, */*",
    "accept-language":"vi-VN,vi;q=0.9,en;q=0.7",
    "origin":"https://www.bachhoaxanh.com",
    "referer":webReferer,
    "referer-url":webReferer,
    "reversehost":"http://bhxapi.live",
    "xapikey":BHX_XAPIKEY,
    "platform":"webnew",
    "customer-id":""
  };
  if (BHX_DEVICE_ID) headers["deviceid"] = BHX_DEVICE_ID;
  if (BHX_BEARER_TOKEN) {
    headers["authorization"] = /^Bearer\s+/i.test(BHX_BEARER_TOKEN)
      ? BHX_BEARER_TOKEN
      : "Bearer " + BHX_BEARER_TOKEN;
  }
  return headers;
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
function isBhxProductRecord(item:any) {
  return Boolean(
    item && typeof item==="object" && item.url &&
    (
      Array.isArray(item.productPrices) ||
      item.price != null ||
      item.sysPrice != null ||
      item.avatar ||
      item.fullName ||
      item.productCode ||
      item.skuInfo
    )
  );
}
function bhxProductKey(item:any) {
  const id=bhxProductId(item);
  if(id>0)return "id:"+String(id);
  const code=clean(item?.productCode||item?.code||"");
  if(code)return "code:"+code;
  return "url:"+clean(item?.url||"");
}
function collectBhx(payload: any, _categoryUrl: string) {
  const map = new Map<string,any>();
  const walk = (v:any) => {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (isBhxProductRecord(item)) map.set(bhxProductKey(item), item);
        walk(item);
      }
    } else if (v && typeof v==="object") {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(payload);
  return [...map.values()];
}
function bhxPayloadProducts(payload:any, categoryUrl:string) {
  const direct = payload?.data?.products;
  if (Array.isArray(direct)) {
    const map=new Map<string,any>();
    for(const item of direct) if(isBhxProductRecord(item)) map.set(bhxProductKey(item),item);
    if(map.size)return [...map.values()];
  }
  return collectBhx(payload,categoryUrl);
}
function bhxCategoryId(items:any[], payload?:any) {
  const infoId=Number(payload?.data?.info?.id)||0;
  if(infoId>0)return infoId;
  for (const item of items) {
    const cat = item?.category && typeof item.category==="object" ? item.category : {};
    for (const v of [item?.categoryId,item?.categoryID,cat.id,cat.categoryId,cat.categoryID]) {
      const n=Number(v)||0; if (n>0) return n;
    }
  }
  return 0;
}
function bhxCategoryTotal(payload:any) {
  const n=Number(payload?.data?.total);
  return Number.isFinite(n)&&n>0?Math.floor(n):0;
}
function bhxPriorityProductIds(payload:any) {
  const ids=payload?.data?.info?.priorityProductIds;
  return Array.isArray(ids)
    ? ids.map((x:any)=>Number(x)||0).filter((x:number)=>x>0).join(",")
    : clean(ids||"");
}
function bhxProductId(item:any) {
  return Number(item?.id||item?.productId||item?.productID||item?.ProductId||item?.ProductID||0)||0;
}
async function bhxTransportCategory(url:string) {
  const c=canonicalBhx(url);
  const slug=pathParts(c)[0]||"";
  if(!slug)throw new Error("bhx_category_slug_missing");
  const categoryUrl="https://www.bachhoaxanh.com/"+slug;
  let last="";
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(BHX_TRANSPORT_URL+"/category",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({url:categoryUrl})
      });
      if(!r.ok){last="http_"+r.status+":"+(await r.text()).slice(0,300);continue;}
      const body=await r.json();
      if(body&&Number(body.code)===0&&body.data!=null)return body;
      last="code_"+String(body?.code);
    }catch(e){
      last=String(e&&e.message||e).slice(0,300);
    }
  }
  throw new Error("bhx_transport_failed:"+last);
}

async function bhxTransportMenu() {
  let last="";
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(BHX_TRANSPORT_URL+"/bhx",{
        method:"POST",
        headers:{
          "content-type":"application/json",
          "x-getlink-relay":"supabase-bhx-v1"
        },
        body:JSON.stringify({op:"getMenuCategory"})
      });
      if(!r.ok){last="http_"+r.status+":"+(await r.text()).slice(0,300);continue;}
      const body=await r.json();
      if(body&&Number(body.code)===0&&body.data!=null)return body;
      last="code_"+String(body?.code);
    }catch(e){
      last=String(e&&e.message||e).slice(0,300);
    }
  }
  throw new Error("bhx_menu_failed:"+last);
}
function bhxMenuNodes(body:any) {
  const roots=Array.isArray(body?.data?.menus)?body.data.menus:[];
  const out:any[]=[];
  const walk=(node:any)=>{
    if(!node||typeof node!=="object")return;
    out.push(node);
    const kids=Array.isArray(node.childrens)?node.childrens:[];
    for(const child of kids)walk(child);
  };
  for(const root of roots)walk(root);
  return out;
}
function bhxTextKey(v:any) {
  return plain(v).replace(/[^a-z0-9]+/g," ").trim();
}
function resolveBhxMenuNode(slug:string, body:any) {
  const nodes=bhxMenuNodes(body);
  const exact=nodes.find((n:any)=>clean(n?.url).toLowerCase()===slug.toLowerCase());
  if(exact)return exact;

  const tokens=bhxTextKey(slug).split(" ").filter(Boolean);
  const scored=nodes.map((n:any)=>{
    const url=bhxTextKey(n?.url||"");
    const name=bhxTextKey(n?.name||"");
    const hay=(url+" "+name).trim();
    if(!tokens.length||!tokens.every((t:string)=>hay.includes(t)))return null;
    const kids=Array.isArray(n?.childrens)?n.childrens.length:0;
    const contiguous=url.includes(tokens.join(" "))?4:0;
    return {node:n,score:(kids?100:0)+contiguous+tokens.length};
  }).filter(Boolean).sort((a:any,b:any)=>b.score-a.score);
  return scored[0]?.node||null;
}
function bhxLeafMenuNodes(node:any) {
  const kids=Array.isArray(node?.childrens)?node.childrens.filter(Boolean):[];
  if(!kids.length)return [node];
  const out:any[]=[];
  for(const child of kids)out.push(...bhxLeafMenuNodes(child));
  return out;
}
async function bhxParentCategoryRaw(c:string, directError:any) {
  const slug=pathParts(c)[0]||"";
  const menu=await bhxTransportMenu();
  const node=resolveBhxMenuNode(slug,menu);
  if(!node)throw directError;

  const leaves=bhxLeafMenuNodes(node)
    .filter((n:any)=>clean(n?.url))
    .filter((n:any)=>clean(n?.url).toLowerCase()!==slug.toLowerCase());
  if(!leaves.length)throw directError;

  const map=new Map<string,any>();
  let total=0;
  for(let start=0;start<leaves.length;start+=3){
    const batch=leaves.slice(start,start+3);
    const bodies=await Promise.all(batch.map((leaf:any)=>
      bhxTransportCategory("https://www.bachhoaxanh.com/"+clean(leaf.url))
    ));
    for(let i=0;i<bodies.length;i++){
      const body=bodies[i];
      total+=bhxCategoryTotal(body);
      for(const item of bhxPayloadProducts(body,clean(batch[i]?.url||""))){
        map.set(bhxProductKey(item),item);
      }
    }
  }
  if(!map.size)throw directError;
  return {
    items:[...map.values()],
    categoryId:Number(node?.id)||0,
    rootName:clean(node?.name||slugTitle(c)),
    total:total||map.size
  };
}

async function bhxProductDetail(url:string) {
  const c=canonicalBhx(url);
  const parts=pathParts(c);
  if(parts.length<2)throw new Error("bhx_product_url_required");
  const categoryUrl="https://bachhoaxanh.com/"+parts[0];
  const body=await bhxTransportCategory(categoryUrl);
  const items=bhxPayloadProducts(body,categoryUrl);
  const match=items.find((item:any)=>{
    try{
      return canonicalBhx(new URL(String(item?.url||""),"https://www.bachhoaxanh.com").toString())===c;
    }catch{return false;}
  });
  if(!match)throw new Error("bhx_product_not_found_in_category");
  return {
    boxBuys:[match],
    categoryId:bhxCategoryId(items,body),
    categoryName:clean(body?.data?.info?.name||match?.category?.name||parts[0]),
    brandUrl:clean(match?.brandName||"")
  };
}
async function bhxCategoryRaw(url:string) {
  const c=canonicalBhx(url);
  try{
    const body=await bhxTransportCategory(c);
    const items=bhxPayloadProducts(body,c);
    const categoryId=bhxCategoryId(items,body);
    if(!categoryId)throw new Error("bhx_category_id_missing");
    const total=bhxCategoryTotal(body);
    const rootName=clean(body?.data?.info?.name||items[0]?.category?.name||slugTitle(c));
    if(total>0&&items.length<Math.min(total,10)){
      throw new Error("bhx_transport_partial:"+items.length+"/"+total);
    }
    return {items,categoryId,rootName,total};
  }catch(e){
    return await bhxParentCategoryRaw(c,e);
  }
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
    const products=filterGetlinkProducts(raw.items.map((x:any)=>normalizeWinmart(x,raw.rootName,raw.store,checked)).filter(Boolean) as Product[]);
    return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"category",source:sourceObject(key),checked_at:checked,category_name:raw.rootName,products,variants:[],discovered_links:products.map(p=>p.url)},engine:"supabase-edge-winmart"};
  }
  if(key==="bachhoaxanh"){
    if(kind==="product"){
      const data=await bhxProductDetail(url), product=normalizeBhxDetail(data,url,checked);
      if(!keepGetlinkProduct(product))throw new Error("product_blocked_by_name_rule");
      return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"product",source:sourceObject(key),checked_at:checked,category_name:product.group,product,products:[product],variants:[],discovered_links:[product.url]},engine:"supabase-edge-bhx"};
    }
    const raw=await bhxCategoryRaw(url);
    const root=clean(raw.rootName||raw.items[0]?.category?.name||slugTitle(url));
    const products=filterGetlinkProducts(raw.items.map((x:any)=>normalizeBhx(x,root,checked)).filter(Boolean) as Product[]);
    return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"category",source:sourceObject(key),checked_at:checked,category_name:root,category_id:raw.categoryId,products,variants:[],discovered_links:products.map(p=>p.url)},engine:"supabase-edge-bhx"};
  }
  if(key==="go"){
    if(kind!=="category")throw new Error("go_category_link_required");
    const raw=await goCategory(url);
    const products=filterGetlinkProducts(raw.items.map((x:any)=>normalizeGo(x,raw.rootName,checked)).filter(Boolean) as Product[]);
    return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"category",source:sourceObject(key),checked_at:checked,category_name:raw.rootName,products,variants:[],discovered_links:products.map(p=>p.url)},engine:"supabase-edge-go"};
  }
  throw new Error("unsupported_source");
}

async function must<T>(promise: PromiseLike<{data:T,error:any}>) {
  const {data,error}=await promise; if(error)throw error; return data;
}
async function persistPayload(payload:any, engine:string){
  const now=new Date().toISOString(), requestId=payload.request_id, input=payload.input_url, key=payload.source.key;
  const products:Product[]=filterGetlinkProducts(Array.isArray(payload.products)?payload.products:[]);
  if(key==="winmart"&&products.length)await mapIncomingWinmartGroups(products);
  payload.products=products;
  payload.discovered_links=products.map((p:Product)=>p.url);
  if(payload.input_type==="product"&&payload.product&&!keepGetlinkProduct(payload.product))throw new Error("product_blocked_by_name_rule");
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
          const cached=sanitizeCatalogPayload(data.result_json);
          if(cached){
            const {count}=await sb.from("getlink_links").select("*",{count:"exact",head:true});
            return response(req,{request_id:data.request_id,status:"complete",input_url:input,link_type:data.link_type,payload:cached,registry_count:Number(count||0),engine:"supabase-cache",cache_hit:true});
          }
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
      if(data.status==="complete"){
        const payload=sanitizeCatalogPayload(data.result_json);
        if(!payload)return response(req,{status:"error",error:"product_blocked_by_name_rule",request_id:id},410);
        return response(req,{status:"complete",payload,request_id:id});
      }
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
        let payload=sanitizeCatalogPayload(data?.result_json||null); if(!payload)payload=await reconstructItem(itemUrl); payload=sanitizeCatalogPayload(payload); if(!payload)return response(req,{error:"not_found"},404);
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
    if(req.method==="POST"&&route==="/api/admin/group-sync"){
      const body=await req.json();
      if(clean(body?.confirm)!=="BHX_GROUP_SYNC_V1")return response(req,{error:"confirmation_required"},400);
      return response(req,await syncExistingWinmartGroups(Boolean(body?.apply)));
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
