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
function errorText(e: unknown): string {
  if(e instanceof Error)return e.message;
  if(e&&typeof e==="object"&&"message" in e){
    return String((e as {message?: unknown}).message ?? e);
  }
  return String(e ?? "");
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
  const s = plain(text).replace(/,/g, ".");
  // Negative lookahead prevents Vietnamese words such as "goi" from being
  // misread as grams (e.g. "30 goi ... 75g" must resolve to 75g, not 30g).
  const re=/(\d+(?:\.\d+)?)\s*(ml|lit|l|kg|g)(?![a-z])/gi;
  let picked:RegExpExecArray|null=null;
  for(const m of s.matchAll(re)){
    picked=m as RegExpExecArray;
  }
  if (!picked) return { value: null as number | null, unit: "" };
  let value = Number(picked[1]);
  let unit = picked[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return { value: null, unit: "" };
  if (["l","lit"].includes(unit)) { value = Math.round(value * 1000); unit = "ml"; }
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
type RawCaptureEntry={
  seq:number;
  endpoint:string;
  method:string;
  status:number;
  content_type:string;
  response_body:string;
};
type RawCapture={entries:RawCaptureEntry[]};

function createRawCapture():RawCapture{
  return {entries:[]};
}

async function readCapturedJson(
  response:Response,
  capture:RawCapture,
  endpoint:string,
  method:string
):Promise<any>{
  const responseBody=await response.text();
  capture.entries.push({
    seq:capture.entries.length+1,
    endpoint,
    method,
    status:response.status,
    content_type:clean(response.headers.get("content-type")||""),
    response_body:responseBody
  });
  if(!responseBody)return null;
  try{return JSON.parse(responseBody);}
  catch{return null;}
}

async function sha256Text(value:string):Promise<string>{
  const bytes=new TextEncoder().encode(value);
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(hash))
    .map(x=>x.toString(16).padStart(2,"0"))
    .join("");
}

async function persistRawCapture(
  requestId:string,
  inputUrl:string,
  inputType:string,
  source:string,
  capture:RawCapture
):Promise<number>{
  if(!capture.entries.length)throw new Error("raw_capture_empty");
  const fetchedAt=new Date().toISOString();
  const rows=await Promise.all(capture.entries.map(async entry=>({
    request_id:requestId,
    request_seq:entry.seq,
    source_key:source,
    input_url:inputUrl,
    input_type:inputType,
    capture_stage:"source_original",
    fetched_at:fetchedAt,
    endpoint:entry.endpoint,
    http_method:entry.method,
    http_status:entry.status,
    content_type:entry.content_type,
    response_body:entry.response_body,
    body_sha256:await sha256Text(entry.response_body),
    created_at:fetchedAt
  })));
  for(let i=0;i<rows.length;i+=25){
    const batch=rows.slice(i,i+25);
    const {error}=await sb.from("getlink_raw_fetches").insert(batch);
    if(error)throw error;
  }
  return rows.length;
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
    "chai":"Chai","chia":"Chai","lon":"Lon","hop":"Hộp","goi":"Gói","tui":"Túi","bich":"Bịch",
    "hu":"Hũ","lo":"Lọ","can":"Can","mieng":"Miếng","thanh":"Thanh","vien":"Viên",
    "loc":"Lốc","khay":"Khay","vi":"Vỉ","thung":"Thùng","ly":"Ly","to":"Tô","binh":"Bình"
  };
  for (const [k,v] of Object.entries(map)) {
    if (new RegExp("\\b" + k + "\\b").test(key)) return v;
  }
  return clean(raw);
}
function hierarchyFromRaw(name: string, packaging: string, count?: unknown, unit?: unknown) {
  const text = clean([name, packaging, count, unit].filter(Boolean).join(" ")).toLowerCase().normalize("NFC");
  const h = { label1:"", qty1:0, label2:"", qty2:0, label3:"", qty3:0, evidence:"source", locked:false };

  const unitMap:Record<string,string>={
    "thùng":"Thùng","lốc":"Lốc","khay":"Khay","vỉ":"Vỉ","chai":"Chai","lon":"Lon",
    "hộp":"Hộp","gói":"Gói","túi":"Túi","bịch":"Bịch","hũ":"Hũ","lọ":"Lọ","can":"Can",
    "miếng":"Miếng","thanh":"Thanh","viên":"Viên","cái":"Cái","cây":"Cây","bộ":"Bộ","đôi":"Đôi",
    "tuýp":"Tuýp","túyp":"Tuýp","ly":"Ly","tô":"Tô","bình":"Bình"
  };
  const unitPattern="thùng|lốc|khay|vỉ|chai|chia|lon|hộp|gói|túi|bịch|hũ|lọ|can|miếng|thanh|viên|cái|cây|bộ|đôi|tuýp|túyp|ly|tô|bình";
  const pairRe=new RegExp("(?:^|[^\\p{L}\\p{N}])(\\d+)\\s*("+unitPattern+")(?![\\p{L}])","gu");
  const pairs:{qty:number,key:string,label:string}[]=[];
  for(const m of text.matchAll(pairRe)){
    const key=String(m[2]||"").toLowerCase();
    pairs.push({qty:Number(m[1])||0,key,label:unitMap[key]||clean(m[2])});
  }

  // Handles "lốc 4 hộp", "khay 6 chai", "vỉ 10 gói".
  const bundleRe=new RegExp("(?:^|[^\\p{L}])(lốc|khay|vỉ)\\s*(\\d+)\\s*(chai|chia|lon|hộp|gói|túi|bịch|hũ|lọ|can|miếng|thanh|viên|cái|cây|bộ|đôi|tuýp|túyp)(?![\\p{L}])","u");
  const bundle=text.match(bundleRe);
  const rawUnit=clean(unit||packaging).toLowerCase().normalize("NFC");
  const hasCarton=new RegExp("(?:^|[^\\p{L}])thùng(?![\\p{L}])","u").test(text)||
    rawUnit==="thùng";
  if(hasCarton){
    h.label1="Thùng"; h.qty1=1;

    const leadingBundle=/^\s*(khay|vỉ)\s+\d+\s+/iu.test(text);
    if(bundle){
      const middleKey=String(bundle[1]||"").toLowerCase();
      const leafKey=String(bundle[3]||"").toLowerCase();

      // Source packaging already defines the sold unit as Thùng.
      // "Khay 24 lon..." / "Vỉ 24 gói..." means one carton contains
      // 24 leaf units; "khay/vỉ" is presentation wording, not another level.
      if(leadingBundle){
        h.label3=unitMap[leafKey]||clean(bundle[3]); h.qty3=Number(bundle[2])||1;
      }else{
        h.label2=unitMap[middleKey]||clean(bundle[1]); h.qty2=1;
        h.label3=unitMap[leafKey]||clean(bundle[3]); h.qty3=Number(bundle[2])||1;
      }
      return h;
    }

    const middle=pairs.find(x=>["lốc","khay","vỉ"].includes(x.key));
    const leaf=[...pairs].reverse().find(x=>!["thùng","lốc","khay","vỉ"].includes(x.key));
    if(middle&&!leadingBundle){h.label2=middle.label;h.qty2=middle.qty;}
    if(leaf){h.label3=leaf.label;h.qty3=leaf.qty;}

    if(!h.label3){
      // Handles source values such as "Thùng 24" while the product name says "lon".
      const cartonCount=text.match(new RegExp("(?:^|[^\\p{L}])thùng\\s*(\\d+)(?![\\p{L}\\p{N}])","u"));
      const leafWord=[...text.matchAll(new RegExp("(?:^|[^\\p{L}])(chai|chia|lon|hộp|gói|túi|bịch|hũ|lọ|can|miếng|thanh|viên|cái|cây|bộ|đôi|tuýp|túyp)(?![\\p{L}])","gu"))].pop();
      if(cartonCount&&leafWord){
        const key=String(leafWord[1]||"").toLowerCase();
        h.label3=unitMap[key]||clean(leafWord[1]);h.qty3=Number(cartonCount[1])||1;
      }else if(rawUnit&&rawUnit!=="thùng"&&unitMap[rawUnit]){
        h.label3=unitMap[rawUnit];h.qty3=Number(count)||1;
      }
    }
    return h;
  }

  if(bundle){
    const middleKey=String(bundle[1]||"").toLowerCase();
    const leafKey=String(bundle[3]||"").toLowerCase();
    h.label2=unitMap[middleKey]||clean(bundle[1]); h.qty2=1;
    h.label3=unitMap[leafKey]||clean(bundle[3]); h.qty3=Number(bundle[2])||1;
    return h;
  }

  const middlePair=pairs.find(x=>["lốc","khay","vỉ"].includes(x.key));
  if(middlePair){
    h.label2=middlePair.label;h.qty2=middlePair.qty||1;
    const leaf=[...pairs].reverse().find(x=>!["lốc","khay","vỉ"].includes(x.key));
    if(leaf){h.label3=leaf.label;h.qty3=leaf.qty;}
    return h;
  }

  const directPair=pairs.find(x=>x.qty>1&&x.key!=="thùng");
  if(directPair){
    h.label2=directPair.label;h.qty2=directPair.qty;
    return h;
  }

  if(rawUnit&&unitMap[rawUnit]&&rawUnit!=="thùng"){
    h.label3=unitMap[rawUnit];
    h.qty3=1;
    return h;
  }

  // Prefer the explicit source packaging field before scanning the product name.
  // This prevents words such as "trái cây" from being mistaken for unit "Cây".
  const rawUnitMatch=rawUnit.match(new RegExp("(?:^|[^\\p{L}])("+unitPattern+")(?![\\p{L}])","u"));
  if(rawUnitMatch){
    const key=String(rawUnitMatch[1]||"").toLowerCase();
    if(key!=="thùng"){
      h.label3=unitMap[key]||clean(rawUnitMatch[1]);
      h.qty3=1;
      return h;
    }
  }

  // Last resort: a real packaging word in the original accented text.
  const leafMatch=text.match(new RegExp("(?:^|[^\\p{L}])("+unitPattern+")(?![\\p{L}])","u"));
  if(leafMatch){
    const key=String(leafMatch[1]||"").toLowerCase();
    if(key!=="thùng"){h.label3=unitMap[key]||clean(leafMatch[1]);h.qty3=1;}
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
  packaging:string;
  hierarchy:any;
  comparison:any;
  pack_kind:string;
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

function hierarchyKind(h:any) {
  if(clean(h?.label1)==="Thùng")return "carton";
  if(clean(h?.label2))return "middle";
  return "leaf";
}
function productVariantNumbers(name:unknown) {
  let s=plain(name);
  s=s.replace(/\d+(?:\.\d+)?\s*(ml|lit|l|kg|g)(?![a-z])/g," ");
  s=s.replace(/\d+\s*(thung|loc|khay|vi|chai|lon|hop|goi|tui|bich|hu|lo|can|mieng|thanh|vien|cai|cay|bo|doi|tuyp)(?![a-z])/g," ");
  return [...s.matchAll(/(?:^|[^a-z0-9])(\d+)(?=$|[^a-z0-9])/g)].map(m=>m[1]).sort().join(",");
}

function chooseBhxProduct(input:any,refs:BhxGroupRef[]) {
  const brandKey=groupBrandKey(input?.brand||"");
  const barcode=clean(input?.barcode||"");
  const wantedKind=clean(input?.pack_kind||"");
  const inputSizes=groupSizeSignatures(input?.name||"");
  const ranked:any[]=[];

  for(const ref of refs){
    if(barcode&&ref.barcode&&barcode===ref.barcode){
      if(!wantedKind||ref.pack_kind===wantedKind){
        return {ref,score:1.5,margin:1.5,basis:"barcode"};
      }
    }
    if(!brandKey||ref.brand_key!==brandKey)continue;
    if(wantedKind&&ref.pack_kind!==wantedKind)continue;

    const refSizes=ref.sizes;
    if(inputSizes.size&&refSizes.size&&!setIntersectionSize(inputSizes,refSizes))continue;

    const inputVariant=productVariantNumbers(input?.name||"");
    const refVariant=productVariantNumbers(ref.name);
    if((inputVariant||refVariant)&&inputVariant!==refVariant)continue;

    const score=groupMatchScore(input,ref);
    if(score>=0.95)ranked.push({ref,score});
  }

  ranked.sort((a,b)=>b.score-a.score);
  const best=ranked[0], second=ranked[1];
  if(!best)return null;
  const margin=best.score-(second?.score||0);
  if(second&&margin<0.08)return null;
  return {ref:best.ref,score:best.score,margin,basis:"brand_name_size_kind"};
}
function mergedHierarchy(primary:any,donor:any,wantedKind:string) {
  const a={label1:clean(primary?.label1),qty1:Number(primary?.qty1)||0,label2:clean(primary?.label2),qty2:Number(primary?.qty2)||0,label3:clean(primary?.label3),qty3:Number(primary?.qty3)||0};
  const b={label1:clean(donor?.label1),qty1:Number(donor?.qty1)||0,label2:clean(donor?.label2),qty2:Number(donor?.qty2)||0,label3:clean(donor?.label3),qty3:Number(donor?.qty3)||0};
  const out={...a,evidence:"source",locked:false};

  if(wantedKind==="carton"||a.label1==="Thùng"||b.label1==="Thùng"){
    out.label1="Thùng";
    out.qty1=1;
  }
  if(!out.label2&&b.label2){out.label2=b.label2;out.qty2=b.qty2||1;}
  if(!out.label3&&b.label3){out.label3=b.label3;out.qty3=b.qty3||1;}

  // For a carton, "Thùng" is always the parent. Child quantity never replaces it.
  if(out.label1==="Thùng"&&out.label3&&out.qty3<=0)out.qty3=b.qty3||1;
  if(out.label1==="Thùng"&&out.label2&&out.qty2<=0)out.qty2=b.qty2||1;

  const borrowed=
    (!a.label2&&Boolean(out.label2))||
    (!a.label3&&Boolean(out.label3))||
    (a.label1!=="Thùng"&&out.label1==="Thùng");
  out.evidence=borrowed?"source+bhx-match":"source";
  return out;
}
function enrichWinmartProductFromBhx(p:Product,match:any) {
  if(!match?.ref)return;
  const ref:BhxGroupRef=match.ref;
  const si=p.source_identity||(p.source_identity={});
  const ownH=hierarchyFromRaw(p.name,p.packaging?.text||"");
  const wantedKind=hierarchyKind(ownH);
  const mergedH=mergedHierarchy(ownH,ref.hierarchy,wantedKind);
  const ownCmp=comparisonFrom(p.price?.current||null,p.price?.original||null,mergedH,p.packaging?.text||"",p.name);
  const donorCmp=ref.comparison||{};

  p.hierarchy=mergedH;
  p.comparison={
    ...ownCmp,
    size_value:ownCmp.size_value??donorCmp.size_value??null,
    size_unit:ownCmp.size_unit||donorCmp.size_unit||"",
    pack_kind:hierarchyKind(mergedH),
    pack_quantity:mergedH.label1
      ?Number(mergedH.qty3||mergedH.qty2||1)
      :(mergedH.label2?Number(mergedH.qty3||mergedH.qty2||1):1),
    pack_unit:mergedH.label1||mergedH.label2||mergedH.label3||ownCmp.pack_unit||""
  };
  si.bhx_match_url=ref.url;
  si.bhx_match_name=ref.name;
}
async function loadBhxGroupRefs() {
  const [links,ids,hier,comps]=await Promise.all([
    fetchAll("getlink_links","canonical_url,group_name,name,branch_name,packaging,last_status",(q:any)=>q.eq("link_type","product").eq("source","Bách Hóa XANH").neq("last_status","unlisted")),
    fetchAll("getlink_source_product_identity","link_url,brand,barcode,raw_name,source_name",(q:any)=>q.eq("source_name","Bách Hóa XANH")),
    fetchAll("getlink_link_pack_hierarchy"),
    fetchAll("getlink_link_comparison")
  ]);
  const identityByUrl=new Map(ids.map((x:any)=>[x.link_url,x]));
  const hierarchyByUrl=new Map(hier.map((x:any)=>[x.link_url,x]));
  const comparisonByUrl=new Map(comps.map((x:any)=>[x.link_url,x]));
  const refs:BhxGroupRef[]=[];
  for(const l of links){
    const id=identityByUrl.get(l.canonical_url)||{};
    const h=hierarchyFromRaw(l.name,l.packaging||"");
    const storedCmp=comparisonByUrl.get(l.canonical_url)||{};
    const parsedCmp=comparisonFrom(null,null,h,l.packaging||"",l.name);
    const cmp={...storedCmp,...parsedCmp,size_value:parsedCmp.size_value??storedCmp.size_value??null,size_unit:parsedCmp.size_unit||storedCmp.size_unit||""};
    const group=clean(l.group_name);
    const brand=clean(id.brand||l.branch_name);
    const name=clean(id.raw_name||l.name);
    const brandKey=groupBrandKey(brand);
    if(!group||!brandKey||!name)continue;
    refs.push({
      url:l.canonical_url,group,name,brand,brand_key:brandKey,
      barcode:clean(id.barcode||""),
      packaging:clean(l.packaging||""),
      hierarchy:h,
      comparison:cmp,
      pack_kind:hierarchyKind(h),
      tokens:groupNameTokens(name,brand),
      sizes:groupSizeSignatures(name)
    });
  }
  return refs;
}
async function mapIncomingWinmartGroups(products:Product[]) {
  if(!products.length)return;
  const refs=await loadBhxGroupRefs();

  const brandCounts=new Map<string,Map<string,number>>();
  for(const ref of refs){
    const key=ref.brand_key;
    if(!key)continue;
    if(!brandCounts.has(key))brandCounts.set(key,new Map());
    const variants=brandCounts.get(key)!;
    variants.set(ref.brand,(variants.get(ref.brand)||0)+1);
  }
  const canonicalBrand=new Map<string,string>();
  for(const [key,variants] of brandCounts){
    const best=[...variants.entries()]
      .sort((a,b)=>(b[1]-a[1])||a[0].localeCompare(b[0],"vi"))[0];
    if(best)canonicalBrand.set(key,best[0]);
  }

  for(const p of products){
    const si=p.source_identity||(p.source_identity={});
    const rawBrand=clean(si.brand||p.branch);
    const brandKey=groupBrandKey(rawBrand);
    const inputName=clean(si.raw_name||p.name);
    const ownH=hierarchyFromRaw(inputName,p.packaging?.text||"");
    const match=chooseBhxGroup({
      name:inputName,
      brand:rawBrand,
      barcode:clean(si.barcode||"")
    },refs);
    const productMatch=chooseBhxProduct({
      name:inputName,
      brand:rawBrand,
      barcode:clean(si.barcode||""),
      pack_kind:hierarchyKind(ownH)
    },refs);
    // Keep WinMart source fields untouched; BHX contributes canonical browse aliases
    // and missing pack/size metadata only when the product match is confident.
    si.bhx_group_name=match?match.group:"";
    si.bhx_brand_name=canonicalBrand.get(brandKey)||"";
    if(productMatch)enrichWinmartProductFromBhx(p,productMatch);
  }
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
async function bhxTransportCategory(url:string, capture:RawCapture) {
  const c=canonicalBhx(url);
  const slug=pathParts(c)[0]||"";
  if(!slug)throw new Error("bhx_category_slug_missing");
  const categoryUrl="https://www.bachhoaxanh.com/"+slug;
  let last="";
  for(let attempt=0;attempt<2;attempt++){
    try{
      const endpoint=BHX_TRANSPORT_URL+"/category";
      const r=await fetch(endpoint,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({url:categoryUrl})
      });
      const body=await readCapturedJson(r,capture,endpoint,"POST");
      if(!r.ok){last="http_"+r.status+":"+clean(JSON.stringify(body||"")).slice(0,300);continue;}
      if(body&&Number(body.code)===0&&body.data!=null)return body;
      last="code_"+String(body?.code);
    }catch(e){
      last=errorText(e).slice(0,300);
    }
  }
  throw new Error("bhx_transport_failed:"+last);
}

async function bhxTransportMenu(capture:RawCapture) {
  let last="";
  for(let attempt=0;attempt<2;attempt++){
    try{
      const endpoint=BHX_TRANSPORT_URL+"/bhx";
      const r=await fetch(endpoint,{
        method:"POST",
        headers:{
          "content-type":"application/json",
          "x-getlink-relay":"supabase-bhx-v1"
        },
        body:JSON.stringify({op:"getMenuCategory"})
      });
      const body=await readCapturedJson(r,capture,endpoint,"POST");
      if(!r.ok){last="http_"+r.status+":"+clean(JSON.stringify(body||"")).slice(0,300);continue;}
      if(body&&Number(body.code)===0&&body.data!=null)return body;
      last="code_"+String(body?.code);
    }catch(e){
      last=errorText(e).slice(0,300);
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
async function bhxParentCategoryRaw(c:string, directError:any, capture:RawCapture) {
  const slug=pathParts(c)[0]||"";
  const menu=await bhxTransportMenu(capture);
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
      bhxTransportCategory("https://www.bachhoaxanh.com/"+clean(leaf.url),capture)
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

async function bhxProductDetail(url:string, capture:RawCapture) {
  const c=canonicalBhx(url);
  const parts=pathParts(c);
  if(parts.length<2)throw new Error("bhx_product_url_required");
  const categoryUrl="https://bachhoaxanh.com/"+parts[0];
  const body=await bhxTransportCategory(categoryUrl,capture);
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
async function bhxCategoryRaw(url:string, capture:RawCapture) {
  const c=canonicalBhx(url);
  try{
    const body=await bhxTransportCategory(c,capture);
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
    return await bhxParentCategoryRaw(c,e,capture);
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
async function winmartCategory(url:string,capture:RawCapture){
  const c=canonicalWinmart(url), slug=winmartSlug(c), store=winmartStore(c); if(!slug)throw new Error("winmart_slug_missing");
  const fetchPage=async(page:number)=>{
    const api=new URL("https://api-crownx.winmart.vn/it/api/web/v3/item/category");
    for(const [k,v] of Object.entries({storeCode:store,slug,pageNumber:String(page),pageSize:"500",orderByDesc:"true",storeGroupCode:"1998"}))api.searchParams.set(k,v);
    const r=await fetch(api,{headers:{"accept":"application/json","x-api-merchant":"WCM","origin":"https://winmart.vn","referer":"https://winmart.vn/"}});
    const body=await readCapturedJson(r,capture,api.toString(),"GET");
    if(!r.ok)throw new Error("winmart_http_"+r.status);
    const data=body?.data||{}, items=Array.isArray(data.items)?data.items:[];
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
  const h=hierarchyFromRaw(name,type,item?.packageItemCount,item?.packageItemUnit||type);
  const cmp=comparisonFrom(current,original,h,type,name);
  const size={value:cmp.size_value,unit:cmp.size_unit};
  const ident=matchIdentity(name,brand,clean(item?.barcode||""),size);
  return {
    source:sourceObject("winmart"),group:rootName,branch:brand,name,packaging:{text:type},
    hierarchy:h,
    comparison:cmp,
    price:{current,original},promotion:{active:Boolean(original&&original>current),price:null,text:""},url,image:winmartImage(item),breadcrumbs:[rootName,child,brand].filter(Boolean),
    source_identity:{
      source_product_id:clean(item?.id||""),source_code:clean(item?.itemNo||""),barcode:clean(item?.barcode||""),sku:clean(item?.sku||""),
      brand,category:child,raw_name:name,raw_description:clean([item?.description,item?.shortDescription].filter(Boolean).join(" · ")),...ident
    },last_checked_at:checked
  };
}

const GO_API_CLIENT_ID=(Deno.env.get("GO_API_CLIENT_ID")||"8472594").trim();
const GO_STORE_ID=Number(Deno.env.get("GO_STORE_ID")||"151")||151;

function goCategoryId(url:string){
  const m=new URL(url).pathname.match(/-i\.(\d+)$/i); return m?Number(m[1]):0;
}

let GO_RUNTIME_CACHE:any=null;
async function goRuntimeConfig(){
  const env={
    apiclientid:clean(Deno.env.get("GO_API_CLIENT_ID")||""),
    sign:clean(Deno.env.get("GO_API_SIGN")||""),
    token:clean(Deno.env.get("GO_API_TOKEN")||""),
    store:clean(Deno.env.get("GO_STORE_ID")||"")
  };
  if(env.apiclientid&&env.sign&&env.token&&env.store)return env;
  if(GO_RUNTIME_CACHE)return GO_RUNTIME_CACHE;

  const {data,error}=await sb.rpc("getlink_go_runtime_config");
  if(error)throw new Error("go_runtime_config_error");
  const cfg=(data&&typeof data==="object")?data:{};
  const out={
    apiclientid:clean(cfg.apiclientid||""),
    sign:clean(cfg.sign||""),
    token:clean(cfg.token||""),
    store:clean(cfg.store||"")
  };
  if(!out.apiclientid||!out.sign||!out.token||!out.store){
    throw new Error("go_runtime_config_missing");
  }
  GO_RUNTIME_CACHE=out;
  return out;
}

async function goCategory(url:string,capture:RawCapture){
  const c=canonicalGo(url), category=goCategoryId(c);
  if(!category)throw new Error("go_category_id_missing");

  const cfg=await goRuntimeConfig();
  const endpoint="https://sieuthi-go.vn/api/order2_listProduct?platform=2&lang=vi";
  const store=Number(cfg.store)||cfg.store;
  const headers={
    "content-type":"application/json",
    "accept":"application/json, text/plain, */*",
    "origin":"https://sieuthi-go.vn",
    "referer":c,
    "language":"vi",
    "user-agent":"Mozilla/5.0",
    "apiclientid":cfg.apiclientid,
    "sign":cfg.sign,
    "token":cfg.token,
    "storeid":String(store)
  };
  const base:any={
    page:1,
    category,
    filter_brand:[],
    filter_subfamily:[],
    search:null,
    store,
    sitecode:store,
    platform:2,
    lang:"vi"
  };

  const fetchPage=async(page:number)=>{
    const payload={...base,page};
    const r=await fetch(endpoint,{
      method:"POST",
      headers,
      body:JSON.stringify(payload)
    });
    const b=await readCapturedJson(r,capture,endpoint,"POST");
    if(!r.ok||b?.status!=="success"||!Array.isArray(b?.products)){
      const message=clean(b?.message||"");
      if(r.status===403&&/token|signature|client/i.test(message)){
        GO_RUNTIME_CACHE=null;
        throw new Error("go_auth_refresh_required");
      }
      throw new Error("go_page_"+page+"_http_"+r.status);
    }
    return b;
  };

  const first=await fetchPage(1);
  const pages=Math.max(1,Number(first.pagination?.total_pages)||1);
  const byId=new Map<string,any>();

  const add=(items:any[])=>{
    for(const item of items||[]){
      const key=clean(item?.id||item?.barcode||item?.alias||"");
      if(key)byId.set(key,item);
    }
  };
  add(first.products);

  // GO currently returns 15 products/page. Keep a bounded parallel window so a
  // large category stays fast without hammering the source.
  for(let start=2;start<=pages;start+=10){
    const nums=Array.from({length:Math.min(10,pages-start+1)},(_,i)=>start+i);
    const bodies=await Promise.all(nums.map(fetchPage));
    for(const body of bodies)add(body.products||[]);
  }

  return {
    items:[...byId.values()],
    rootName:slugTitle(c),
    totalPages:pages,
    pageSize:Number(first.pagination?.page_size)||15,
    store:Number(first.metadata?.store)||store
  };
}
function goDetailValue(product:any, label:string){
  const re=new RegExp(label,"i");
  for(const item of product?.detail||[]){if(item&&re.test(clean(item.name)))return clean(item.value);}
  return"";
}
function normalizeGo(item:any, rootName:string, checked:string): Product | null {
  const rawName=clean(item?.name||item?.meta?.title||""); if(!rawName)return null;
  const name=rawName
    .replace(/\s+tại\s+Siêu\s+thị\s+GO!.*$/i,"")
    .replace(/\s*[-–]\s*\d{4,}\s*$/,"")
    .replace(/\s*[-–|]\s*GO!.*$/i,"")
    .trim();
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
  const capture=createRawCapture();

  if(key==="winmart"){
    if(kind!=="category")throw new Error("winmart_category_link_required");
    const raw=await winmartCategory(url,capture);

    // HARD GATE: source response text is appended before normalization.
    await persistRawCapture(requestId,url,"category",key,capture);

    const products=filterGetlinkProducts(raw.items.map((x:any)=>normalizeWinmart(x,raw.rootName,raw.store,checked)).filter(Boolean) as Product[]);
    return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"category",source:sourceObject(key),checked_at:checked,category_name:raw.rootName,products,variants:[],discovered_links:products.map(p=>p.url)},engine:"supabase-edge-winmart"};
  }
  if(key==="bachhoaxanh"){
    if(kind==="product"){
      const data=await bhxProductDetail(url,capture);

      // HARD GATE: source response text is appended before normalization.
      await persistRawCapture(requestId,url,"product",key,capture);

      const product=normalizeBhxDetail(data,url,checked);
      if(!keepGetlinkProduct(product))throw new Error("product_blocked_by_name_rule");
      return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"product",source:sourceObject(key),checked_at:checked,category_name:product.group,product,products:[product],variants:[],discovered_links:[product.url]},engine:"supabase-edge-bhx"};
    }
    const raw=await bhxCategoryRaw(url,capture);

    // HARD GATE: source response text is appended before normalization.
    await persistRawCapture(requestId,url,"category",key,capture);

    const root=clean(raw.rootName||raw.items[0]?.category?.name||slugTitle(url));
    const products=filterGetlinkProducts(raw.items.map((x:any)=>normalizeBhx(x,root,checked)).filter(Boolean) as Product[]);
    return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"category",source:sourceObject(key),checked_at:checked,category_name:root,category_id:raw.categoryId,products,variants:[],discovered_links:products.map(p=>p.url)},engine:"supabase-edge-bhx"};
  }
  if(key==="go"){
    if(kind!=="category")throw new Error("go_category_link_required");
    const raw=await goCategory(url,capture);

    // HARD GATE: source response text is appended before normalization.
    await persistRawCapture(requestId,url,"category",key,capture);

    const products=filterGetlinkProducts(raw.items.map((x:any)=>normalizeGo(x,raw.rootName,checked)).filter(Boolean) as Product[]);
    return {payload:{schema_version:20,request_id:requestId,input_url:url,input_type:"category",source:sourceObject(key),checked_at:checked,category_name:raw.rootName,products,variants:[],discovered_links:products.map(p=>p.url)},engine:"supabase-edge-go"};
  }
  throw new Error("unsupported_source");
}

async function must<T>(promise: PromiseLike<{data:T,error:any}>) {
  const {data,error}=await promise; if(error)throw error; return data;
}

let brandAliasCache=new Map<string,string>();
let brandAliasCacheAt=0;
const BRAND_ALIAS_CACHE_MS=5*60*1000;

function canonicalBrandFallback(value:unknown):string{
  const raw=clean(value).normalize("NFC");
  if(!raw)return "";
  const letters=raw.replace(/[^\p{L}]/gu,"");
  if(!letters)return raw;
  const isAllUpper=raw===raw.toLocaleUpperCase("vi-VN");
  const isAllLower=raw===raw.toLocaleLowerCase("vi-VN");
  if((isAllUpper||isAllLower)&&letters.length>4){
    return raw
      .toLocaleLowerCase("vi-VN")
      .replace(/(^|[\s\-\/&.])(\p{L})/gu,(_m,sep,ch)=>sep+String(ch).toLocaleUpperCase("vi-VN"));
  }
  return raw;
}

async function loadBrandAliases(force=false):Promise<Map<string,string>>{
  if(!force&&brandAliasCache.size&&Date.now()-brandAliasCacheAt<BRAND_ALIAS_CACHE_MS){
    return brandAliasCache;
  }
  const rows=await fetchAll("getlink_brand_aliases","brand_key,canonical_name");
  brandAliasCache=new Map(
    rows
      .map((r:any)=>[clean(r.brand_key),clean(r.canonical_name)] as [string,string])
      .filter(([key,name])=>Boolean(key&&name))
  );
  brandAliasCacheAt=Date.now();
  return brandAliasCache;
}

async function resolveCanonicalProductBrands(products:Product[]):Promise<void>{
  if(!products.length)return;
  const aliases=await loadBrandAliases();
  const variants=new Map<string,Map<string,number>>();

  const collect=(value:unknown)=>{
    const raw=clean(value);
    const key=groupBrandKey(raw);
    if(!raw||!key||aliases.has(key))return;
    if(!variants.has(key))variants.set(key,new Map());
    const counts=variants.get(key)!;
    counts.set(raw,(counts.get(raw)||0)+1);
  };

  for(const p of products){
    const si=p.source_identity||(p.source_identity={});
    collect(si.brand||p.branch);
    collect(si.bhx_brand_name);
  }

  const missing=[...variants.entries()].map(([brand_key,counts])=>{
    const best=[...counts.entries()]
      .sort((a,b)=>(b[1]-a[1])||a[0].localeCompare(b[0],"vi"))[0]?.[0]||brand_key;
    return {
      brand_key,
      canonical_name:canonicalBrandFallback(best),
      updated_at:new Date().toISOString()
    };
  });

  if(missing.length){
    const {error}=await sb
      .from("getlink_brand_aliases")
      .upsert(missing,{onConflict:"brand_key",ignoreDuplicates:true});
    if(error)throw error;
    const keys=missing.map(x=>x.brand_key);
    const {data,error:reloadError}=await sb
      .from("getlink_brand_aliases")
      .select("brand_key,canonical_name")
      .in("brand_key",keys);
    if(reloadError)throw reloadError;
    for(const row of data||[]){
      const key=clean(row.brand_key),name=clean(row.canonical_name);
      if(key&&name)aliases.set(key,name);
    }
    brandAliasCache=aliases;
    brandAliasCacheAt=Date.now();
  }

  const canonicalFor=(value:unknown)=>{
    const raw=clean(value);
    if(!raw)return "";
    const key=groupBrandKey(raw);
    return aliases.get(key)||canonicalBrandFallback(raw);
  };

  for(const p of products){
    const si=p.source_identity||(p.source_identity={});
    const rawMain=clean(si.raw_brand||si.brand||p.branch);
    if(rawMain&&!clean(si.raw_brand))si.raw_brand=rawMain;
    const rawCategory=clean(si.raw_category||si.category||p.group);
    if(rawCategory&&!clean(si.raw_category))si.raw_category=rawCategory;
    const canonicalMain=canonicalFor(rawMain);
    if(canonicalMain){
      p.branch=canonicalMain;
      si.brand=canonicalMain;
      if(Array.isArray(p.breadcrumbs)){
        p.breadcrumbs=p.breadcrumbs.map((x:any)=>
          rawMain&&groupBrandKey(x)===groupBrandKey(rawMain)?canonicalMain:x
        );
      }
    }
    const bhxCanonical=canonicalFor(si.bhx_brand_name);
    if(bhxCanonical)si.bhx_brand_name=bhxCanonical;
  }
}

async function persistPayload(payload:any, engine:string){
  const now=new Date().toISOString(), requestId=payload.request_id, input=payload.input_url, key=payload.source.key;
  const products:Product[]=filterGetlinkProducts(Array.isArray(payload.products)?payload.products:[]);
  if(key==="winmart"&&products.length)await mapIncomingWinmartGroups(products);

  // Brand canonicalization is a persistence gate:
  // GET/refresh must resolve aliases before any product row or identity is written.
  const brandProducts=[...products];
  if(payload.product&&!brandProducts.some((p:Product)=>canonical(p.url)===canonical(payload.product.url))){
    brandProducts.push(payload.product as Product);
  }
  await resolveCanonicalProductBrands(brandProducts);

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
    identities.push({link_url:p.url,source_name:sourceName(p.source.key),source_product_id:clean(si.source_product_id),source_code:clean(si.source_code),barcode:clean(si.barcode),sku:clean(si.sku),brand:clean(si.brand||p.branch),raw_brand:clean(si.raw_brand||si.brand||p.branch),category:clean(si.category||p.group),raw_category:clean(si.raw_category||si.category||p.group),bhx_group_name:clean(si.bhx_group_name),bhx_brand_name:clean(si.bhx_brand_name),bhx_match_url:clean(si.bhx_match_url),bhx_match_name:clean(si.bhx_match_name),raw_name:clean(si.raw_name||p.name),raw_description:clean(si.raw_description),size_value:cmp.size_value??null,size_unit:cmp.size_unit||"",pack_label_1:h.label1||"",pack_qty_1:Number(h.qty1)||0,pack_label_2:h.label2||"",pack_qty_2:Number(h.qty2)||0,pack_label_3:h.label3||"",pack_qty_3:Number(h.qty3)||0,match_name:clean(si.match_name),match_key:clean(si.match_key),match_basis:clean(si.match_basis),updated_at:now});
    snaps.push({link_id:id,request_id:requestId,checked_at:p.last_checked_at||payload.checked_at,current_price:p.price?.current||null,original_price:p.price?.original||null,promotion_price:p.promotion?.price||null,promotion_text:p.promotion?.text||"",result_json:p});
  }
  await must(sb.from("getlink_links").upsert(rows,{onConflict:"canonical_url"}));
  await syncManualGroupsForProductRows(rows);
  if(assets.length)await must(sb.from("getlink_link_assets").upsert(assets,{onConflict:"link_url"}));
  if(comps.length)await must(sb.from("getlink_link_comparison").upsert(comps,{onConflict:"link_url"}));
  if(hier.length)await must(sb.from("getlink_link_pack_hierarchy").upsert(hier,{onConflict:"link_url"}));
  if(identities.length){
    await must(sb.from("getlink_source_product_identity").upsert(identities,{onConflict:"link_url"}));
    sourceManagerCache=null;
    sourceManagerCacheAt=0;
  }
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
let sourceManagerCache:any=null;
let sourceManagerCacheAt=0;
const SOURCE_MANAGER_CACHE_MS=5*60*1000;

let manualGroupRuleCache:any[]= [];
let manualGroupRuleCacheAt=0;
const MANUAL_GROUP_RULE_CACHE_MS=5*60*1000;

async function loadManualGroupRules(force=false):Promise<any[]>{
  if(!force&&manualGroupRuleCache.length&&Date.now()-manualGroupRuleCacheAt<MANUAL_GROUP_RULE_CACHE_MS){
    return manualGroupRuleCache;
  }
  const [groups,rules]=await Promise.all([
    fetchAll(
      "getlink_manual_groups",
      "group_key,enabled,sort_order,is_fallback",
      (q:any)=>q.eq("enabled",true)
    ),
    fetchAll(
      "getlink_manual_group_rules",
      "group_key,rule_type,rule_value,rule_order,enabled",
      (q:any)=>q.eq("enabled",true).order("rule_order",{ascending:true})
    )
  ]);
  const groupRank=new Map(
    [...groups]
      .filter((x:any)=>!x.is_fallback)
      .sort((a:any,b:any)=>
        Number(a.sort_order||999999)-Number(b.sort_order||999999)||
        clean(a.group_key).localeCompare(clean(b.group_key))
      )
      .map((x:any,i:number)=>[clean(x.group_key),i])
  );
  manualGroupRuleCache=rules
    .filter((x:any)=>groupRank.has(clean(x.group_key)))
    .sort((a:any,b:any)=>
      Number(groupRank.get(clean(a.group_key))??999999)-Number(groupRank.get(clean(b.group_key))??999999)||
      Number(a.rule_order||0)-Number(b.rule_order||0)||
      clean(a.rule_value).localeCompare(clean(b.rule_value),"vi")
    );
  manualGroupRuleCacheAt=Date.now();
  return manualGroupRuleCache;
}
function manualGroupComparableName(name:unknown):string{
  let value=clean(name).normalize("NFC").toLocaleLowerCase("vi-VN");
  value=value.replace(/^[\s\-–—:;|·]+/u,"");

  // Source/product systems can prepend technical identifiers before the real
  // merchandise name. Strip only well-formed technical prefixes; RAW stays untouched.
  for(let i=0;i<4;i++){
    const before=value;

    // "Mã 123...", "Mã hàng ABC-123...", "SKU: 123...", "Code XYZ..."
    value=value.replace(
      /^(?:mã|ma|sku|msp|code|sp)\s*(?:(?:sản phẩm|hàng)\s*)?[:#._-]*\s*[a-z0-9][a-z0-9._\/-]{1,40}\s*(?:[-–—:;|·]\s*)?/iu,
      ""
    );

    // Bare long technical code, but never short product names such as "3 Miền".
    value=value.replace(
      /^(?:\d{6,}|[a-z]{1,4}\d{4,})\s*(?:[-–—:;|·]\s*)?/iu,
      ""
    );

    // "Thùng 24 lon Bia...", "Lô 10 gói Dầu gội...", "Lô 2 bánh..."
    value=value.replace(
      /^(?:thùng|lốc|lô|vỉ|vĩ|khay)\s+\d+(?:\s*(?:\+|x|×)\s*\d+)*(?:\s*(?:chai|lon|hộp|hũ|túi|gói|bịch|lọ|can|miếng|thanh|viên|cái|cây|bộ|đôi|tuýp|ly|tô|bình|lốc|vỉ|khay))?\s+/iu,
      ""
    );

    value=value.replace(/^[\s\-–—:;|·]+/u,"");
    if(value===before)break;
  }
  return clean(value);
}

function manualGroupMatches(name:unknown,rule:any):boolean{
  const value=clean(rule?.rule_value||"").normalize("NFC").toLocaleLowerCase("vi-VN");
  if(!value)return false;
  const raw=clean(name).normalize("NFC").toLocaleLowerCase("vi-VN");
  const hay=rule?.rule_type==="name_starts"?manualGroupComparableName(name):raw;

  if(rule?.rule_type==="name_starts")return hay.startsWith(value);
  if(rule?.rule_type==="name_contains")return hay.includes(value);
  if(rule?.rule_type==="name_contains_all"){
    const parts=value.split("|").map((x:string)=>clean(x)).filter(Boolean);
    return parts.length>0&&parts.every((x:string)=>hay.includes(x));
  }
  if(rule?.rule_type==="name_product_phrase"){
    return hay.startsWith(value)||(hay.startsWith("thùng ")&&hay.includes(value));
  }
  if(rule?.rule_type==="name_product_pack_phrase"){
    if(hay.startsWith(value))return true;
    const escaped=value.replace(/[.*+?^$\{\}()|[\]\\]/g,"\\$&");
    const re=new RegExp(
      "^(lốc|lô|vỉ|vĩ|thùng|khay)\\s+\\d+\\s+"+
      "(?:(?:chai|hộp|hũ|túi|gói|lốc)\\s+)?"+
      "(?:[^\\s]+\\s+)?"+
      escaped,
      "u"
    );
    return re.test(hay);
  }
  if(rule?.rule_type==="name_pack_contains"){
    return /^(lốc|lô|vỉ|vĩ|thùng|khay)\s+\d+/u.test(hay)&&hay.includes(value);
  }
  return false;
}
async function syncManualGroupsForProductRows(rows:any[]):Promise<void>{
  const productRows=rows.filter((r:any)=>r?.link_type==="product"&&r?.canonical_url);
  if(!productRows.length)return;
  const urls=[...new Set(productRows.map((r:any)=>clean(r.canonical_url)).filter(Boolean))];
  const [rules,existing]=await Promise.all([
    loadManualGroupRules(),
    fetchRowsByValues(
      "getlink_manual_group_members",
      "group_key,link_url,match_origin,matched_at",
      "link_url",
      urls
    )
  ]);

  // Manual groups are exclusive and sticky:
  // once a product has been classified, later groups must skip it.
  // "Chưa phân loại" is intentionally not sticky and is re-evaluated.
  const fallbackKey="chua-phan-loai";
  const assignedUrls=new Set(
    existing
      .filter((x:any)=>clean(x.group_key)!==fallbackKey)
      .map((x:any)=>clean(x.link_url))
      .filter(Boolean)
  );
  const fallbackUrls=existing
    .filter((x:any)=>clean(x.group_key)===fallbackKey)
    .map((x:any)=>clean(x.link_url))
    .filter(Boolean);

  if(fallbackUrls.length){
    const {error}=await sb
      .from("getlink_manual_group_members")
      .delete()
      .eq("group_key",fallbackKey)
      .in("link_url",fallbackUrls);
    if(error)throw error;
  }

  const now=new Date().toISOString();
  const members:any[]=[];
  for(const row of productRows){
    const linkUrl=clean(row.canonical_url);
    if(!linkUrl||assignedUrls.has(linkUrl))continue;

    let matched=false;
    for(const rule of rules){
      if(!manualGroupMatches(row.name,rule))continue;
      members.push({
        group_key:rule.group_key,
        link_url:linkUrl,
        match_origin:"rule",
        matched_at:now
      });
      matched=true;
      assignedUrls.add(linkUrl);
      break;
    }
    if(!matched){
      members.push({
        group_key:fallbackKey,
        link_url:linkUrl,
        match_origin:"fallback",
        matched_at:now
      });
    }
  }
  if(members.length){
    const {error}=await sb
      .from("getlink_manual_group_members")
      .insert(members);
    if(error)throw error;
  }
  sourceManagerCache=null;
  sourceManagerCacheAt=0;
}


function managerSourceKey(value:unknown):"bhx"|"wm"|"go"|""{
  const s=plain(value);
  if(s.includes("bach hoa xanh"))return "bhx";
  if(s.includes("winmart"))return "wm";
  if(/^go\b/.test(s)||s==="go!")return "go";
  return "";
}
function managerGroupDisplay(value:unknown):string{
  return clean(value).replace(/\s+[A-Z]\.\d+\s*$/iu,"").trim();
}
function managerGroupKey(value:unknown):string{
  return getlinkNameKey(managerGroupDisplay(value));
}
function sourceBucket(){
  return {bhx:0,wm:0,go:0};
}
function variantBucket(){
  return {bhx:new Set<string>(),wm:new Set<string>(),go:new Set<string>()};
}

async function fetchRowsByValues(table:string,select:string,column:string,values:string[]):Promise<any[]>{
  const out:any[]=[];
  const unique=[...new Set(values.filter(Boolean))];
  for(let i=0;i<unique.length;i+=40){
    const batch=unique.slice(i,i+40);
    const {data,error}=await sb.from(table).select(select).in(column,batch);
    if(error)throw error;
    out.push(...(data||[]));
  }
  return out;
}

async function sourceManagerManualGroupDetail(groupKey:string){
  const [{data:group,error:groupError},rules]=await Promise.all([
    sb
      .from("getlink_manual_groups")
      .select("group_key,name,rule_type,rule_value,enabled,sort_order,is_fallback")
      .eq("group_key",groupKey)
      .eq("enabled",true)
      .maybeSingle(),
    fetchAll(
      "getlink_manual_group_rules",
      "group_key,rule_type,rule_value,rule_order,enabled",
      (q:any)=>q.eq("group_key",groupKey).eq("enabled",true).order("rule_order",{ascending:true})
    )
  ]);
  if(groupError)throw groupError;
  if(!group)return null;

  const members=await fetchAll(
    "getlink_manual_group_members",
    "group_key,link_url,match_origin,matched_at",
    (q:any)=>q.eq("group_key",groupKey)
  );
  const urls=members.map((x:any)=>clean(x.link_url)).filter(Boolean);
  const [links,ids]=await Promise.all([
    fetchRowsByValues(
      "getlink_links",
      "canonical_url,source,name,branch_name,last_status",
      "canonical_url",
      urls
    ),
    fetchRowsByValues(
      "getlink_source_product_identity",
      "link_url,source_name,brand,raw_brand,category,raw_category",
      "link_url",
      urls
    )
  ]);

  const idByUrl=new Map(ids.map((x:any)=>[x.link_url,x]));
  const counts=sourceBucket();
  const items:any[]=[];
  for(const link of links){
    if(link.last_status==="unlisted")continue;
    const source=managerSourceKey(link.source);
    if(!source)continue;
    const id=idByUrl.get(link.canonical_url)||{};
    counts[source]++;
    items.push({
      url:link.canonical_url,
      name:clean(link.name),
      source,
      brand:clean(id.brand||link.branch_name),
      raw_brand:clean(id.raw_brand||id.brand||link.branch_name),
      raw_group:clean(id.raw_category||id.category),
      match_origin:"rule"
    });
  }
  items.sort((a,b)=>{
    const rank=(x:string)=>x==="bhx"?0:(x==="wm"?1:2);
    return (rank(a.source)-rank(b.source))||a.name.localeCompare(b.name,"vi");
  });
  return {
    group:{
      key:group.group_key,
      name:clean(group.name),
      rule_type:clean(group.rule_type),
      rule_value:clean(group.rule_value),
      rules:rules.map((r:any)=>({
        rule_type:clean(r.rule_type),
        rule_value:clean(r.rule_value)
      })),
      rule_label:group.is_fallback
        ?"Chưa khớp nhóm cơ bản"
        :"OR · "+rules.map((r:any)=>clean(r.rule_value)).filter(Boolean).join(" · ")
    },
    products:{...counts,all:counts.bhx+counts.wm+counts.go},
    items
  };
}

async function sourceManagerSnapshot(force=false){
  if(!force&&sourceManagerCache&&Date.now()-sourceManagerCacheAt<SOURCE_MANAGER_CACHE_MS){
    return sourceManagerCache;
  }
  const [ids,links,aliases,manualGroups,manualMembers,manualRules]=await Promise.all([
    fetchAll("getlink_source_product_identity","link_url,source_name,brand,raw_brand,category,raw_category,bhx_group_name"),
    fetchAll("getlink_links","canonical_url,last_status,source,name",(q:any)=>q.eq("link_type","product")),
    loadBrandAliases(),
    fetchAll(
      "getlink_manual_groups",
      "group_key,name,rule_type,rule_value,enabled,sort_order,is_fallback",
      (q:any)=>q.eq("enabled",true)
    ),
    fetchAll("getlink_manual_group_members","group_key,link_url,match_origin,matched_at"),
    fetchAll(
      "getlink_manual_group_rules",
      "group_key,rule_type,rule_value,rule_order,enabled",
      (q:any)=>q.eq("enabled",true).order("rule_order",{ascending:true})
    )
  ]);
  const activeRows=links.filter((x:any)=>x.last_status!=="unlisted");
  const activeLinks=new Set(activeRows.map((x:any)=>x.canonical_url));
  const activeLinkByUrl=new Map(activeRows.map((x:any)=>[x.canonical_url,x]));
  const brandMap=new Map<string,any>();
  const groupMap=new Map<string,any>();
  const products=sourceBucket();

  for(const i of ids){
    if(!activeLinks.has(i.link_url))continue;
    const source=managerSourceKey(i.source_name);
    if(!source)continue;
    products[source]++;

    const rawBrand=clean(i.raw_brand||i.brand);
    const brandKey=groupBrandKey(i.brand||rawBrand);
    const canonicalBrand=aliases.get(brandKey)||canonicalBrandFallback(i.brand||rawBrand);
    if(brandKey&&canonicalBrand){
      if(!brandMap.has(brandKey)){
        brandMap.set(brandKey,{
          key:brandKey,name:canonicalBrand,total:0,
          sources:sourceBucket(),variants:variantBucket()
        });
      }
      const row=brandMap.get(brandKey);
      row.total++; row.sources[source]++;
      if(rawBrand)row.variants[source].add(rawBrand);
    }

    const rawGroup=clean(i.raw_category||i.category);
    const canonicalGroup=managerGroupDisplay(i.bhx_group_name||i.category||rawGroup);
    const groupKey=managerGroupKey(canonicalGroup||rawGroup);
    if(groupKey){
      if(!groupMap.has(groupKey)){
        groupMap.set(groupKey,{
          key:groupKey,name:canonicalGroup||rawGroup,total:0,
          sources:sourceBucket(),variants:variantBucket()
        });
      }
      const row=groupMap.get(groupKey);
      row.total++; row.sources[source]++;
      if(rawGroup)row.variants[source].add(rawGroup);
    }
  }


  const rulesByGroup=new Map<string,any[]>();
  for(const rule of manualRules){
    const key=clean(rule.group_key);
    if(!rulesByGroup.has(key))rulesByGroup.set(key,[]);
    rulesByGroup.get(key)!.push(rule);
  }

  const manualMap=new Map<string,any>();
  for(const group of manualGroups){
    const rules=rulesByGroup.get(clean(group.group_key))||[];
    manualMap.set(group.group_key,{
      key:group.group_key,
      name:clean(group.name),
      rule_type:clean(group.rule_type),
      rule_value:clean(group.rule_value),
      rules:rules.map((r:any)=>({
        rule_type:clean(r.rule_type),
        rule_value:clean(r.rule_value)
      })),
      sort_order:Number(group.sort_order||999999),
      is_fallback:Boolean(group.is_fallback),
      rule_label:group.is_fallback
        ?"Chưa khớp nhóm cơ bản"
        :"OR · "+rules.map((r:any)=>clean(r.rule_value)).filter(Boolean).join(" · "),
      total:0,
      sources:sourceBucket(),
      variants:{bhx:[],wm:[],go:[]}
    });
  }
  for(const member of manualMembers){
    const row=manualMap.get(member.group_key);
    const link=activeLinkByUrl.get(member.link_url);
    if(!row||!link)continue;
    const source=managerSourceKey(link.source);
    if(!source)continue;
    row.total++;
    row.sources[source]++;
  }

  const finalize=(map:Map<string,any>)=>[...map.values()]
    .map(row=>({
      ...row,
      variants:{
        bhx:[...row.variants.bhx].sort((a,b)=>a.localeCompare(b,"vi")),
        wm:[...row.variants.wm].sort((a,b)=>a.localeCompare(b,"vi")),
        go:[...row.variants.go].sort((a,b)=>a.localeCompare(b,"vi"))
      }
    }))
    .sort((a,b)=>(b.total-a.total)||a.name.localeCompare(b.name,"vi"));

  sourceManagerCache={
    generated_at:new Date().toISOString(),
    products:{...products,all:products.bhx+products.wm+products.go},
    brands:finalize(brandMap),
    groups:finalize(groupMap),
    manual_groups:[...manualMap.values()]
      .filter((x:any)=>x.total>0)
      .sort((a:any,b:any)=>
        Number(a.sort_order||999999)-Number(b.sort_order||999999)||
        a.name.localeCompare(b.name,"vi")
      )
  };
  sourceManagerCacheAt=Date.now();
  return sourceManagerCache;
}

async function libraryRows(includeHidden=true){
  const [links,prefs,assets,comps,hier,ids,manualMembers,manualGroups]=await Promise.all([
    fetchAll("getlink_links","*",(q:any)=>q.eq("link_type","product").neq("last_status","unlisted").order("name",{ascending:true})),
    fetchAll("getlink_link_preferences"),
    fetchAll("getlink_link_assets"),
    fetchAll("getlink_link_comparison"),
    fetchAll("getlink_link_pack_hierarchy"),
    fetchAll("getlink_source_product_identity"),
    fetchAll("getlink_manual_group_members","group_key,link_url,match_origin"),
    fetchAll(
      "getlink_manual_groups",
      "group_key,name,sort_order,is_fallback,enabled",
      (q:any)=>q.eq("enabled",true)
    )
  ]);
  const pref=new Map(prefs.map((x:any)=>[x.link_url,x])), asset=new Map(assets.map((x:any)=>[x.link_url,x])),
    cmp=new Map(comps.map((x:any)=>[x.link_url,x])), hm=new Map(hier.map((x:any)=>[x.link_url,x])), im=new Map(ids.map((x:any)=>[x.link_url,x])),
    manualMemberByUrl=new Map(manualMembers.map((x:any)=>[x.link_url,x])),
    manualGroupByKey=new Map(manualGroups.map((x:any)=>[x.group_key,x]));
  const categories=await fetchAll("getlink_links","canonical_url,name,source,last_request_id",(q:any)=>q.eq("link_type","category"));
  const rootByReq=new Map(categories.filter((x:any)=>String(x.source).includes("WinMart")).map((x:any)=>[x.last_request_id,x.name]));
  const rows:any[]=[];
  for(const l of links){
    if(!l.name || (!l.current_price&&!l.promotion_price))continue;
    const p=pref.get(l.canonical_url)||{}, a=asset.get(l.canonical_url)||{}, c=cmp.get(l.canonical_url)||{}, h=hm.get(l.canonical_url)||{}, id=im.get(l.canonical_url)||{};
    const manualMember=manualMemberByUrl.get(l.canonical_url)||{};
    const manualGroup=manualGroupByKey.get(manualMember.group_key)||{};
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
      manual_group_key:clean(manualGroup.group_key||manualMember.group_key||""),
      manual_group_name:clean(manualGroup.name||""),
      manual_group_sort_order:Number(manualGroup.sort_order||999999),
      manual_group_fallback:manualGroup.is_fallback?1:0,
      source_raw_name:id.raw_name||l.name,source_raw_description:id.raw_description||"",match_key:id.match_key||"",match_basis:id.match_basis||"",
      source_category_name:id.category||"",bhx_group_name:id.bhx_group_name||"",bhx_brand_name:id.bhx_brand_name||"",bhx_match_url:id.bhx_match_url||"",bhx_match_name:id.bhx_match_name||"",source_root_name:isW?(rootByReq.get(l.last_request_id)||l.group_name):"",
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

const STALE_JOB_MS=10*60*1000;
async function expireStaleJobs():Promise<number>{
  const cutoff=new Date(Date.now()-STALE_JOB_MS).toISOString();
  const now=new Date().toISOString();
  const {data,error}=await sb
    .from("getlink_jobs")
    .update({status:"error",error:"stale_running_timeout",updated_at:now})
    .eq("status","running")
    .lt("updated_at",cutoff)
    .select("request_id");
  if(error){
    console.warn("getlink_stale_job_cleanup_failed",String(error.message||error));
    return 0;
  }
  return Array.isArray(data)?data.length:0;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  if(!authorized(req))return response(req,{error:"unauthorized"},401);
  const url=new URL(req.url), route=routePath(req);
  try{
    let staleJobsCleaned=0;
    if(route==="/health"||route==="/api/get-price"||route==="/api/result"){
      staleJobsCleaned=await expireStaleJobs();
    }
    if(req.method==="GET"&&route==="/health"){
      const {count,error}=await sb.from("getlink_links").select("*",{count:"exact",head:true}); if(error)throw error;
      return response(req,{ok:true,mode:"supabase-only",links:Number(count||0),stale_jobs_cleaned:staleJobsCleaned});
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
            if(cached?.source?.key==="winmart"&&Array.isArray(cached.products)){
              await mapIncomingWinmartGroups(cached.products);
              if(cached.product){
                const one=[cached.product] as Product[];
                await mapIncomingWinmartGroups(one);
                cached.product=one[0];
              }
            }
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
        const detail=errorText(e).slice(0,1200);
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
      if(view==="manual-group"){
        const groupKey=clean(url.searchParams.get("group")||"");
        if(!groupKey)return response(req,{error:"missing_group"},400);
        const detail=await sourceManagerManualGroupDetail(groupKey);
        if(!detail)return response(req,{error:"group_not_found"},404);
        return response(req,detail);
      }
      if(view==="source-manager"){
        return response(req,await sourceManagerSnapshot(false));
      }
      if(view==="search"||view==="products"){
        const limit=Math.min(10000,Math.max(1,Number(url.searchParams.get("limit")||500)));
        let rows=await libraryRows(url.searchParams.get("include_hidden")==="1");
        if(view==="products"&&url.searchParams.get("parent")){
          const parent=canonical(clean(url.searchParams.get("parent"))); rows=rows.filter((x:any)=>x.parent_url===parent);
        }
        return response(req,{products:rows.slice(0,limit)});
      }
      if(view==="classification-version"){
        const [{data:maxRow,error:maxError},{count,error:countError}]=await Promise.all([
          sb.from("getlink_manual_group_members")
            .select("matched_at")
            .order("matched_at",{ascending:false})
            .limit(1)
            .maybeSingle(),
          sb.from("getlink_manual_group_members")
            .select("*",{count:"exact",head:true})
        ]);
        if(maxError)throw maxError;
        if(countError)throw countError;
        return response(req,{
          version:maxRow?.matched_at||"",
          member_count:Number(count||0)
        });
      }
      if(view==="groups"){
        const rows=await libraryRows(false); const map=new Map<string,any>();
        for(const r of rows){
          const key=clean(r.manual_group_key);
          const name=clean(r.manual_group_name);
          if(!key||!name)continue;
          const x=map.get(key)||{
            key,
            name,
            product_count:0,
            sort_order:Number(r.manual_group_sort_order||999999),
            is_fallback:Boolean(r.manual_group_fallback)
          };
          x.product_count++;
          map.set(key,x);
        }
        return response(req,{
          groups:[...map.values()].sort((a,b)=>
            Number(a.sort_order||999999)-Number(b.sort_order||999999)||
            a.name.localeCompare(b.name,"vi")
          )
        });
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

    if(req.method==="POST"&&route==="/api/preference"){
      const body=await req.json(); const link=canonical(clean(body?.url)); const state=["normal","watch","hidden"].includes(body?.state)?body.state:"normal"; const now=new Date().toISOString();
      const row={link_url:link,state,auto_refresh:state==="watch",refresh_hours:Math.max(1,Number(body?.refresh_hours)||24),pinned:false,updated_at:now};
      await must(sb.from("getlink_link_preferences").upsert(row,{onConflict:"link_url"}));
      return response(req,{preference:row});
    }
    return response(req,{error:"not_found"},404);
  }catch(e){
    return response(req,{error:"server_error",detail:errorText(e).slice(0,1500)},500);
  }
});
