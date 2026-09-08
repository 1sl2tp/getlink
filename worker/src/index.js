const OWNER="1sl2tp";
const REPO="getlink";
const WORKFLOW_GO="scrape-go.yml";

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

function canonicalWinmart(raw){
  const u=new URL(String(raw||""));
  const host=u.hostname.toLowerCase();
  if(host!=="winmart.vn"&&host!=="www.winmart.vn"){
    throw new Error("invalid_winmart_url");
  }
  const path=(u.pathname||"/").replace(/\/+/g,"/").replace(/\/+$/,"")||"/";
  const out=new URL("https://winmart.vn"+path);
  const store=String(u.searchParams.get("storeCode")||"").trim();
  const cate2=String(u.searchParams.get("cate2")||"").trim();
  if(store)out.searchParams.set("storeCode",store);
  if(cate2)out.searchParams.set("cate2",cate2);
  return out.toString().replace(/\?$/,"");
}

function canonicalGo(raw){
  const u=new URL(String(raw||""));
  const host=u.hostname.toLowerCase();
  if(host!=="sieuthi-go.vn"&&host!=="www.sieuthi-go.vn"){
    throw new Error("invalid_go_url");
  }
  const path=(u.pathname||"/").replace(/\/+/g,"/").replace(/\/+$/,"")||"/";
  return "https://sieuthi-go.vn"+path;
}

function sourceKeyForUrl(raw){
  const host=new URL(String(raw||"")).hostname.toLowerCase();
  if(host==="bachhoaxanh.com"||host==="www.bachhoaxanh.com")return "bachhoaxanh";
  if(host==="winmart.vn"||host==="www.winmart.vn")return "winmart";
  if(host==="sieuthi-go.vn"||host==="www.sieuthi-go.vn")return "go";
  throw new Error("unsupported_source_url");
}

function sourceNameForKey(key){
  if(key==="winmart")return "WinMart";
  if(key==="go")return "GO!";
  return "Bách Hóa XANH";
}

function canonicalSource(raw){
  const key=sourceKeyForUrl(raw);
  if(key==="winmart")return canonicalWinmart(raw);
  if(key==="go")return canonicalGo(raw);
  return canonicalBhx(raw);
}

function browserSourceUrl(raw){
  const key=sourceKeyForUrl(raw);
  if(key==="winmart")return canonicalWinmart(raw);
  if(key==="go")return canonicalGo(raw);
  return browserBhxUrl(raw);
}

function pathParts(url){
  return new URL(url).pathname.split("/").filter(Boolean);
}

function heuristicType(url){
  let source="bachhoaxanh";
  try{source=sourceKeyForUrl(url);}catch{}
  if(source==="winmart"){
    const u=new URL(url);
    const last=pathParts(url).slice(-1)[0]||"";
    return /--c\d+$/i.test(last)||u.searchParams.has("cate2")
      ?"category"
      :"product";
  }
  if(source==="go"){
    const path=new URL(url).pathname.toLowerCase();
    if(path.includes("/categories/"))return "category";
    if(path.includes("/product/"))return "product";
    return "category";
  }
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

function normalizePackWord(value){
  const raw=cleanText(value||"");
  const key=raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const map={
    thung:"Thùng",loc:"Lốc",tui:"Túi",bich:"Bịch",chai:"Chai",
    hop:"Hộp",goi:"Gói",can:"Can",combo:"Combo",bo:"Bộ",vi:"Vỉ",
    lon:"Lon",hu:"Hũ",ly:"Ly",to:"Tô",khoanh:"Khoanh",thanh:"Thanh",cay:"Cây",vien:"Viên",tuyp:"Tuýp"
  };
  return map[key]||raw;
}

function getlinkPlain(value){
  return cleanText(value||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/đ/gi,"d")
    .toLowerCase();
}

function sourceMatchName(value,brand){
  // Remove only packaging quantities and physical size. Standalone numbers
  // may be part of the product identity (e.g. "60 độ đạm", "3 Miền").
  const packUnits="thung|loc|hop|chai|goi|bich|tui|lon|hu|ly|to|can|vi|cay|vien|tuyp";
  let text=getlinkPlain(value||"")
    .replace(/(\d+(?:[.,]\d+)?)\s*(ml|lit|lít|l|kg|g)\b/g," ")
    .replace(new RegExp("\\b(?:thung|loc)\\s+[0-9]+(?:[.,][0-9]+)?\\s*(?:"+packUnits+")\\b","g")," ")
    .replace(new RegExp("\\b[0-9]+(?:[.,][0-9]+)?\\s*(?:"+packUnits+")\\b","g")," ")
    .replace(/[^a-z0-9]+/g," ")
    .trim();

  const stop=new Set([
    "thung","loc","hop","chai","goi","bich","tui","lon","hu","ly",
    "to","can","vi","cay","vien","tuyp"
  ]);
  const brandTokens=new Set(
    getlinkPlain(brand||"").split(/\s+/).filter(Boolean)
  );
  const tokens=text.split(/\s+/)
    .filter(token=>token&&token.length>1&&!stop.has(token)&&!brandTokens.has(token));
  return [...new Set(tokens)].sort().join(" ");
}

function normalizedBarcode(value){
  const raw=cleanText(value||"");
  const digits=raw.replace(/\D/g,"");
  return digits.length>=8?digits:"";
}

function sourceIdentityStatement(env,data,updatedAt){
  const rawName=cleanText(data&&data.raw_name||data&&data.name||"");
  const description=cleanText(data&&data.raw_description||"");
  const brand=cleanText(data&&data.brand||"");
  const category=cleanText(data&&data.category||"");
  const barcode=normalizedBarcode(data&&data.barcode);
  const size=(data&&data.size&&data.size.value)
    ?data.size
    :parseSize([rawName,description].filter(Boolean).join(" "));
  const matchName=sourceMatchName(rawName,brand);
  const brandKey=getlinkPlain(brand).replace(/[^a-z0-9]+/g," ").trim();
  let matchKey="";
  let matchBasis="";
  if(barcode){
    matchKey="barcode:"+barcode;
    matchBasis="barcode";
  }else if(brandKey&&size.value&&size.unit&&matchName){
    matchKey=[
      "fingerprint",
      brandKey,
      String(size.value)+String(size.unit),
      matchName
    ].join(":");
    matchBasis="brand_size_name";
  }

  const h=data&&data.hierarchy||{};
  return env.DB.prepare(
    "INSERT INTO source_product_identity("+
    "link_url,source_name,source_product_id,source_code,barcode,sku,brand,category,"+
    "raw_name,raw_description,size_value,size_unit,"+
    "pack_label_1,pack_qty_1,pack_label_2,pack_qty_2,pack_label_3,pack_qty_3,"+
    "match_name,match_key,match_basis,updated_at"+
    ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "+
    "ON CONFLICT(link_url) DO UPDATE SET "+
    "source_name=excluded.source_name,source_product_id=excluded.source_product_id,"+
    "source_code=excluded.source_code,barcode=excluded.barcode,sku=excluded.sku,"+
    "brand=excluded.brand,category=excluded.category,raw_name=excluded.raw_name,"+
    "raw_description=excluded.raw_description,size_value=excluded.size_value,"+
    "size_unit=excluded.size_unit,pack_label_1=excluded.pack_label_1,"+
    "pack_qty_1=excluded.pack_qty_1,pack_label_2=excluded.pack_label_2,"+
    "pack_qty_2=excluded.pack_qty_2,pack_label_3=excluded.pack_label_3,"+
    "pack_qty_3=excluded.pack_qty_3,match_name=excluded.match_name,"+
    "match_key=excluded.match_key,match_basis=excluded.match_basis,updated_at=excluded.updated_at"
  ).bind(
    String(data&&data.link_url||""),
    cleanText(data&&data.source_name||""),
    cleanText(data&&data.source_product_id||""),
    cleanText(data&&data.source_code||""),
    barcode,
    cleanText(data&&data.sku||""),
    brand,
    category,
    rawName,
    description,
    size.value??null,
    size.unit||"",
    h.label1||"",Number(h.qty1)||0,
    h.label2||"",Number(h.qty2)||0,
    h.label3||"",Number(h.qty3)||0,
    matchName,matchKey,matchBasis,
    updatedAt||new Date().toISOString()
  );
}

function getlinkUrlIsCarton(value){
  try{
    const parts=pathParts(canonicalBhx(value));
    const slug=String(parts[parts.length-1]||"").toLowerCase();
    return /^thung(?:-|$)/.test(slug)||/-thung$/.test(slug);
  }catch{
    return false;
  }
}

function getlinkCartonEvidence(name,url,packagingText){
  const namePlain=getlinkPlain(name||"");
  const packagingPlain=getlinkPlain(packagingText||"");

  // ONE OWNER for Nhãn 1 = Thùng.
  // Evidence priority belongs to this exact product only:
  // 1) own product name, 2) own packaging/price option, 3) own detail URL.
  if(/^thung\b/.test(namePlain)){
    return {is_carton:true,source:"name"};
  }
  if(/^thung\b/.test(packagingPlain)){
    return {is_carton:true,source:"packaging"};
  }
  if(getlinkUrlIsCarton(url)){
    return {is_carton:true,source:"url"};
  }
  return {is_carton:false,source:""};
}

function getlinkProductIdentity(name,url,packagingText){
  const sourceName=cleanText(name||"");
  const sourcePackaging=cleanText(packagingText||"");
  const namePlain=getlinkPlain(sourceName);
  const packagingPlain=getlinkPlain(sourcePackaging);

  const cartonEvidence=getlinkCartonEvidence(
    sourceName,url,sourcePackaging
  );
  const authoritativeCarton=cartonEvidence.is_carton;

  // Temporary audit exclusions are enforced BEFORE persistence.
  if(/^combo\b/.test(namePlain)){
    return {keep:false,reason:"combo",authoritativeCarton:false,name:sourceName,packaging:sourcePackaging};
  }
  if(/^[0-9]+(?:[.,][0-9]+)?\s+thung\b/.test(namePlain)){
    return {keep:false,reason:"multi_carton",authoritativeCarton:false,name:sourceName,packaging:sourcePackaging};
  }
  const mixedUnits="thung|loc|tui|bich|chai|hop|goi|can|lon|hu|ly|to|khoanh|thanh|cay|vien|tuyp";
  if(new RegExp("\\bva\\s+[0-9]+(?:[.,][0-9]+)?\\s+("+mixedUnits+")\\b").test(namePlain)){
    return {keep:false,reason:"mixed_bundle",authoritativeCarton:false,name:sourceName,packaging:sourcePackaging};
  }
  if(/^[0-9]+(?:[.,][0-9]+)?\b/.test(namePlain)&&!authoritativeCarton){
    return {keep:false,reason:"numeric_prefix",authoritativeCarton:false,name:sourceName,packaging:sourcePackaging};
  }

  let normalizedName=sourceName;
  let normalizedPackaging=sourcePackaging;

  // If BHX category API shortens a true carton title to "24 lon ...",
  // restore the explicit carton marker from this link's own URL.
  if(authoritativeCarton&&/^[0-9]+(?:[.,][0-9]+)?\b/.test(namePlain)){
    normalizedName=cleanText("Thùng "+sourceName);
  }

  // Feed the same carton evidence into the pack parser so D1 stores
  // pack_kind=Thùng immediately at GETLINK time, not later in the UI.
  if(authoritativeCarton&&!/^thung\b/.test(packagingPlain)){
    const lead=namePlain.match(
      /^([0-9]+(?:[.,][0-9]+)?)\s+(hop|chai|goi|bich|tui|lon|hu|ly|to|loc|khoanh|thanh|cay|vien|tuyp|can)\b/
    );
    normalizedPackaging=lead
      ?cleanText("Thùng "+lead[1]+" "+normalizePackWord(lead[2]))
      :cleanText(["Thùng",sourcePackaging].filter(Boolean).join(" "));
  }

  return {
    keep:true,
    reason:"",
    authoritativeCarton,
    cartonEvidence:cartonEvidence.source,
    name:normalizedName,
    packaging:normalizedPackaging
  };
}

function rawPackUnit(value){
  const raw=cleanText(value||"").toLowerCase();
  const pattern="hộp|chai|gói|bịch|túi|lon|hũ|ly|tô|lốc|vỉ|khoanh|thanh|cây|viên|tuýp|can";
  const re=new RegExp(
    "(?:^|[^\\p{L}\\p{N}])("+pattern+")(?=$|[^\\p{L}\\p{N}])",
    "giu"
  );
  let match;
  let last="";
  while((match=re.exec(raw))){
    last=match[1]||last;
  }
  return last?normalizePackWord(last):"";
}

function packHierarchyData(name,url,packagingText,rawCount,rawUnit){
  const identity=getlinkProductIdentity(name,url,packagingText);
  if(!identity.keep){
    return {
      keep:false,reason:identity.reason,
      label1:"",qty1:0,label2:"",qty2:0,label3:"",qty3:0,
      evidence:"",locked:false
    };
  }

  const units="hop|chai|goi|bich|tui|lon|hu|ly|to|loc|khoanh|thanh|cay|vien|tuyp|can";
  const namePlain=getlinkPlain(identity.name);
  const packagingPlain=getlinkPlain(identity.packaging);

  function validQty(value){
    const n=Number(String(value||"").replace(",","."));
    return Number.isFinite(n)&&n>0&&n<=300?n:0;
  }

  function directChain(text){
    const chain=String(text||"").match(
      new RegExp("^([0-9]+(?:[.,][0-9]+)?)\\s*("+units+")\\b(?:\\s+([0-9]+(?:[.,][0-9]+)?)\\s*("+units+")\\b)?")
    );
    if(!chain)return null;
    return {
      qtyA:validQty(chain[1]),
      unitA:normalizePackWord(chain[2]),
      qtyB:validQty(chain[3]),
      unitB:chain[4]?normalizePackWord(chain[4]):""
    };
  }

  function bonusChain(text){
    const match=String(text||"").match(
      new RegExp("^([0-9]+(?:[.,][0-9]+)?)\\s*\\+\\s*([0-9]+(?:[.,][0-9]+)?)\\s*("+units+")\\b")
    );
    if(!match)return null;
    const a=validQty(match[1]);
    const b=validQty(match[2]);
    return a&&b
      ?{qty:a+b,unit:normalizePackWord(match[3])}
      :null;
  }

  function middleChain(text){
    const match=String(text||"").match(
      new RegExp("^(loc|bich|tui|hop|goi|can|hu|ly|to)\\s+([0-9]+(?:[.,][0-9]+)?)\\s*("+units+")\\b")
    );
    if(!match)return null;
    const qty=validQty(match[2]);
    if(!qty)return null;
    return {
      outer:normalizePackWord(match[1]),
      child:normalizePackWord(match[3]),
      qty
    };
  }

  if(identity.authoritativeCarton){
    const structural=/^thung\b/.test(namePlain)
      ?namePlain.replace(/^thung\s*/,"")
      :(/^thung\b/.test(packagingPlain)
        ?packagingPlain.replace(/^thung\s*/,"")
        :"");

    const bonus=bonusChain(structural);
    if(bonus){
      return {
        keep:true,reason:"",
        label1:"Thùng",qty1:1,
        label2:"",qty2:0,
        label3:bonus.unit,qty3:bonus.qty,
        evidence:identity.cartonEvidence||"",
        locked:true
      };
    }

    const chain=directChain(structural);
    if(chain&&chain.qtyA&&chain.unitA){
      if(chain.qtyB&&chain.unitB){
        return {
          keep:true,reason:"",
          label1:"Thùng",qty1:1,
          label2:chain.unitA,qty2:chain.qtyA,
          label3:chain.unitB,qty3:chain.qtyB,
          evidence:identity.cartonEvidence||"",
          locked:true
        };
      }

      // A direct "Thùng 24 lon/hộp/gói..." has no middle pack.
      // Lốc is kept as middle if BHX does not expose its inner unit yet.
      if(chain.unitA==="Lốc"){
        return {
          keep:true,reason:"",
          label1:"Thùng",qty1:1,
          label2:"Lốc",qty2:chain.qtyA,
          label3:"",qty3:0,
          evidence:identity.cartonEvidence||"",
          locked:true
        };
      }
      return {
        keep:true,reason:"",
        label1:"Thùng",qty1:1,
        label2:"",qty2:0,
        label3:chain.unitA,qty3:chain.qtyA,
        evidence:identity.cartonEvidence||"",
        locked:true
      };
    }

    const fallbackQty=validQty(rawCount);
    const fallbackUnit=normalizePackWord(rawUnit||"");
    if(fallbackQty&&fallbackUnit&&fallbackUnit!=="Thùng"){
      return {
        keep:true,reason:"",
        label1:"Thùng",qty1:1,
        label2:fallbackUnit==="Lốc"?"Lốc":"",
        qty2:fallbackUnit==="Lốc"?fallbackQty:0,
        label3:fallbackUnit==="Lốc"?"":fallbackUnit,
        qty3:fallbackUnit==="Lốc"?0:fallbackQty,
        evidence:identity.cartonEvidence||"",
        locked:true
      };
    }

    return {
      keep:true,reason:"",
      label1:"Thùng",qty1:1,
      label2:"",qty2:0,label3:"",qty3:0,
      evidence:identity.cartonEvidence||"",
      locked:false
    };
  }

  // Non-carton: only a complete "bao ngoài + số lượng + đơn vị con"
  // is allowed to become the middle level. Arbitrary numbers in the
  // product/brand name never become QC.
  const middleByName=middleChain(namePlain);
  const middleByPackaging=middleByName?null:middleChain(packagingPlain);
  const middle=middleByName||middleByPackaging;
  if(middle){
    return {
      keep:true,reason:"",
      label1:"",qty1:0,
      label2:middle.outer,qty2:1,
      label3:middle.child,qty3:middle.qty,
      evidence:middleByName?"name_middle":"packaging_middle",
      locked:true
    };
  }

  // Default supermarket case: one final retail unit (leaf).
  // Accent-sensitive detection protects words such as "lớn" from
  // accidentally becoming the unit "Lon"; brand numbers are ignored.
  let leaf=rawPackUnit(identity.name);
  let evidence=leaf?"name_leaf":"";
  if(!leaf){
    leaf=rawPackUnit(identity.packaging);
    if(leaf)evidence="packaging_leaf";
  }
  if(!leaf){
    const fallback=normalizePackWord(rawUnit||"");
    const leafKinds=new Set([
      "Hộp","Chai","Gói","Bịch","Túi","Lon","Hũ","Ly","Tô",
      "Khoanh","Thanh","Cây","Viên","Tuýp","Can"
    ]);
    if(leafKinds.has(fallback)){
      leaf=fallback;
      evidence="api_leaf";
    }
  }

  return {
    keep:true,reason:"",
    label1:"",qty1:0,
    label2:"",qty2:0,
    label3:leaf,qty3:leaf?1:0,
    evidence,
    locked:Boolean(leaf)
  };
}

function hierarchyPackCompatibility(hierarchy){
  const h=hierarchy||{};
  if(h.label1==="Thùng"){
    const directLabel=h.label2||h.label3||"đơn vị";
    const directQty=Math.max(1,Number(h.label2?h.qty2:h.qty3)||1);
    return {pack_kind:"Thùng",pack_quantity:directQty,pack_unit:directLabel};
  }
  if(h.label2){
    return {
      pack_kind:h.label2,
      pack_quantity:Math.max(1,Number(h.qty3)||1),
      pack_unit:h.label3||"đơn vị"
    };
  }
  if(h.label3){
    return {pack_kind:h.label3,pack_quantity:1,pack_unit:h.label3};
  }
  return {pack_kind:"Đơn",pack_quantity:1,pack_unit:"đơn vị"};
}

// Compatibility surface only. All recognition lives in packHierarchyData().
function parsePackStructure(name,packagingText,featureText,rawCount,rawUnit,url=""){
  const hierarchy=packHierarchyData(
    name,url||"",packagingText,rawCount,rawUnit
  );
  const pack=hierarchyPackCompatibility(hierarchy);
  const size=parseSize([name,packagingText,featureText].filter(Boolean).join(" "));
  return {
    ...pack,
    size_value:size.value,
    size_unit:size.unit
  };
}

function quantityPromotionForPack(text,pack,currentPackPrice){
  const original=cleanText(text||"");
  const plain=original.normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/đ/gi,"d")
    .toLowerCase();

  const unitPattern="thung|loc|tui|bich|chai|hop|goi|can|combo|bo|lon|hu|ly|to|khoanh|thanh|cay|vien|tuyp";
  const buyFirst=new RegExp(
    "mua\\s+([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\s+(?:chi\\s*)?([0-9]+(?:[.,][0-9]+)*)\\s*(k|nghin|ngan|d)?",
    "g"
  );
  const priceFirst=new RegExp(
    "([0-9]+(?:[.,][0-9]+)*)\\s*(k|nghin|ngan|d)\\s+([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\b",
    "g"
  );
  const discountFirst=new RegExp(
    "giam\\s+([0-9]+(?:[.,][0-9]+)*)\\s*(k|nghin|ngan|d)?\\s+(?:tu\\s+)?([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\b",
    "g"
  );

  const wrapperKinds=new Set(["Thùng","Lốc","Combo","Bộ"]);
  const packKind=normalizePackWord(pack&&pack.pack_kind||"");
  const packUnit=normalizePackWord(pack&&pack.pack_unit||"");
  const packQty=Math.max(1,Number(pack&&pack.pack_quantity)||1);
  const basePack=Number(currentPackPrice)||0;

  let structured=false;
  let best=null;

  function parseTotal(priceToken,suffix){
    const unit=String(suffix||"").toLowerCase();
    if(unit==="k"||unit==="nghin"||unit==="ngan"){
      const kValue=Number(String(priceToken||"").replace(",","."));
      return Number.isFinite(kValue)?Math.round(kValue*1000):0;
    }
    return parseMoney(priceToken)||0;
  }

  function requiredPackCount(qty,promoUnit){
    let requiredPacks=0;
    if(wrapperKinds.has(packKind)&&promoUnit===packKind){
      requiredPacks=qty;
    }else if(promoUnit===packUnit){
      const ratio=qty/packQty;
      if(ratio>=1&&Math.abs(ratio-Math.round(ratio))<1e-9){
        requiredPacks=Math.round(ratio);
      }
    }
    return requiredPacks;
  }

  function consider(promoQty,promoUnitRaw,priceToken,suffix){
    structured=true;
    const qty=Number(String(promoQty||"").replace(",","."));
    const promoUnit=normalizePackWord(promoUnitRaw);
    const total=parseTotal(priceToken,suffix);
    if(!(qty>0&&total>0))return;

    const requiredPacks=requiredPackCount(qty,promoUnit);
    if(!(requiredPacks>=1))return;

    const effectivePack=Math.round(total/requiredPacks);
    const effectiveUnit=Math.round(total/(requiredPacks*packQty));
    if(basePack>0&&effectivePack>=basePack)return;

    const candidate={
      matched:true,
      structured:true,
      required_packs:requiredPacks,
      required_quantity:qty,
      required_unit:promoUnit,
      total_price:total,
      effective_pack_price:effectivePack,
      effective_unit_price:effectiveUnit
    };
    if(!best||candidate.effective_pack_price<best.effective_pack_price){
      best=candidate;
    }
  }

  function considerDiscount(discountToken,suffix,promoQty,promoUnitRaw){
    structured=true;
    const qty=Number(String(promoQty||"").replace(",","."));
    const promoUnit=normalizePackWord(promoUnitRaw);
    const discountValue=parseTotal(discountToken,suffix);
    if(!(qty>0&&discountValue>0&&basePack>0))return;

    const requiredPacks=requiredPackCount(qty,promoUnit);
    if(!(requiredPacks>=1))return;

    const regularTotal=basePack*requiredPacks;
    if(discountValue>=regularTotal)return;

    const total=regularTotal-discountValue;
    const effectivePack=Math.round(total/requiredPacks);
    const effectiveUnit=Math.round(total/(requiredPacks*packQty));
    if(effectivePack>=basePack)return;

    const candidate={
      matched:true,
      structured:true,
      required_packs:requiredPacks,
      required_quantity:qty,
      required_unit:promoUnit,
      total_price:total,
      discount_amount:discountValue,
      effective_pack_price:effectivePack,
      effective_unit_price:effectiveUnit
    };
    if(!best||candidate.effective_pack_price<best.effective_pack_price){
      best=candidate;
    }
  }

  let match;
  while((match=buyFirst.exec(plain))){
    consider(match[1],match[2],match[3],match[4]);
  }
  while((match=priceFirst.exec(plain))){
    // Do not misread "GIẢM 20.000Đ 5 LỐC" as a total price of 20k.
    const before=plain.slice(Math.max(0,match.index-12),match.index);
    if(/\bgiam\s*$/.test(before))continue;
    consider(match[3],match[4],match[1],match[2]);
  }
  while((match=discountFirst.exec(plain))){
    considerDiscount(match[1],match[2],match[3],match[4]);
  }

  return best||{matched:false,structured};
}

function comparisonData({name,url,packagingText,featureText,packCount,packUnit,current,sysPrice,discount,promoText,hierarchy}){
  const ownedHierarchy=hierarchy&&typeof hierarchy==="object"
    ?hierarchy
    :packHierarchyData(name,url||"",packagingText,packCount,packUnit);

  const pack=hierarchyPackCompatibility(ownedHierarchy);
  const size=parseSize([name,packagingText,featureText].filter(Boolean).join(" "));
  const currentPrice=Number(current)||null;
  const sys=Number(sysPrice)>0?Number(sysPrice):null;
  const currentPack=currentPrice||sys;
  const originalPack=sys&&currentPack&&sys>currentPack?sys:null;
  const discountActive=Boolean(
    Number(discount)>0||
    (originalPack&&currentPack&&currentPack<originalPack)
  );

  const quantityOffer=quantityPromotionForPack(
    promoText,pack,currentPack
  );
  const promoSell=quantityOffer.matched
    ?quantityOffer.effective_pack_price
    :null;
  const promoActive=Boolean(quantityOffer.matched);

  function hierarchyPrices(sellPrice){
    const price=Number(sellPrice)||0;
    if(!price){
      return {carton:null,middle:null,leaf:null};
    }

    const hasCarton=ownedHierarchy.label1==="Thùng";
    const hasMiddle=Boolean(ownedHierarchy.label2);
    const hasLeaf=Boolean(ownedHierarchy.label3);
    const middleQty=Math.max(1,Number(ownedHierarchy.qty2)||1);
    const leafQty=Math.max(1,Number(ownedHierarchy.qty3)||1);

    let carton=null;
    let middle=null;
    let leaf=null;

    if(hasCarton){
      carton=Math.round(price);
      if(hasMiddle){
        middle=Math.round(price/middleQty);
        if(hasLeaf)leaf=Math.round(middle/leafQty);
      }else if(hasLeaf){
        leaf=Math.round(price/leafQty);
      }
    }else if(hasMiddle){
      middle=Math.round(price);
      if(hasLeaf)leaf=Math.round(price/leafQty);
    }else if(hasLeaf){
      leaf=Math.round(price);
    }

    return {carton,middle,leaf};
  }

  const regularLevels=hierarchyPrices(currentPack);
  const promoLevels=hierarchyPrices(promoSell);

  const directUnitPrice=ownedHierarchy.label1==="Thùng"
    ?(ownedHierarchy.label2?regularLevels.middle:regularLevels.leaf)
    :(ownedHierarchy.label2?regularLevels.leaf:regularLevels.leaf);
  const promoDirectUnitPrice=ownedHierarchy.label1==="Thùng"
    ?(ownedHierarchy.label2?promoLevels.middle:promoLevels.leaf)
    :(ownedHierarchy.label2?promoLevels.leaf:promoLevels.leaf);

  return {
    ...pack,
    size_value:size.value,
    size_unit:size.unit,
    hierarchy:ownedHierarchy,

    // Canonical three-level prices.
    regular_carton_price:regularLevels.carton,
    promo_carton_price:promoLevels.carton,
    regular_middle_price:regularLevels.middle,
    promo_middle_price:promoLevels.middle,
    regular_leaf_price:regularLevels.leaf,
    promo_leaf_price:promoLevels.leaf,

    // Compatibility fields for detail/promotion code.
    regular_pack_price:currentPack,
    original_pack_price:originalPack,
    promo_pack_price:promoSell,
    regular_unit_price:directUnitPrice,
    promo_unit_price:promoDirectUnitPrice,

    promotion_active:promoActive,
    promotion_text:promoActive?cleanText(promoText||""):"",
    discount_active:discountActive,
    discount_percent:Number(discount)||0,
    quantity_offer_active:Boolean(quantityOffer.matched),
    quantity_offer_min_packs:quantityOffer.matched?quantityOffer.required_packs:null,
    quantity_offer_quantity:quantityOffer.matched?quantityOffer.required_quantity:null,
    quantity_offer_unit:quantityOffer.matched?quantityOffer.required_unit:"",
    quantity_offer_total_price:quantityOffer.matched?quantityOffer.total_price:null,
    quantity_offer_pack_price:quantityOffer.matched?quantityOffer.effective_pack_price:null,
    quantity_offer_unit_price:quantityOffer.matched?quantityOffer.effective_unit_price:null,
    price_kind:promoActive?"quantity_promotion":"current"
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
    const payload=JSON.parse(row.result_json);
    if(Number(payload&&payload.schema_version||0)<20)return null;
    return {
      payload,
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

async function dispatchGithub(env,url,requestId,sourceKey="go"){
  if(!env.GITHUB_TOKEN)throw new Error("github_token_missing");
  if(sourceKey!=="go"){
    throw new Error(sourceKey+"_github_dispatch_disabled");
  }
  const workflow=WORKFLOW_GO;
  return fetch(
    "https://api.github.com/repos/"+OWNER+"/"+REPO+
    "/actions/workflows/"+workflow+"/dispatches",
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

  const identity=getlinkProductIdentity(
    cleanText(raw.fullName||raw.name||slugTitle(url)),
    url,
    cleanText(raw.canonical||raw.unit||"")
  );
  if(!identity.keep)return null;

  const hierarchy=packHierarchyData(
    identity.name,url,identity.packaging,
    raw.packageItemCount,raw.packageItemUnit||raw.unit
  );
  const comparison=comparisonData({
    name:identity.name,
    url,
    packagingText:identity.packaging,
    featureText:"",
    packCount:raw.packageItemCount,
    packUnit:raw.packageItemUnit||raw.unit,
    current,
    sysPrice:sys,
    discount,
    promoText,
    hierarchy
  });

  return {
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    group,
    branch,
    name:identity.name,
    packaging:{text:identity.packaging},
    hierarchy,
    comparison,
    price:{current,original},
    promotion:{
      active:Boolean(comparison.promotion_active),
      price:comparison.promo_pack_price||null,
      text:comparison.promotion_text||""
    },
    url,
    image:String(raw.avatar||""),
    breadcrumbs:[group,branch].filter(Boolean),
    source_identity:{
      source_product_id:String(raw.id||""),
      source_code:String(raw.productCode||""),
      barcode:"",
      sku:"",
      brand:cleanText(raw.brandName||""),
      category:group,
      raw_name:cleanText(raw.name||""),
      raw_description:cleanText(
        [raw.fullName,raw.canonical].filter(Boolean).join(" · ")
      )
    },
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
  const priceUnitText=cleanText(
    [raw.packageItemCount,raw.packageItemUnit].filter(Boolean).join(" ")
  );
  let packaging=cleanText(
    raw.title||
    priceUnitText||
    raw.textAvgPriceUnit||
    ""
  );
  // If BHX marks "Thùng" on the price option/unit instead of the title,
  // keep that authoritative marker visible in the stored packaging text.
  const priceUnitKey=cleanText(raw.packageItemUnit||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const packagingKey=packaging
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  if(priceUnitKey==="thung"&&!/\bthung\b/.test(packagingKey)){
    packaging=cleanText([packaging,priceUnitText].filter(Boolean).join(" · "));
  }
  const identity=getlinkProductIdentity(
    cleanText(raw.name||slugTitle(url)),
    url,
    packaging
  );
  if(!identity.keep)return null;

  const hierarchy=packHierarchyData(
    identity.name,url,identity.packaging,
    raw.packageItemCount,raw.packageItemUnit
  );
  const comparison=comparisonData({
    name:identity.name,
    url,
    packagingText:identity.packaging,
    featureText:data&&data.productBo&&data.productBo.featureSpecification||"",
    packCount:raw.packageItemCount,
    packUnit:raw.packageItemUnit,
    current,
    sysPrice,
    discount,
    promoText,
    hierarchy
  });

  return {
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    group:cleanText(data&&data.categoryName||""),
    branch:cleanText(data&&data.brandUrl||data&&data.categoryName||""),
    name:identity.name,
    packaging:{text:identity.packaging},
    hierarchy,
    comparison,
    price:{current,original:null,sys_price:sysPrice},
    promotion:{
      active:Boolean(comparison.promotion_active),
      price:comparison.promo_pack_price||null,
      text:comparison.promotion_text||""
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
  const firstRaw=Array.isArray(data&&data.boxBuys)?data.boxBuys[0]:null;
  const first=apiBoxBuyToProduct(firstRaw,data);

  if(!first)throw new Error("bhx_detail_filtered_or_empty");

  // A BHX detail URL owns exactly one authoritative price row:
  // boxBuys[0]. Other boxBuys are temporary choices shown beside it and
  // may change tomorrow, so they must never be persisted or joined as
  // prices for this URL.
  const product={...first,url:canonical};
  return {
    schema_version:20,
    request_id:requestId,
    input_url:canonical,
    input_type:"product",
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    checked_at:new Date().toISOString(),
    category_name:cleanText(data&&data.categoryName||product.group||""),
    category_id:Number(data&&data.categoryId)||null,
    parent_category_ids:Array.isArray(data&&data.categoryParentIds)
      ?data.categoryParentIds:[],
    product,
    products:[product],
    variants:[],
    discovered_links:[]
  };
}

function productPayloadQuality(p){
  if(!p)return -Infinity;
  let score=0;
  const name=getlinkPlain(p.name||"");
  const hierarchy=p.hierarchy||{};
  const price=p.price||{};

  // Prefer the canonical sellable row for a URL over nearby promo/campaign
  // rows that BHX may emit with the SAME url.
  if(Number(price.current)>0)score+=100;
  if(hierarchy.label1==="Thùng")score+=30;
  if(Number(hierarchy.qty2)>0&&hierarchy.label2)score+=60;
  if(/^thung\b/.test(name))score+=30;
  if(cleanText(p.packaging&&p.packaging.text||""))score+=15;
  if(cleanText(p.group||""))score+=10;
  if(cleanText(p.branch||""))score+=10;
  if(cleanText(p.image||""))score+=5;

  // Campaign labels such as "HEINEKEN KÈM TRỨNG 10K" must never replace
  // the real product title for the same canonical link.
  if(/\b(kem|mua|tang|giam|qua)\b/.test(name)&&/\b[0-9]+(?:[.,][0-9]+)?k\b/.test(name)){
    score-=80;
  }
  return score;
}

function dedupeCategoryProducts(products){
  const best=new Map();
  for(const p of products||[]){
    if(!p||!p.url)continue;
    let key;
    try{key=canonicalBhx(p.url);}
    catch{continue;}

    const current=best.get(key);
    if(!current||productPayloadQuality(p)>productPayloadQuality(current)){
      best.set(key,{...p,url:key});
    }
  }
  return [...best.values()];
}

function categoryPayload(inputUrl,requestId,data){
  const canonical=canonicalBhx(inputUrl);
  const rawProducts=Array.isArray(data&&data.products)?data.products:[];
  const candidates=rawProducts.map(apiProductToPayloadProduct).filter(Boolean);
  const products=dedupeCategoryProducts(candidates);
  if(!products.length)throw new Error("bhx_category_filtered_or_empty");

  const categoryName=cleanText(
    (rawProducts[0]&&rawProducts[0].category&&rawProducts[0].category.name)||
    slugTitle(canonical)
  );

  return {
    schema_version:20,
    request_id:requestId,
    input_url:canonical,
    input_type:"category",
    source:{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"},
    checked_at:new Date().toISOString(),
    category_name:categoryName,
    product:null,
    products,
    filter_summary:{
      source_count:rawProducts.length,
      candidate_count:candidates.length,
      duplicate_count:Math.max(0,candidates.length-products.length),
      kept_count:products.length,
      filtered_count:Math.max(0,rawProducts.length-products.length)
    },
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


async function persistLinkAsset(env,url,image,updatedAt){
  const imageUrl=String(image||"").trim();
  if(!url||!imageUrl)return;
  await env.DB.prepare(`
    INSERT INTO link_assets(link_url,image_url,updated_at)
    VALUES(?,?,?)
    ON CONFLICT(link_url) DO UPDATE SET
      image_url=excluded.image_url,
      updated_at=excluded.updated_at
  `).bind(url,imageUrl,updatedAt||new Date().toISOString()).run();
}

async function persistLinkComparison(env,url,cmp,updatedAt){
  if(!url||!cmp)return;
  await env.DB.prepare(`
    INSERT INTO link_comparison(
      link_url,pack_kind,pack_quantity,pack_unit,size_value,size_unit,
      regular_pack_price,promo_pack_price,regular_unit_price,promo_unit_price,
      promotion_active,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(link_url) DO UPDATE SET
      pack_kind=excluded.pack_kind,
      pack_quantity=excluded.pack_quantity,
      pack_unit=excluded.pack_unit,
      size_value=excluded.size_value,
      size_unit=excluded.size_unit,
      regular_pack_price=excluded.regular_pack_price,
      promo_pack_price=excluded.promo_pack_price,
      regular_unit_price=excluded.regular_unit_price,
      promo_unit_price=excluded.promo_unit_price,
      promotion_active=excluded.promotion_active,
      updated_at=excluded.updated_at
  `).bind(
    url,cmp.pack_kind||"",Number(cmp.pack_quantity)||1,cmp.pack_unit||"",
    cmp.size_value??null,cmp.size_unit||"",
    cmp.regular_pack_price??null,cmp.promo_pack_price??null,
    cmp.regular_unit_price??null,cmp.promo_unit_price??null,
    cmp.promotion_active?1:0,updatedAt||new Date().toISOString()
  ).run();
}

async function persistLinkHierarchy(env,url,hierarchy,updatedAt){
  if(!url||!hierarchy)return;
  await env.DB.prepare(`
    INSERT INTO link_pack_hierarchy(
      link_url,label1,qty1,label2,qty2,label3,qty3,evidence,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(link_url) DO UPDATE SET
      label1=excluded.label1,
      qty1=excluded.qty1,
      label2=excluded.label2,
      qty2=excluded.qty2,
      label3=excluded.label3,
      qty3=excluded.qty3,
      evidence=excluded.evidence,
      updated_at=excluded.updated_at
  `).bind(
    url,
    hierarchy.label1||"",Number(hierarchy.qty1)||0,
    hierarchy.label2||"",Number(hierarchy.qty2)||0,
    hierarchy.label3||"",Number(hierarchy.qty3)||0,
    hierarchy.evidence||"",
    updatedAt||new Date().toISOString()
  ).run();
}

async function persistEntry(env,p,parentUrl,requestId,checked,linkType){
  const url=canonicalBhx(p.url);

  if(linkType==="product"){
    const identity=getlinkProductIdentity(
      p.name||"",
      url,
      p.packaging&&p.packaging.text||""
    );
    if(!identity.keep){
      await env.DB.prepare(
        "UPDATE links SET last_status='unlisted',updated_at=? WHERE canonical_url=?"
      ).bind(new Date().toISOString(),url).run();
      return null;
    }
    const hierarchy=packHierarchyData(
      identity.name,url,identity.packaging,
      p.comparison&&p.comparison.pack_quantity,
      p.comparison&&p.comparison.pack_unit
    );
    p={
      ...p,
      name:identity.name,
      packaging:{...(p.packaging||{}),text:identity.packaging},
      hierarchy
    };
    if(identity.authoritativeCarton){
      p.comparison=comparisonData({
        name:p.name,
        url,
        packagingText:p.packaging.text,
        featureText:"",
        packCount:p.comparison&&p.comparison.pack_quantity,
        packUnit:p.comparison&&p.comparison.pack_unit,
        current:p.price&&p.price.current,
        sysPrice:p.price&&p.price.original,
        discount:0,
        promoText:p.promotion&&p.promotion.text||"",
        hierarchy
      });
    }
  }

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
  if(linkType==="product"&&p.image){
    await persistLinkAsset(
      env,url,p.image,p.last_checked_at||checked
    );
  }
  if(linkType==="product"&&p.comparison){
    await persistLinkComparison(
      env,url,p.comparison,p.last_checked_at||checked
    );
  }
  if(linkType==="product"&&p.hierarchy){
    await persistLinkHierarchy(
      env,url,p.hierarchy,p.last_checked_at||checked
    );
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


function sourceParentUrl(productUrl){
  const parts=pathParts(productUrl);
  return parts.length?"https://bachhoaxanh.com/"+parts[0]:null;
}

async function ensureSourceParent(env,parentUrl,categoryName,requestId,checked,status="linked"){
  if(!parentUrl)return null;
  return upsertLink(env,{
    canonical_url:parentUrl,
    source:"Bách Hóa XANH",
    link_type:"category",
    parent_url:null,
    group_name:categoryName||"",
    branch_name:"",
    name:categoryName||slugTitle(parentUrl),
    packaging:"",
    last_checked_at:checked,
    last_status:status,
    last_request_id:requestId
  });
}


async function persistCategoryChildrenBatch(env,children,parentUrl,requestId,checked,categoryName){
  const prepared=[];
  const activeUrls=[];
  const now=new Date().toISOString();

  for(const child of children||[]){
    let childUrl;
    try{childUrl=canonicalBhx(child.url);}catch{continue;}

    const identity=getlinkProductIdentity(
      child.name||"",
      childUrl,
      child.packaging&&child.packaging.text||""
    );
    if(!identity.keep)continue;

    activeUrls.push(childUrl);

    const hierarchy=packHierarchyData(
      identity.name,childUrl,identity.packaging,
      child.comparison&&child.comparison.pack_quantity,
      child.comparison&&child.comparison.pack_unit
    );
    const p={
      ...child,
      name:identity.name,
      packaging:{...(child.packaging||{}),text:identity.packaging},
      hierarchy,
      group:child.group||categoryName||""
    };
    if(identity.authoritativeCarton){
      p.comparison=comparisonData({
        name:p.name,
        url:childUrl,
        packagingText:p.packaging.text,
        featureText:"",
        packCount:p.comparison&&p.comparison.pack_quantity,
        packUnit:p.comparison&&p.comparison.pack_unit,
        current:p.price&&p.price.current,
        sysPrice:p.price&&p.price.original,
        discount:0,
        promoText:p.promotion&&p.promotion.text||"",
        hierarchy
      });
    }
    const price=p.price||{};
    const promo=p.promotion||{};
    const id=await idForUrl(childUrl);

    prepared.push(env.DB.prepare(`
      INSERT INTO links(
        id,canonical_url,source,link_type,parent_url,group_name,branch_name,name,
        packaging,current_price,original_price,promotion_price,promotion_text,
        last_checked_at,last_status,last_request_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(canonical_url) DO UPDATE SET
        source=excluded.source,
        link_type='product',
        parent_url=excluded.parent_url,
        group_name=COALESCE(NULLIF(excluded.group_name,''),links.group_name),
        branch_name=COALESCE(NULLIF(excluded.branch_name,''),links.branch_name),
        name=COALESCE(NULLIF(excluded.name,''),links.name),
        packaging=COALESCE(NULLIF(excluded.packaging,''),links.packaging),
        current_price=COALESCE(excluded.current_price,links.current_price),
        original_price=COALESCE(excluded.original_price,links.original_price),
        promotion_price=COALESCE(excluded.promotion_price,links.promotion_price),
        promotion_text=COALESCE(NULLIF(excluded.promotion_text,''),links.promotion_text),
        last_checked_at=excluded.last_checked_at,
        last_status='ok',
        last_request_id=excluded.last_request_id,
        updated_at=excluded.updated_at
    `).bind(
      id,childUrl,p.source&&p.source.name||"Bách Hóa XANH","product",
      parentUrl,p.group||"",p.branch||"",p.name||"",
      p.packaging&&p.packaging.text||"",
      Number(price.current)||null,Number(price.original)||null,
      Number(promo.price)||null,promo.text||"",
      p.last_checked_at||checked,"ok",requestId,now,now
    ));

    if(p.image){
      prepared.push(
        env.DB.prepare(`
          INSERT INTO link_assets(link_url,image_url,updated_at)
          VALUES(?,?,?)
          ON CONFLICT(link_url) DO UPDATE SET
            image_url=excluded.image_url,
            updated_at=excluded.updated_at
        `).bind(childUrl,String(p.image),p.last_checked_at||checked)
      );
    }

    const cmp=p.comparison||{};
    prepared.push(
      env.DB.prepare(`
        INSERT INTO link_comparison(
          link_url,pack_kind,pack_quantity,pack_unit,size_value,size_unit,
          regular_pack_price,promo_pack_price,regular_unit_price,promo_unit_price,
          promotion_active,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(link_url) DO UPDATE SET
          pack_kind=excluded.pack_kind,
          pack_quantity=excluded.pack_quantity,
          pack_unit=excluded.pack_unit,
          size_value=excluded.size_value,
          size_unit=excluded.size_unit,
          regular_pack_price=excluded.regular_pack_price,
          promo_pack_price=excluded.promo_pack_price,
          regular_unit_price=excluded.regular_unit_price,
          promo_unit_price=excluded.promo_unit_price,
          promotion_active=excluded.promotion_active,
          updated_at=excluded.updated_at
      `).bind(
        childUrl,cmp.pack_kind||"",Number(cmp.pack_quantity)||1,cmp.pack_unit||"",
        cmp.size_value??null,cmp.size_unit||"",
        cmp.regular_pack_price??null,cmp.promo_pack_price??null,
        cmp.regular_unit_price??null,cmp.promo_unit_price??null,
        cmp.promotion_active?1:0,p.last_checked_at||checked
      )
    );

    const h=p.hierarchy||{};
    prepared.push(
      env.DB.prepare(`
        INSERT INTO link_pack_hierarchy(
          link_url,label1,qty1,label2,qty2,label3,qty3,evidence,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(link_url) DO UPDATE SET
          label1=excluded.label1,
          qty1=excluded.qty1,
          label2=excluded.label2,
          qty2=excluded.qty2,
          label3=excluded.label3,
          qty3=excluded.qty3,
          evidence=excluded.evidence,
          updated_at=excluded.updated_at
      `).bind(
        childUrl,
        h.label1||"",Number(h.qty1)||0,
        h.label2||"",Number(h.qty2)||0,
        h.label3||"",Number(h.qty3)||0,
        h.evidence||"",
        p.last_checked_at||checked
      )
    );

    const sourceMeta=p.source_identity||{};
    prepared.push(sourceIdentityStatement(env,{
      link_url:childUrl,
      source_name:"Bách Hóa XANH",
      source_product_id:sourceMeta.source_product_id||"",
      source_code:sourceMeta.source_code||"",
      barcode:sourceMeta.barcode||"",
      sku:sourceMeta.sku||"",
      brand:sourceMeta.brand||p.branch||"",
      category:sourceMeta.category||p.group||"",
      raw_name:sourceMeta.raw_name||p.name||"",
      raw_description:sourceMeta.raw_description||"",
      hierarchy:h,
      size:{
        value:cmp.size_value??null,
        unit:cmp.size_unit||""
      }
    },p.last_checked_at||checked));
  }

  // Keep D1 batches deliberately small: category roots can contain hundreds of children.
  for(let i=0;i<prepared.length;i+=30){
    await env.DB.batch(prepared.slice(i,i+30));
  }

  return activeUrls;
}

async function markMissingChildrenUnlisted(env,parentUrl,activeUrls,checked){
  const existing=await env.DB.prepare(
    "SELECT canonical_url FROM links WHERE link_type='product' AND parent_url=?"
  ).bind(parentUrl).all();
  const active=new Set(activeUrls);
  const now=new Date().toISOString();
  const statements=[];

  for(const row of existing.results||[]){
    if(active.has(row.canonical_url))continue;
    statements.push(
      env.DB.prepare(
        "UPDATE links SET last_status='unlisted',updated_at=? WHERE canonical_url=? AND parent_url=?"
      ).bind(now,row.canonical_url,parentUrl)
    );
  }

  for(let i=0;i<statements.length;i+=30){
    await env.DB.batch(statements.slice(i,i+30));
  }
}

async function repairCachedGraph(env,payload){
  if(!payload||!payload.input_url)return;
  const checked=payload.checked_at||new Date().toISOString();
  const requestId=payload.request_id||"cache-repair";
  const inputUrl=canonicalBhx(payload.input_url);

  if(payload.input_type==="product"){
    const parentUrl=sourceParentUrl(inputUrl);
    await ensureSourceParent(
      env,parentUrl,payload.category_name||payload.product&&payload.product.group||"",
      requestId,checked,"linked"
    );
    if(payload.product){
      await persistEntry(
        env,{...payload.product,url:inputUrl},
        parentUrl,requestId,checked,"product"
      );
    }
    return;
  }

  if(payload.input_type==="category"){
    await ensureSourceParent(
      env,inputUrl,payload.category_name||slugTitle(inputUrl),
      requestId,checked,"ok"
    );
    const activeUrls=await persistCategoryChildrenBatch(
      env,payload.products||[],inputUrl,requestId,checked,
      payload.category_name||""
    );
    if(activeUrls.length){
      await markMissingChildrenUnlisted(env,inputUrl,activeUrls,checked);
    }
  }
}

async function persistPayload(env,payload){
  const checked=payload.checked_at||new Date().toISOString();
  const inputUrl=canonicalBhx(payload.input_url);

  if(payload.input_type==="product"&&payload.product){
    const categoryParent=sourceParentUrl(inputUrl);
    const categoryName=
      payload.category_name||
      payload.product.group||
      "";

    await ensureSourceParent(
      env,categoryParent,categoryName,
      payload.request_id,checked,"linked"
    );

    await persistEntry(
      env,{
        ...payload.product,
        url:inputUrl,
        group:payload.product.group||categoryName
      },
      categoryParent,payload.request_id,checked,"product"
    );

    payload.parent_url=categoryParent;
    payload.source_parent={
      url:categoryParent,
      name:categoryName||slugTitle(categoryParent||"")
    };

    // Do not persist sibling boxBuys from a detail response.
    // Only payload.product (boxBuys[0]) belongs to inputUrl.
  }else{
    await ensureSourceParent(
      env,inputUrl,payload.category_name||slugTitle(inputUrl),
      payload.request_id,checked,"ok"
    );

    const activeUrls=await persistCategoryChildrenBatch(
      env,payload.products||[],inputUrl,payload.request_id,checked,
      payload.category_name||""
    );

    if(activeUrls.length){
      await markMissingChildrenUnlisted(
        env,inputUrl,activeUrls,checked
      );
    }

    payload.child_count=activeUrls.length;
    payload.discovered_links=activeUrls;
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


function winmartTextKey(value){
  return getlinkPlain(value||"")
    .replace(/\b(?:winmart|win mart)\b/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function winmartSourceType(product){
  // RAW ONLY: preserve exactly the sale type returned by WinMart.
  // No normalization and no mapping to Thùng/Giữa/Lẻ at ingestion time.
  return cleanText(product&&(
    product.unit||
    product.packaging||
    product.source_uom_name||
    product.source_uom
  )||"");
}

function winmartRawHierarchy(){
  return {
    keep:true,reason:"",
    label1:"",qty1:0,
    label2:"",qty2:0,
    label3:"",qty3:0,
    evidence:"",locked:false
  };
}

function winmartRawComparison(name,current){
  const price=Number(current||0)||null;
  const size=parseSize(name||"");
  return {
    pack_kind:"",
    pack_quantity:1,
    pack_unit:"",
    size_value:size.value,
    size_unit:size.unit,
    regular_pack_price:price,
    promo_pack_price:null,
    regular_unit_price:null,
    promo_unit_price:null,
    regular_carton_price:null,
    promo_carton_price:null,
    regular_middle_price:null,
    promo_middle_price:null,
    regular_leaf_price:null,
    promo_leaf_price:null,
    promotion_active:false,
    promotion_text:"",
    quantity_offer_active:false,
    quantity_offer_min_packs:null,
    quantity_offer_total_price:null
  };
}


function bhxDirectContext(){
  return {
    provinceId:"1027",
    wardId:"0",
    districtId:"0",
    storeId:"2546"
  };
}

function bhxDirectHeaders(referer){
  return {
    "accept":"application/json, text/plain, */*",
    "accept-language":"vi-VN,vi;q=0.9,en;q=0.7",
    "origin":"https://www.bachhoaxanh.com",
    "referer":referer||"https://www.bachhoaxanh.com/"
  };
}

async function bhxDirectJson(apiUrl,referer){
  let lastError="";
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(apiUrl,{
        method:"GET",
        headers:bhxDirectHeaders(referer)
      });
      if(!response.ok){
        lastError="http_"+response.status;
      }else{
        const body=await response.json();
        if(
          body&&Number(body.code)===0&&
          body.data!==undefined&&body.data!==null
        ){
          return body;
        }
        lastError="invalid_payload_code_"+String(body&&body.code);
      }
    }catch(error){
      lastError=String(error&&error.message||error).slice(0,300);
    }
  }
  throw new Error("bhx_direct_api_failed:"+lastError);
}
async function bhxDirectPostJson(apiUrl,referer,payload){
  let lastError="";
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(apiUrl,{
        method:"POST",
        headers:{
          ...bhxDirectHeaders(referer),
          "content-type":"application/json"
        },
        body:JSON.stringify(payload||{})
      });
      if(!response.ok){
        lastError="http_"+response.status;
      }else{
        const body=await response.json();
        if(
          body&&Number(body.code)===0&&
          body.data!==undefined&&body.data!==null
        ){
          return body;
        }
        lastError="invalid_payload_code_"+String(body&&body.code);
      }
    }catch(error){
      lastError=String(error&&error.message||error).slice(0,300);
    }
  }
  throw new Error("bhx_direct_post_failed:"+lastError);
}

function bhxDirectV2ApiUrl(inputUrl){
  const canonical=canonicalBhx(inputUrl);
  const slug=pathParts(canonical)[0]||"";
  if(!slug)throw new Error("bhx_category_slug_missing");
  const context=bhxDirectContext();
  const api=new URL(
    "https://api.bachhoaxanh.com/gw/Category/V2/GetCate"
  );
  api.searchParams.set("provinceId",context.provinceId);
  api.searchParams.set("wardId",context.wardId);
  api.searchParams.set("districtId",context.districtId);
  api.searchParams.set("storeId",context.storeId);
  api.searchParams.set("categoryUrl",slug);
  api.searchParams.set("isMobile","true");
  api.searchParams.set("isV2","true");
  api.searchParams.set("pageSize","500");
  return api.toString();
}

async function bhxDirectV2Data(inputUrl){
  const canonical=canonicalBhx(inputUrl);
  const apiUrl=bhxDirectV2ApiUrl(canonical);
  const body=await bhxDirectJson(apiUrl,canonical);
  return {
    body,
    products:bhxDirectCollectCategoryProducts(body,canonical),
    response_url:apiUrl
  };
}

async function bhxDirectAjaxData(
  inputUrl,categoryId,pageIndex,lastShowProductId=0,priorityProductIds=""
){
  const canonical=canonicalBhx(inputUrl);
  const context=bhxDirectContext();
  const apiUrl="https://api.bachhoaxanh.com/gw/Category/AjaxProduct";
  const body=await bhxDirectPostJson(
    apiUrl,
    canonical,
    {
      provinceId:Number(context.provinceId),
      wardId:Number(context.wardId),
      districtId:Number(context.districtId),
      storeId:Number(context.storeId),
      CategoryId:Number(categoryId),
      SelectedBrandId:"",
      PropertyIdList:"",
      PageIndex:Number(pageIndex)||1,
      PageSize:10,
      SortStr:"",
      PriorityProductIds:String(priorityProductIds||""),
      PropertySelected:[],
      LastShowProductId:Number(lastShowProductId)||0
    }
  );
  const products=bhxDirectCollectCategoryProducts(body,canonical);
  return {body,products,response_url:apiUrl};
}

function bhxDirectProductId(item){
  return Number(
    item&&(
      item.id||
      item.productId||
      item.productID||
      item.ProductId||
      item.ProductID
    )||0
  )||0;
}


function bhxDirectProductApiUrl(inputUrl){
  const canonical=canonicalBhx(inputUrl);
  const parts=pathParts(canonical);
  if(parts.length<2)throw new Error("bhx_product_url_required");
  const context=bhxDirectContext();
  const api=new URL(
    "https://api.bachhoaxanh.com/gw/Product/GetProductDetail"
  );
  api.searchParams.set("provinceId",context.provinceId);
  api.searchParams.set("wardId",context.wardId);
  api.searchParams.set("districtId",context.districtId);
  api.searchParams.set("storeId",context.storeId);
  api.searchParams.set("CategoryUrl",parts[0]);
  api.searchParams.set("ProductUrl",parts[1]);
  return api.toString();
}

async function bhxDirectProductData(inputUrl){
  const canonical=canonicalBhx(inputUrl);
  const body=await bhxDirectJson(
    bhxDirectProductApiUrl(canonical),
    canonical
  );
  const data=body&&body.data;
  if(!data||!Array.isArray(data.boxBuys)||!data.boxBuys.length){
    throw new Error("bhx_direct_product_empty");
  }
  return {
    data,
    response_url:bhxDirectProductApiUrl(canonical)
  };
}

function bhxDirectCollectCategoryProducts(payload,inputUrl){
  const slug=pathParts(canonicalBhx(inputUrl))[0]||"";
  const best=new Map();

  function itemKey(item){
    return String(
      item&&(
        item.url||
        item.id||
        item.productCode||
        item.productId
      )||
      JSON.stringify(item).slice(0,500)
    );
  }

  function belongsToCategory(item){
    const raw=String(item&&item.url||"");
    if(!raw)return false;
    try{
      const u=new URL(
        raw,
        "https://www.bachhoaxanh.com/"
      );
      const parts=pathParts(u.toString());
      return parts.length>=2&&
        String(parts[0]).toLowerCase()===String(slug).toLowerCase();
    }catch{
      return false;
    }
  }

  function walk(value){
    if(Array.isArray(value)){
      const productLike=value.filter(item=>
        item&&typeof item==="object"&&
        item.url&&
        (
          item.name||
          item.fullName||
          item.productPrices||
          item.avatar
        )
      );
      for(const item of productLike){
        if(belongsToCategory(item)){
          best.set(itemKey(item),item);
        }
      }
      for(const child of value)walk(child);
      return;
    }
    if(value&&typeof value==="object"){
      for(const child of Object.values(value))walk(child);
    }
  }

  walk(payload);
  return [...best.values()];
}

async function bhxResolveCategoryIdFromD1(env,inputUrl){
  const canonical=canonicalBhx(inputUrl);
  const result=await env.DB.prepare(
    "SELECT canonical_url FROM links "+
    "WHERE source='Bách Hóa XANH' "+
    "AND link_type='product' "+
    "AND parent_url=? "+
    "AND COALESCE(last_status,'')<>'unlisted' "+
    "ORDER BY updated_at DESC LIMIT 8"
  ).bind(canonical).all();

  const candidates=result.results||[];
  if(!candidates.length){
    throw new Error("bhx_direct_category_seed_missing");
  }

  let lastError="";
  for(const row of candidates){
    try{
      const detail=await bhxDirectProductData(row.canonical_url);
      const categoryId=Number(detail.data&&detail.data.categoryId)||0;
      if(categoryId>0){
        return {
          category_id:categoryId,
          seed_url:row.canonical_url
        };
      }
      lastError="category_id_missing";
    }catch(error){
      lastError=String(error&&error.message||error).slice(0,300);
    }
  }
  throw new Error(
    "bhx_direct_category_id_unresolved:"+lastError
  );
}

function bhxDirectCategoryIdFromProducts(products){
  for(const item of products||[]){
    const category=item&&item.category&&typeof item.category==="object"
      ?item.category:{};
    const candidates=[
      item&&item.categoryId,
      item&&item.categoryID,
      category.id,
      category.categoryId,
      category.categoryID
    ];
    for(const value of candidates){
      const id=Number(value)||0;
      if(id>0)return id;
    }
  }
  return 0;
}

async function bhxDirectVegetableData(inputUrl,categoryId){
  const canonical=canonicalBhx(inputUrl);
  const context=bhxDirectContext();
  const api=new URL(
    "https://api.bachhoaxanh.com/gw/Category/GetCateVegetable"
  );
  api.searchParams.set("provinceId",context.provinceId);
  api.searchParams.set("wardId",context.wardId);
  api.searchParams.set("districtId",context.districtId);
  api.searchParams.set("storeId",context.storeId);
  api.searchParams.set("cateId",String(categoryId));
  api.searchParams.set("customerId","0");
  const body=await bhxDirectJson(api.toString(),canonical);
  return {
    body,
    products:bhxDirectCollectCategoryProducts(body,canonical),
    response_url:api.toString()
  };
}

async function bhxDirectCategoryData(env,inputUrl){
  const canonical=canonicalBhx(inputUrl);

  // V2 is keyed by the category slug, so it can bootstrap a category
  // without opening the HTML page or knowing cateId beforehand.
  const v2=await bhxDirectV2Data(canonical);
  let categoryId=bhxDirectCategoryIdFromProducts(v2.products);

  // Some BHX categories may omit category.id from V2. For categories
  // already present in D1, resolve it from one child detail as fallback.
  if(!categoryId){
    const resolved=await bhxResolveCategoryIdFromD1(env,canonical);
    categoryId=resolved.category_id;
  }
  if(!categoryId){
    throw new Error("bhx_direct_category_id_missing");
  }

  // These two requests are independent once cateId is known.
  const [vegetable,ajax1]=await Promise.all([
    bhxDirectVegetableData(canonical,categoryId),
    bhxDirectAjaxData(canonical,categoryId,1,0,"")
  ]);

  const ajaxProducts=[...ajax1.products];
  let lastPage=ajax1.products;
  let pageIndex=1;

  // BHX currently uses PageSize=10. Continue until the terminal short page.
  while(lastPage.length===10&&pageIndex<50){
    pageIndex+=1;
    const lastShowProductId=bhxDirectProductId(
      lastPage[lastPage.length-1]
    );
    const page=await bhxDirectAjaxData(
      canonical,categoryId,pageIndex,lastShowProductId,""
    );
    lastPage=page.products;
    ajaxProducts.push(...lastPage);
    if(!lastPage.length)break;
  }

  const merged=new Map();
  for(const item of [
    ...v2.products,
    ...vegetable.products,
    ...ajaxProducts
  ]){
    const key=String(
      item&&(
        item.url||item.id||item.productCode||item.productId
      )||""
    );
    if(key)merged.set(key,item);
  }
  const products=[...merged.values()];
  if(!products.length){
    throw new Error("bhx_direct_category_empty");
  }

  const countRow=await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM links "+
    "WHERE source='Bách Hóa XANH' "+
    "AND link_type='product' "+
    "AND parent_url=? "+
    "AND COALESCE(last_status,'')<>'unlisted'"
  ).bind(canonical).first();
  const existingCount=Number(countRow&&countRow.n||0);

  // Never silently shrink a known category. If a source request becomes
  // partial, the caller will fall back to the browser API-capture path.
  if(existingCount>0&&products.length<existingCount){
    throw new Error(
      "bhx_direct_category_partial:"+
      products.length+"/"+existingCount
    );
  }

  return {
    data:{
      products,
      _getlink_direct_count:products.length,
      _getlink_category_id:categoryId
    },
    response_url:v2.response_url,
    category_id:categoryId,
    existing_count:existingCount,
    v2_count:v2.products.length,
    vegetable_count:vegetable.products.length,
    ajax_count:ajaxProducts.length,
    ajax_pages:pageIndex
  };
}

async function fetchBhxDirect(env,inputUrl,requestId){
  const canonical=canonicalBhx(inputUrl);
  const kind=heuristicType(canonical);

  if(kind==="product"){
    const direct=await bhxDirectProductData(canonical);
    const payload=productDetailPayload(
      canonical,requestId,direct.data
    );
    payload.capture_engine="bhx-direct-worker";
    payload.capture_country="vn";
    payload.response_url=direct.response_url;
    return {
      payload,
      response_url:direct.response_url,
      kind:"product"
    };
  }

  const direct=await bhxDirectCategoryData(env,canonical);
  const payload=categoryPayload(
    canonical,requestId,direct.data
  );
  payload.capture_engine="bhx-direct-worker";
  payload.capture_country="vn";
  payload.response_url=direct.response_url;
  payload.category_id=direct.category_id;
  return {
    payload,
    response_url:direct.response_url,
    kind:"category",
    direct_count:payload.products.length,
    existing_count:direct.existing_count
  };
}

function winmartDirectSlug(inputUrl){
  const u=new URL(canonicalWinmart(inputUrl));
  return cleanText(
    u.searchParams.get("cate2")||
    pathParts(u.toString()).slice(-1)[0]||
    ""
  );
}

function winmartDirectStoreCode(inputUrl){
  const u=new URL(canonicalWinmart(inputUrl));
  return cleanText(u.searchParams.get("storeCode")||"1535")||"1535";
}

function winmartDirectApiUrl(inputUrl,pageNumber,pageSize=500){
  const slug=winmartDirectSlug(inputUrl);
  if(!slug)throw new Error("winmart_category_slug_missing");
  const api=new URL(
    "https://api-crownx.winmart.vn/it/api/web/v3/item/category"
  );
  api.searchParams.set("storeCode",winmartDirectStoreCode(inputUrl));
  api.searchParams.set("slug",slug);
  api.searchParams.set("pageNumber",String(Math.max(1,Number(pageNumber)||1)));
  api.searchParams.set("pageSize",String(Math.max(1,Number(pageSize)||500)));
  api.searchParams.set("orderByDesc","true");
  api.searchParams.set("storeGroupCode","1998");
  return api.toString();
}

async function winmartDirectFetchPage(inputUrl,pageNumber,pageSize=500){
  const apiUrl=winmartDirectApiUrl(inputUrl,pageNumber,pageSize);
  let lastError="";
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(apiUrl,{
        method:"GET",
        headers:{
          "accept":"application/json",
          "accept-language":"vi-VN,vi;q=0.9,en;q=0.7",
          "x-api-merchant":"WCM",
          "origin":"https://winmart.vn",
          "referer":"https://winmart.vn/",
          "user-agent":"Mozilla/5.0"
        }
      });
      if(!response.ok){
        lastError="http_"+response.status;
      }else{
        const body=await response.json();
        const data=body&&typeof body.data==="object"&&body.data
          ?body.data:{};
        const items=Array.isArray(data.items)?data.items:[];
        const paging=body&&typeof body.paging==="object"&&body.paging
          ?body.paging
          :(data&&typeof data.paging==="object"&&data.paging?data.paging:{});
        return {data,items,paging,api_url:apiUrl};
      }
    }catch(error){
      lastError=String(error&&error.message||error).slice(0,300);
    }
    if(attempt<2){
      await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
  }
  throw new Error("winmart_direct_api_failed:"+lastError);
}

function winmartDirectImageValue(value){
  if(typeof value==="string"){
    const text=value.trim();
    if(text.startsWith("//"))return "https:"+text;
    if(/^https?:\/\//i.test(text))return text;
    return "";
  }
  if(Array.isArray(value)){
    for(const child of value){
      const found=winmartDirectImageValue(child);
      if(found)return found;
    }
    return "";
  }
  if(value&&typeof value==="object"){
    const preferred=[
      "url","src","image","imageUrl","mediaUrl",
      "thumbnail","thumbnailUrl","original"
    ];
    for(const key of preferred){
      const found=winmartDirectImageValue(value[key]);
      if(found)return found;
    }
    for(const child of Object.values(value)){
      const found=winmartDirectImageValue(child);
      if(found)return found;
    }
  }
  return "";
}

function winmartDirectImage(item){
  const keys=[
    "mediaUrl","mediaItems","imageUrl","image_url",
    "thumbnailUrl","thumbnail_url","thumbnail","image",
    "images","imageUrls","image_urls","productImage",
    "product_image","avatar","picture"
  ];
  for(const key of keys){
    const found=winmartDirectImageValue(item&&item[key]);
    if(found)return found;
  }
  return "";
}

function winmartDirectProductUrl(item,inputUrl){
  const store=winmartDirectStoreCode(inputUrl);
  const seo=cleanText(item&&(
    item.seoName||item.seo_name
  )||"");
  if(seo){
    const out=new URL(
      "https://winmart.vn/products/"+seo.replace(/^\/+|\/+$/g,"")
    );
    out.searchParams.set("storeCode",store);
    return out.toString();
  }
  const raw=cleanText(item&&(
    item.productUrl||item.product_url||item.url||item.href
  )||"");
  if(!raw)return "";
  try{
    const out=new URL(raw,inputUrl);
    if(
      out.hostname.toLowerCase()!=="winmart.vn"&&
      out.hostname.toLowerCase()!=="www.winmart.vn"
    )return "";
    out.protocol="https:";
    out.hostname="winmart.vn";
    out.search="";
    out.searchParams.set("storeCode",store);
    return out.toString();
  }catch{
    return "";
  }
}

function winmartDirectRawProduct(item,inputUrl){
  const regular=parseMoney(
    item&&(
      item.price||
      item.listPrice||
      item.originalPrice
    )
  );
  const sale=parseMoney(
    item&&(
      item.salePrice||
      item.sellingPrice||
      item.finalPrice||
      item.currentPrice
    )
  );
  const current=sale||regular;
  const original=regular&&current&&regular>current?regular:null;
  const sourceType=cleanText(item&&(
    item.uomName||
    item.unitName||
    item.unit||
    item.packageUnit||
    item.packingUnit||
    item.measureUnit||
    item.uom
  )||"");
  return {
    url:winmartDirectProductUrl(item,inputUrl),
    name:cleanText(item&&(
      item.name||item.productName||item.product_name||item.title
    )||""),
    current_price:current,
    original_price:original,
    image:winmartDirectImage(item||{}),
    brand:cleanText(item&&(
      item.brandName||item.brand_name||item.brand
    )||""),
    unit:sourceType,
    unit_evidence:sourceType?"winmart_api_type":"",
    packaging:sourceType,
    category_name:cleanText(item&&(
      item.categoryName||item.category_name
    )||""),
    promotion_text:cleanText(item&&(
      item.promotionText||item.promotion_text
    )||""),
    source_product_id:cleanText(item&&item.id||""),
    source_item_no:cleanText(item&&(item.itemNo||item.item_no)||""),
    source_sku:cleanText(item&&item.sku||""),
    barcode:cleanText(item&&item.barcode||""),
    source_seo_name:cleanText(item&&item.seoName||""),
    source_description:cleanText(item&&item.description||""),
    source_short_description:cleanText(item&&item.shortDescription||""),
    source_uom:cleanText(item&&item.uom||""),
    source_uom_name:cleanText(item&&item.uomName||""),
    source_quantity_per_unit:item&&item.quantityPerUnit!==undefined
      ?item.quantityPerUnit:null
  };
}

async function fetchWinmartDirect(inputUrl){
  const canonical=canonicalWinmart(inputUrl);
  if(heuristicType(canonical)!=="category"){
    throw new Error("winmart_category_link_required");
  }
  const started=Date.now();
  const pageSize=500;
  const first=await winmartDirectFetchPage(canonical,1,pageSize);
  const totalPages=Math.max(
    1,Number(first.paging&&first.paging.totalPages)||1
  );
  const totalCount=Math.max(
    0,Number(first.paging&&first.paging.totalCount)||first.items.length
  );
  const pageResults=new Map([[1,first.items]]);
  if(totalPages>1){
    const pageNumbers=Array.from(
      {length:totalPages-1},
      (_,index)=>index+2
    );
    for(let start=0;start<pageNumbers.length;start+=8){
      const part=pageNumbers.slice(start,start+8);
      const results=await Promise.all(
        part.map(pageNumber=>
          winmartDirectFetchPage(canonical,pageNumber,pageSize)
        )
      );
      results.forEach((result,index)=>{
        pageResults.set(part[index],result.items);
      });
    }
  }

  const sourceItems=[];
  for(let pageNumber=1;pageNumber<=totalPages;pageNumber++){
    sourceItems.push(...(pageResults.get(pageNumber)||[]));
  }

  const products=sourceItems.map(
    item=>winmartDirectRawProduct(item,canonical)
  );
  const checked=new Date().toISOString();
  return {
    status:"complete",
    engine:"winmart-direct-worker",
    input_url:canonical,
    kind:"category",
    checked_at:checked,
    winmart_response:{
      category_name:cleanText(
        first.data&&first.data.name||winmartDirectSlug(canonical)
      ),
      store_code:winmartDirectStoreCode(canonical),
      subcategories:[],
      products,
      checked_at:checked,
      source_api:{
        engine:"winmart-direct-worker",
        slug:winmartDirectSlug(canonical),
        page_size:pageSize,
        total_pages:totalPages,
        total_count:totalCount,
        api_rows:sourceItems.length,
        raw_types:products.filter(
          product=>cleanText(product.unit||"")
        ).length,
        elapsed_ms:Date.now()-started
      }
    }
  };
}

async function loadBhxTaxonomyForWinmart(env){
  const cats=await env.DB.prepare(
    "SELECT canonical_url,name,group_name FROM links WHERE source='Bách Hóa XANH' AND link_type='category' AND COALESCE(last_status,'')<>'unlisted'"
  ).all();
  const products=await env.DB.prepare(
    "SELECT parent_url,group_name,branch_name,name FROM links WHERE source='Bách Hóa XANH' AND link_type='product' AND parent_url IS NOT NULL AND TRIM(COALESCE(name,''))<>'' AND COALESCE(last_status,'')<>'unlisted' LIMIT 6000"
  ).all();

  const productByKey=new Map();
  const brandByKey=new Map();
  for(const row of products.results||[]){
    const key=winmartTextKey(row.name);
    if(key&&!productByKey.has(key))productByKey.set(key,row);
    const brand=cleanText(row.branch_name||"");
    const brandKey=winmartTextKey(brand);
    if(brandKey&&!brandByKey.has(brandKey)){
      brandByKey.set(brandKey,brand);
    }
  }
  const brandKeys=[...brandByKey.entries()]
    .map(([key,label])=>({key,label}))
    .sort((a,b)=>b.key.length-a.key.length);

  const categoryByKey=new Map();
  const categoryRows=[];
  for(const row of cats.results||[]){
    const keys=[
      winmartTextKey(row.name),
      winmartTextKey(row.group_name)
    ].filter(Boolean);
    for(const key of keys){
      if(!categoryByKey.has(key))categoryByKey.set(key,row);
    }
    categoryRows.push({row,keys});
  }

  const nearRows=[];
  const tokenIndex=new Map();
  const stop=new Set([
    "chai","lon","goi","hop","tui","bich","can","hu","ly","cay","vien","tuyp",
    "kg","g","ml","lit","l","gram","gam"
  ]);
  for(const row of products.results||[]){
    const key=winmartTextKey(row.name);
    const tokens=[...new Set(
      key.split(/\s+/).filter(t=>t.length>=2&&!stop.has(t)&&!/^[0-9.]+$/.test(t))
    )];
    const item={row,key,tokens};
    nearRows.push(item);
    for(const token of tokens){
      if(!tokenIndex.has(token))tokenIndex.set(token,[]);
      tokenIndex.get(token).push(item);
    }
  }

  return {
    productByKey,categoryByKey,categoryRows,brandKeys,
    nearRows,tokenIndex,nearStop:stop
  };
}

function winmartNearBhxProduct(name,taxonomy){
  const key=winmartTextKey(name||"");
  if(!key)return null;
  const exact=taxonomy.productByKey.get(key);
  if(exact)return {row:exact,score:1,evidence:"same_product"};

  const tokens=[...new Set(
    key.split(/\s+/).filter(
      t=>t.length>=2&&!taxonomy.nearStop.has(t)&&!/^[0-9.]+$/.test(t)
    )
  )];
  if(tokens.length<3)return null;

  const counts=new Map();
  for(const token of tokens){
    for(const item of taxonomy.tokenIndex.get(token)||[]){
      counts.set(item,(counts.get(item)||0)+1);
    }
  }

  const sourceSize=parseSize(name||"");
  let best=null;
  for(const [item,common] of counts){
    if(common<3)continue;
    const candidateSize=parseSize(item.row.name||"");
    if(
      sourceSize.value&&candidateSize.value&&
      (
        sourceSize.unit!==candidateSize.unit||
        Number(sourceSize.value)!==Number(candidateSize.value)
      )
    )continue;

    const denom=Math.max(tokens.length,item.tokens.length);
    const score=denom?common/denom:0;
    const minCommon=Math.max(3,Math.ceil(Math.min(tokens.length,item.tokens.length)*0.65));
    if(common<minCommon||score<0.62)continue;
    if(!best||score>best.score){
      best={row:item.row,score,evidence:"near_product"};
    }
  }
  return best;
}

function matchBhxBrandForWinmart(product,name,taxonomy){
  const explicit=cleanText(
    product&&(
      product.brand||
      product.brand_name||
      product.brandName
    )||""
  );
  if(explicit)return explicit;

  const nameKey=winmartTextKey(name||"");
  const exact=taxonomy.productByKey.get(nameKey);
  if(exact&&cleanText(exact.branch_name||"")){
    return cleanText(exact.branch_name);
  }
  const near=winmartNearBhxProduct(name,taxonomy);
  if(near&&near.row&&cleanText(near.row.branch_name||"")){
    return cleanText(near.row.branch_name);
  }

  const padded=" "+nameKey+" ";
  for(const item of taxonomy.brandKeys||[]){
    if(!item.key)continue;
    if(padded.includes(" "+item.key+" ")){
      return item.label;
    }
  }
  return "";
}

function matchBhxTaxonomyForWinmart(product,taxonomy){
  const productName=cleanText(product&&product.name||"");
  const productMatch=winmartNearBhxProduct(productName,taxonomy);
  if(productMatch&&productMatch.row&&productMatch.row.parent_url){
    return {
      parent_url:productMatch.row.parent_url,
      group_name:cleanText(productMatch.row.group_name||""),
      evidence:productMatch.evidence
    };
  }

  const categoryKey=winmartTextKey(
    product&&product.category_name||
    product&&product.category||
    ""
  );
  const broadWinmartCategory=new Set(["gia vi","winmart"]);
  if(categoryKey&&!broadWinmartCategory.has(categoryKey)){
    const exactCat=taxonomy.categoryByKey.get(categoryKey);
    if(exactCat){
      return {
        parent_url:exactCat.canonical_url,
        group_name:cleanText(exactCat.name||exactCat.group_name||""),
        evidence:"same_category"
      };
    }

    for(const item of taxonomy.categoryRows){
      const close=item.keys.some(key=>
        key.length>=4&&categoryKey.length>=4&&
        (key.includes(categoryKey)||categoryKey.includes(key))
      );
      if(close){
        return {
          parent_url:item.row.canonical_url,
          group_name:cleanText(item.row.name||item.row.group_name||""),
          evidence:"category_near"
        };
      }
    }
  }

  return {
    parent_url:null,
    group_name:cleanText(
      product&&product.category_name||
      product&&product.category||
      "Chưa phân nhóm"
    ),
    evidence:"unmapped"
  };
}

async function persistWinmartResponse(env,job,requestId,raw){
  const response=raw&&raw.winmart_response||{};
  const inputUrl=canonicalWinmart(
    raw&&raw.input_url||
    job&&job.input_url||
    job&&job.canonical_url
  );
  const checked=String(
    raw&&raw.checked_at||
    response.checked_at||
    new Date().toISOString()
  );
  const storeCode=cleanText(
    response.store_code||
    new URL(inputUrl).searchParams.get("storeCode")||
    ""
  );
  const taxonomy=await loadBhxTaxonomyForWinmart(env);
  const products=Array.isArray(response.products)?response.products:[];
  const normalized=[];
  const prepared=[];
  let mapped=0;
  let unmapped=0;

  const linkSql=
    "INSERT INTO links(id,canonical_url,source,link_type,parent_url,group_name,branch_name,name,packaging,current_price,original_price,promotion_price,promotion_text,last_checked_at,last_status,last_request_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "+
    "ON CONFLICT(canonical_url) DO UPDATE SET source=excluded.source,link_type='product',parent_url=excluded.parent_url,group_name=excluded.group_name,branch_name=COALESCE(NULLIF(excluded.branch_name,''),links.branch_name),name=COALESCE(NULLIF(excluded.name,''),links.name),packaging=excluded.packaging,current_price=COALESCE(excluded.current_price,links.current_price),original_price=excluded.original_price,promotion_price=excluded.promotion_price,promotion_text=excluded.promotion_text,last_checked_at=excluded.last_checked_at,last_status='ok',last_request_id=excluded.last_request_id,updated_at=excluded.updated_at";

  for(const rawProduct of products){
    const name=cleanText(
      rawProduct&&(
        rawProduct.name||
        rawProduct.product_name||
        rawProduct.title
      )||""
    );
    const current=parseMoney(
      rawProduct&&(
        rawProduct.current_price||
        rawProduct.sale_price||
        rawProduct.price
      )
    );
    if(!name||!current)continue;

    let productUrl;
    try{
      const candidate=new URL(
        String(rawProduct.url||rawProduct.link||""),
        inputUrl
      );
      if(storeCode&&!candidate.searchParams.get("storeCode")){
        candidate.searchParams.set("storeCode",storeCode);
      }
      productUrl=canonicalWinmart(candidate.toString());
    }catch{
      continue;
    }

    const originalRaw=parseMoney(
      rawProduct.original_price||
      rawProduct.list_price||
      rawProduct.base_price
    );
    const original=originalRaw&&originalRaw>current?originalRaw:null;
    const packaging=winmartSourceType(rawProduct);
    const hierarchy=winmartRawHierarchy();
    const size=parseSize([
      name,
      rawProduct.source_description||"",
      rawProduct.source_short_description||""
    ].filter(Boolean).join(" "));
    const comparison={
      ...winmartRawComparison(name,current),
      size_value:size.value,
      size_unit:size.unit
    };
    const tax=matchBhxTaxonomyForWinmart(rawProduct,taxonomy);
    if(tax.parent_url)mapped+=1;
    else unmapped+=1;

    const brand=matchBhxBrandForWinmart(
      rawProduct,name,taxonomy
    );
    const image=String(rawProduct.image||rawProduct.image_url||"").trim();
    const promoText=cleanText(rawProduct.promotion_text||"");
    const id=await idForUrl(productUrl);
    const now=new Date().toISOString();

    prepared.push(
      env.DB.prepare(linkSql).bind(
        id,productUrl,"WinMart","product",tax.parent_url,
        tax.group_name,brand,name,packaging,
        current,original,null,promoText,checked,"ok",requestId,now,now
      )
    );

    prepared.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO price_snapshots(link_id,request_id,checked_at,current_price,original_price,promotion_price,promotion_text,result_json) VALUES(?,?,?,?,?,?,?,?)"
      ).bind(
        id,requestId,checked,current,original,null,promoText,
        JSON.stringify({
          source:"WinMart",
          category:tax.group_name,
          taxonomy_evidence:tax.evidence
        })
      )
    );

    if(image){
      prepared.push(
        env.DB.prepare(
          "INSERT INTO link_assets(link_url,image_url,updated_at) VALUES(?,?,?) ON CONFLICT(link_url) DO UPDATE SET image_url=excluded.image_url,updated_at=excluded.updated_at"
        ).bind(productUrl,image,checked)
      );
    }

    prepared.push(
      env.DB.prepare(
        "INSERT INTO link_comparison(link_url,pack_kind,pack_quantity,pack_unit,size_value,size_unit,regular_pack_price,promo_pack_price,regular_unit_price,promo_unit_price,promotion_active,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) "+
        "ON CONFLICT(link_url) DO UPDATE SET pack_kind=excluded.pack_kind,pack_quantity=excluded.pack_quantity,pack_unit=excluded.pack_unit,size_value=excluded.size_value,size_unit=excluded.size_unit,regular_pack_price=excluded.regular_pack_price,promo_pack_price=excluded.promo_pack_price,regular_unit_price=excluded.regular_unit_price,promo_unit_price=excluded.promo_unit_price,promotion_active=excluded.promotion_active,updated_at=excluded.updated_at"
      ).bind(
        productUrl,comparison.pack_kind||"",Number(comparison.pack_quantity)||1,
        comparison.pack_unit||"",comparison.size_value??null,comparison.size_unit||"",
        comparison.regular_pack_price??null,comparison.promo_pack_price??null,
        comparison.regular_unit_price??null,comparison.promo_unit_price??null,
        comparison.promotion_active?1:0,checked
      )
    );

    prepared.push(
      env.DB.prepare(
        "INSERT INTO link_pack_hierarchy(link_url,label1,qty1,label2,qty2,label3,qty3,evidence,updated_at) VALUES(?,?,?,?,?,?,?,?,?) "+
        "ON CONFLICT(link_url) DO UPDATE SET label1=excluded.label1,qty1=excluded.qty1,label2=excluded.label2,qty2=excluded.qty2,label3=excluded.label3,qty3=excluded.qty3,evidence=excluded.evidence,updated_at=excluded.updated_at"
      ).bind(
        productUrl,
        hierarchy.label1||"",Number(hierarchy.qty1)||0,
        hierarchy.label2||"",Number(hierarchy.qty2)||0,
        hierarchy.label3||"",Number(hierarchy.qty3)||0,
        hierarchy.evidence||"",checked
      )
    );

    prepared.push(sourceIdentityStatement(env,{
      link_url:productUrl,
      source_name:"WinMart",
      source_product_id:rawProduct.source_product_id||"",
      source_code:rawProduct.source_item_no||"",
      barcode:rawProduct.barcode||"",
      sku:rawProduct.source_sku||"",
      brand:rawProduct.brand||brand||"",
      category:rawProduct.category_name||tax.group_name||"",
      raw_name:rawProduct.name||name,
      raw_description:[
        rawProduct.source_description,
        rawProduct.source_short_description,
        rawProduct.source_uom_name
      ].filter(Boolean).join(" · "),
      hierarchy,
      size
    },checked));

    normalized.push({
      source:{key:"winmart",name:"WinMart",host:"winmart.vn"},
      group:tax.group_name,
      branch:brand,
      name,
      packaging:{text:packaging},
      hierarchy,
      comparison,
      price:{current,original},
      promotion:{active:false,price:null,text:promoText},
      url:productUrl,
      image,
      taxonomy_match:tax.evidence,
      winmart_category:cleanText(
        rawProduct.category_name||rawProduct.category||""
      ),
      source_identity:{
        product_id:cleanText(rawProduct.source_product_id||""),
        item_no:cleanText(rawProduct.source_item_no||""),
        sku:cleanText(rawProduct.source_sku||""),
        barcode:cleanText(rawProduct.barcode||""),
        uom:cleanText(rawProduct.source_uom||""),
        uom_name:cleanText(rawProduct.source_uom_name||""),
        quantity_per_unit:rawProduct.source_quantity_per_unit??null
      },
      last_checked_at:checked
    });
  }

  for(let i=0;i<prepared.length;i+=60){
    await env.DB.batch(prepared.slice(i,i+60));
  }

  const categoryName=cleanText(
    response.category_name||
    slugTitle(inputUrl)||
    "WinMart"
  );
  await upsertLink(env,{
    canonical_url:inputUrl,
    source:"WinMart",
    link_type:"category",
    parent_url:null,
    group_name:categoryName,
    branch_name:"",
    name:categoryName,
    packaging:"",
    last_checked_at:checked,
    last_status:"ok",
    last_request_id:requestId
  });

  const payload={
    schema_version:21,
    request_id:requestId,
    input_url:inputUrl,
    input_type:"category",
    checked_at:checked,
    source:{key:"winmart",name:"WinMart",host:"winmart.vn"},
    category_name:categoryName,
    store_code:storeCode,
    products:normalized,
    variants:[],
    discovered_links:normalized.map(x=>x.url),
    child_count:normalized.length,
    mapped_to_bhx:mapped,
    unmapped_to_bhx:unmapped
  };
  const resultJson=JSON.stringify(payload);
  await env.DB.prepare(
    "UPDATE jobs SET link_type='category',status='complete',result_json=?,error=NULL,updated_at=? WHERE request_id=?"
  ).bind(resultJson,new Date().toISOString(),requestId).run();

  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first();
  return {
    payload,
    registry_count:Number(count&&count.n||0),
    mapped_to_bhx:mapped,
    unmapped_to_bhx:unmapped
  };
}


function goCleanProductName(value){
  return cleanText(value||"")
    .replace(/\s+tại\s+Siêu\s+thị\s+GO!.*$/iu,"")
    .replace(/\s*-\s*[0-9]{4,}\s*$/u,"")
    .trim();
}

function matchBhxTaxonomyForGo(product,taxonomy){
  const name=goCleanProductName(product&&product.name||"");
  const near=winmartNearBhxProduct(name,taxonomy);
  if(near&&near.row&&near.row.parent_url){
    return {
      parent_url:near.row.parent_url,
      group_name:cleanText(near.row.group_name||""),
      evidence:near.evidence==="same_product"?"same_product":"near_product"
    };
  }

  const nameKey=winmartTextKey(name);
  let best=null;
  for(const item of taxonomy.categoryRows||[]){
    for(const key of item.keys||[]){
      if(!key||key.length<4)continue;
      const padded=" "+nameKey+" ";
      const exactPhrase=padded.includes(" "+key+" ");
      if(!exactPhrase)continue;
      if(!best||key.length>best.key.length){
        best={key,row:item.row};
      }
    }
  }
  if(best){
    return {
      parent_url:best.row.canonical_url,
      group_name:cleanText(best.row.name||best.row.group_name||""),
      evidence:"name_category"
    };
  }

  return matchBhxTaxonomyForWinmart(product,taxonomy);
}

function goSlugText(url){
  try{
    const last=decodeURIComponent(
      pathParts(canonicalGo(url)).slice(-1)[0]||""
    );
    return cleanText(
      last
        .replace(/-i\.\d+$/i,"")
        .replace(/-\d+$/,"")
        .replace(/-/g," ")
    );
  }catch{
    return "";
  }
}

function goProductClassUnit(text){
  const key=getlinkPlain(text||"");
  // Only infer when the product class itself is a strong packaging signal.
  // Explicit CHAI/HỘP/LON/GÓI in name or URL always wins.
  if(/\b(mi|pho|bun|hu tieu)\b/.test(key))return "Gói";
  return "";
}

function goPackHierarchy(name,url){
  const namePlain=getlinkPlain(name||"");
  const slugPlain=getlinkPlain(goSlugText(url));
  const preferred=namePlain||slugPlain;
  const units="loc|hop|chai|goi|bich|tui|lon|hu|ly|to|can|vi|cay|vien|tuyp";
  const unitLabel=value=>normalizePackWord(value||"");
  const validQty=value=>{
    const n=Number(String(value||"").replace(",","."));
    return Number.isFinite(n)&&n>0&&n<=500?n:0;
  };
  const explicitLeaf=()=>{
    const fromName=rawPackUnit(name||"");
    if(fromName&&fromName!=="Lốc")return {unit:fromName,evidence:"go_name"};
    const fromSlug=rawPackUnit(goSlugText(url));
    if(fromSlug&&fromSlug!=="Lốc")return {unit:fromSlug,evidence:"go_url"};
    const inferred=goProductClassUnit([name,goSlugText(url)].join(" "));
    return inferred?{unit:inferred,evidence:"go_product_class"}:{unit:"",evidence:""};
  };

  const cartonSource=/^thung\b/.test(namePlain)
    ?namePlain
    :(/^thung\b/.test(slugPlain)?slugPlain:"");
  if(cartonSource){
    const structural=cartonSource.replace(/^thung\s*/,"");
    const direct=structural.match(
      new RegExp("^([0-9]+(?:[.,][0-9]+)?)\\s*("+units+")\\b(?:\\s+([0-9]+(?:[.,][0-9]+)?)\\s*("+units+")\\b)?")
    );
    if(direct){
      const qtyA=validQty(direct[1]);
      const unitA=unitLabel(direct[2]);
      const qtyB=validQty(direct[3]);
      const unitB=direct[4]?unitLabel(direct[4]):"";
      if(qtyA&&unitA==="Lốc"){
        return {
          keep:true,reason:"",
          label1:"Thùng",qty1:1,
          label2:"Lốc",qty2:qtyA,
          label3:qtyB&&unitB?unitB:"",
          qty3:qtyB&&unitB?qtyB:0,
          evidence:/^thung\b/.test(namePlain)?"go_name":"go_url",
          locked:Boolean(qtyB&&unitB)
        };
      }
      if(qtyA&&unitA){
        return {
          keep:true,reason:"",
          label1:"Thùng",qty1:1,
          label2:"",qty2:0,
          label3:unitA,qty3:qtyA,
          evidence:/^thung\b/.test(namePlain)?"go_name":"go_url",
          locked:true
        };
      }
    }

    const qtyMatch=structural.match(/^([0-9]+(?:[.,][0-9]+)?)\b/);
    const qty=validQty(qtyMatch&&qtyMatch[1]);
    const leaf=explicitLeaf();
    if(qty&&leaf.unit){
      return {
        keep:true,reason:"",
        label1:"Thùng",qty1:1,
        label2:"",qty2:0,
        label3:leaf.unit,qty3:qty,
        evidence:leaf.evidence||"go_name",
        locked:true
      };
    }
    return {
      keep:true,reason:"",
      label1:"Thùng",qty1:1,
      label2:"",qty2:0,label3:"",qty3:0,
      evidence:/^thung\b/.test(namePlain)?"go_name":"go_url",
      locked:false
    };
  }

  const middleSource=/^loc\b/.test(namePlain)
    ?namePlain
    :(/^loc\b/.test(slugPlain)?slugPlain:"");
  if(middleSource){
    const match=middleSource.match(
      new RegExp("^loc\\s+([0-9]+(?:[.,][0-9]+)?)\\s*("+units+")\\b")
    );
    if(match){
      const qty=validQty(match[1]);
      const child=unitLabel(match[2]);
      if(qty&&child){
        return {
          keep:true,reason:"",
          label1:"",qty1:0,
          label2:"Lốc",qty2:1,
          label3:child,qty3:qty,
          evidence:/^loc\b/.test(namePlain)?"go_name":"go_url",
          locked:true
        };
      }
    }
  }

  const leaf=explicitLeaf();
  return {
    keep:true,reason:"",
    label1:"",qty1:0,label2:"",qty2:0,
    label3:leaf.unit,qty3:leaf.unit?1:0,
    evidence:leaf.evidence,
    locked:Boolean(leaf.unit)
  };
}

function goPackagingText(hierarchy){
  const h=hierarchy||{};
  if(h.label1==="Thùng"){
    if(h.label2){
      return cleanText(
        "Thùng "+(Number(h.qty2)||1)+" "+h.label2+
        (h.label3?" "+(Number(h.qty3)||1)+" "+h.label3:"")
      );
    }
    if(h.label3){
      return cleanText("Thùng "+(Number(h.qty3)||1)+" "+h.label3);
    }
    return "Thùng";
  }
  if(h.label2){
    return cleanText(h.label2+" "+(Number(h.qty3)||1)+" "+(h.label3||""));
  }
  return cleanText(h.label3||"");
}

async function persistGoResponse(env,job,requestId,raw){
  const response=raw&&raw.go_response||{};
  const inputUrl=canonicalGo(
    raw&&raw.input_url||
    job&&job.input_url||
    job&&job.canonical_url
  );
  const checked=String(
    raw&&raw.checked_at||
    response.checked_at||
    new Date().toISOString()
  );
  const taxonomy=await loadBhxTaxonomyForWinmart(env);
  const products=Array.isArray(response.products)?response.products:[];
  const normalized=[];
  const prepared=[];
  let mapped=0;
  let unmapped=0;

  const linkSql=
    "INSERT INTO links(id,canonical_url,source,link_type,parent_url,group_name,branch_name,name,packaging,current_price,original_price,promotion_price,promotion_text,last_checked_at,last_status,last_request_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "+
    "ON CONFLICT(canonical_url) DO UPDATE SET source=excluded.source,link_type='product',parent_url=excluded.parent_url,group_name=excluded.group_name,branch_name=COALESCE(NULLIF(excluded.branch_name,''),links.branch_name),name=COALESCE(NULLIF(excluded.name,''),links.name),packaging=excluded.packaging,current_price=COALESCE(excluded.current_price,links.current_price),original_price=excluded.original_price,promotion_price=excluded.promotion_price,promotion_text=excluded.promotion_text,last_checked_at=excluded.last_checked_at,last_status='ok',last_request_id=excluded.last_request_id,updated_at=excluded.updated_at";

  for(const rawProduct of products){
    const name=goCleanProductName(
      rawProduct&&(
        rawProduct.name||
        rawProduct.product_name||
        rawProduct.title
      )||""
    );
    const current=parseMoney(
      rawProduct&&(
        rawProduct.current_price||
        rawProduct.sale_price||
        rawProduct.price
      )
    );
    if(!name||!current)continue;

    let productUrl;
    try{
      productUrl=canonicalGo(
        new URL(
          String(rawProduct.url||rawProduct.link||""),
          inputUrl
        ).toString()
      );
    }catch{
      continue;
    }

    const originalRaw=parseMoney(
      rawProduct.original_price||
      rawProduct.list_price||
      rawProduct.base_price
    );
    const original=originalRaw&&originalRaw>current?originalRaw:null;
    const hierarchy=goPackHierarchy(name,productUrl);
    const packaging=goPackagingText(hierarchy);
    const compatibility=hierarchyPackCompatibility(hierarchy);
    const comparison=comparisonData({
      name,
      url:"",
      packagingText:packaging,
      featureText:cleanText(rawProduct.spec_text||""),
      packCount:compatibility.pack_quantity||1,
      packUnit:compatibility.pack_unit||"",
      current,
      sysPrice:original||current,
      discount:0,
      promoText:cleanText(rawProduct.promotion_text||""),
      hierarchy
    });

    const tax=matchBhxTaxonomyForGo({
      ...rawProduct,
      name,
      category_name:rawProduct.category_name||response.category_name||""
    },taxonomy);
    if(tax.parent_url)mapped+=1;
    else unmapped+=1;

    const brand=matchBhxBrandForWinmart(rawProduct,name,taxonomy);
    const image=String(rawProduct.image||rawProduct.image_url||"").trim();
    const promoText=cleanText(rawProduct.promotion_text||"");
    const id=await idForUrl(productUrl);
    const now=new Date().toISOString();

    prepared.push(
      env.DB.prepare(linkSql).bind(
        id,productUrl,"GO!","product",tax.parent_url,
        tax.group_name,brand,name,packaging,
        current,original,null,promoText,checked,"ok",requestId,now,now
      )
    );

    prepared.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO price_snapshots(link_id,request_id,checked_at,current_price,original_price,promotion_price,promotion_text,result_json) VALUES(?,?,?,?,?,?,?,?)"
      ).bind(
        id,requestId,checked,current,original,null,promoText,
        JSON.stringify({
          source:"GO!",
          store:"GO!",
          category:tax.group_name,
          taxonomy_evidence:tax.evidence,
          pack_evidence:hierarchy.evidence||""
        })
      )
    );

    if(image){
      prepared.push(
        env.DB.prepare(
          "INSERT INTO link_assets(link_url,image_url,updated_at) VALUES(?,?,?) ON CONFLICT(link_url) DO UPDATE SET image_url=excluded.image_url,updated_at=excluded.updated_at"
        ).bind(productUrl,image,checked)
      );
    }

    prepared.push(
      env.DB.prepare(
        "INSERT INTO link_comparison(link_url,pack_kind,pack_quantity,pack_unit,size_value,size_unit,regular_pack_price,promo_pack_price,regular_unit_price,promo_unit_price,promotion_active,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) "+
        "ON CONFLICT(link_url) DO UPDATE SET pack_kind=excluded.pack_kind,pack_quantity=excluded.pack_quantity,pack_unit=excluded.pack_unit,size_value=excluded.size_value,size_unit=excluded.size_unit,regular_pack_price=excluded.regular_pack_price,promo_pack_price=excluded.promo_pack_price,regular_unit_price=excluded.regular_unit_price,promo_unit_price=excluded.promo_unit_price,promotion_active=excluded.promotion_active,updated_at=excluded.updated_at"
      ).bind(
        productUrl,comparison.pack_kind||"",Number(comparison.pack_quantity)||1,
        comparison.pack_unit||"",comparison.size_value??null,comparison.size_unit||"",
        comparison.regular_pack_price??null,comparison.promo_pack_price??null,
        comparison.regular_unit_price??null,comparison.promo_unit_price??null,
        comparison.promotion_active?1:0,checked
      )
    );

    prepared.push(
      env.DB.prepare(
        "INSERT INTO link_pack_hierarchy(link_url,label1,qty1,label2,qty2,label3,qty3,evidence,updated_at) VALUES(?,?,?,?,?,?,?,?,?) "+
        "ON CONFLICT(link_url) DO UPDATE SET label1=excluded.label1,qty1=excluded.qty1,label2=excluded.label2,qty2=excluded.qty2,label3=excluded.label3,qty3=excluded.qty3,evidence=excluded.evidence,updated_at=excluded.updated_at"
      ).bind(
        productUrl,
        hierarchy.label1||"",Number(hierarchy.qty1)||0,
        hierarchy.label2||"",Number(hierarchy.qty2)||0,
        hierarchy.label3||"",Number(hierarchy.qty3)||0,
        hierarchy.evidence||"",checked
      )
    );

    prepared.push(sourceIdentityStatement(env,{
      link_url:productUrl,
      source_name:"GO!",
      source_product_id:rawProduct.product_id||"",
      source_code:"",
      barcode:rawProduct.barcode||"",
      sku:"",
      brand:rawProduct.brand||brand||"",
      category:rawProduct.category_name||tax.group_name||"",
      raw_name:rawProduct.source_name||rawProduct.name||name,
      raw_description:[
        rawProduct.spec_text,
        rawProduct.go_alias
      ].filter(Boolean).join(" · "),
      hierarchy,
      size:{
        value:comparison.size_value??null,
        unit:comparison.size_unit||""
      }
    },checked));

    normalized.push({
      source:{key:"go",name:"GO!",host:"sieuthi-go.vn"},
      store:null,
      group:tax.group_name,
      branch:brand,
      name,
      packaging:{text:packaging},
      hierarchy,
      comparison,
      price:{current,original},
      promotion:{active:false,price:null,text:promoText},
      url:productUrl,
      image,
      taxonomy_match:tax.evidence,
      go_category:cleanText(rawProduct.category_name||response.category_name||""),
      source_identity:{
        product_id:cleanText(rawProduct.product_id||""),
        barcode:cleanText(rawProduct.barcode||""),
        alias:cleanText(rawProduct.go_alias||"")
      },
      last_checked_at:checked
    });
  }

  for(let i=0;i<prepared.length;i+=60){
    await env.DB.batch(prepared.slice(i,i+60));
  }

  const categoryName=cleanText(
    response.category_name||
    slugTitle(inputUrl)||
    "GO!"
  );
  await upsertLink(env,{
    canonical_url:inputUrl,
    source:"GO!",
    link_type:"category",
    parent_url:null,
    group_name:categoryName,
    branch_name:"",
    name:categoryName,
    packaging:"",
    last_checked_at:checked,
    last_status:"ok",
    last_request_id:requestId
  });

  const payload={
    schema_version:30,
    request_id:requestId,
    input_url:inputUrl,
    input_type:"category",
    checked_at:checked,
    source:{key:"go",name:"GO!",host:"sieuthi-go.vn"},
    store:null,
    category_name:categoryName,
    products:normalized,
    variants:[],
    discovered_links:normalized.map(x=>x.url),
    child_count:normalized.length,
    mapped_to_bhx:mapped,
    unmapped_to_bhx:unmapped
  };
  const resultJson=JSON.stringify(payload);
  await env.DB.prepare(
    "UPDATE jobs SET link_type='category',status='complete',result_json=?,error=NULL,updated_at=? WHERE request_id=?"
  ).bind(resultJson,new Date().toISOString(),requestId).run();

  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first();
  return {
    payload,
    registry_count:Number(count&&count.n||0),
    mapped_to_bhx:mapped,
    unmapped_to_bhx:unmapped
  };
}

function winmartCacheIsComplete(payload){
  if(Number(payload&&payload.schema_version||0)<21)return false;
  const products=Array.isArray(payload&&payload.products)?payload.products:[];
  if(!products.length)return false;

  let realImages=0;
  for(const p of products){
    const image=String(p&&p.image||"").trim().toLowerCase();
    if(image&&
       !image.startsWith("data:")&&
       !image.startsWith("blob:")&&
       !image.includes("placeholder")&&
       !image.includes("transparent")){
      realImages+=1;
    }
  }

  // WinMart bulk ingestion is complete when the category API returned products
  // and normal image coverage is present. Listing-card unit is useful metadata,
  // but a missing unit must never force a detail-page crawl or endless refetch.
  return realImages>=Math.ceil(products.length*0.90);
}

async function handleCreate(request,env,origin){
  let body;
  try{body=await request.json();}
  catch{return json({error:"invalid_json"},400,origin);}

  let url;
  let sourceKey;
  try{
    url=canonicalSource(body.url);
    sourceKey=sourceKeyForUrl(url);
  }catch{
    return json({error:"unsupported_source_url"},400,origin);
  }

  const force=Boolean(body&&body.force);
  let cached=force?null:await loadFreshCache(env,url);
  if(
    cached&&sourceKey==="winmart"&&
    !winmartCacheIsComplete(cached.payload)
  ){
    cached=null;
  }
  if(cached){
    if(sourceKey==="bachhoaxanh"){
      await repairCachedGraph(env,cached.payload);
    }
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

  const initialParent=sourceKey==="bachhoaxanh"&&initialType==="product"
    ?sourceParentUrl(url)
    :null;

  if(initialParent){
    await ensureSourceParent(
      env,initialParent,"",requestId,now,"linked"
    );
  }

  await upsertLink(env,{
    canonical_url:url,
    source:sourceNameForKey(sourceKey),
    link_type:initialType,
    parent_url:initialParent,
    name:"",
    last_checked_at:now,
    last_status:"queued",
    last_request_id:requestId
  });

  // BHX uses its JSON APIs directly from the Worker.
  // No GitHub Action, Playwright or Bright Data is used for price ingestion.
  if(sourceKey==="bachhoaxanh"){
    try{
      await env.DB.prepare(
        "UPDATE jobs SET status='running',error=NULL,updated_at=? WHERE request_id=?"
      ).bind(new Date().toISOString(),requestId).run();
      await env.DB.prepare(
        "UPDATE links SET last_status='running',updated_at=? WHERE canonical_url=?"
      ).bind(new Date().toISOString(),url).run();

      const direct=await fetchBhxDirect(
        env,url,requestId
      );
      const saved=await persistPayload(
        env,direct.payload
      );
      return json({
        request_id:requestId,
        status:"complete",
        input_url:url,
        link_type:direct.kind,
        ...saved,
        engine:"bhx-direct-worker",
        response_url:direct.response_url,
        direct_count:direct.direct_count||null,
        cache_hit:false
      },200,origin);
    }catch(error){
      const detail=String(
        error&&error.message||error
      ).slice(0,1200);
      await env.DB.prepare(
        "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
      ).bind(detail,new Date().toISOString(),requestId).run();
      await env.DB.prepare(
        "UPDATE links SET last_status='error',updated_at=? WHERE canonical_url=?"
      ).bind(new Date().toISOString(),url).run();
      return json({
        error:"bhx_direct_failed",
        detail,
        request_id:requestId
      },502,origin);
    }
  }

  // WinMart no longer needs GitHub Actions, Playwright or Bright Data.
  // Its public category API already returns name + source type + price
  // for the whole category, and supports pageSize=500.
  if(sourceKey==="winmart"){
    try{
      await env.DB.prepare(
        "UPDATE jobs SET status='running',updated_at=? WHERE request_id=?"
      ).bind(new Date().toISOString(),requestId).run();
      await env.DB.prepare(
        "UPDATE links SET last_status='running',updated_at=? WHERE canonical_url=?"
      ).bind(new Date().toISOString(),url).run();

      const raw=await fetchWinmartDirect(url);
      raw.request_id=requestId;
      const saved=await persistWinmartResponse(
        env,
        {input_url:url,canonical_url:url},
        requestId,
        raw
      );
      return json({
        request_id:requestId,
        status:"complete",
        input_url:url,
        link_type:"category",
        ...saved,
        engine:"winmart-direct-worker",
        cache_hit:false
      },200,origin);
    }catch(error){
      const detail=String(
        error&&error.message||error
      ).slice(0,1200);
      await env.DB.prepare(
        "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
      ).bind(detail,new Date().toISOString(),requestId).run();
      await env.DB.prepare(
        "UPDATE links SET last_status='error',updated_at=? WHERE canonical_url=?"
      ).bind(new Date().toISOString(),url).run();
      return json({
        error:"winmart_direct_failed",
        detail,
        request_id:requestId
      },502,origin);
    }
  }

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
    const r=await dispatchGithub(
      env,browserSourceUrl(url),requestId,sourceKey
    );
    if(!r.ok){
      const detail=(await r.text()).slice(0,900);
      throw new Error("github_dispatch_"+r.status+":"+detail);
    }

    return json({
      request_id:requestId,
      status:"queued",
      input_url:url,
      link_type:initialType,
      engine:sourceKey==="go"?"brightdata-browser-go":"brightdata-browser-api"
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


async function handleProgress(request,env){
  if(!callbackAuthorized(request,env)){
    return json({error:"unauthorized"},401,"");
  }

  let raw;
  try{raw=await request.json();}
  catch{return json({error:"invalid_json"},400,"");}

  const id=String(raw&&raw.request_id||"")
    .replace(/[^A-Za-z0-9_-]/g,"");
  const stage=String(raw&&raw.stage||"").trim().toLowerCase();
  const allowed=new Set(["runner","brightdata","saving"]);
  if(!id)return json({error:"missing_request_id"},400,"");
  if(!allowed.has(stage))return json({error:"invalid_stage"},400,"");

  const job=await env.DB.prepare(
    "SELECT canonical_url FROM jobs WHERE request_id=?"
  ).bind(id).first();
  if(!job)return json({error:"not_found"},404,"");

  const now=new Date().toISOString();
  await env.DB.prepare(
    "UPDATE jobs SET status=?,updated_at=? WHERE request_id=?"
  ).bind(stage,now,id).run();
  await env.DB.prepare(
    "UPDATE links SET last_status=?,updated_at=? WHERE canonical_url=?"
  ).bind(stage,now,job.canonical_url).run();

  return json({status:stage,request_id:id,updated_at:now},200,"");
}

async function handleComplete(request,env){
  if(!callbackAuthorized(request,env)){
    return json({error:"unauthorized"},401,"");
  }

  try{
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

  if(raw.winmart_response){
    const saved=await persistWinmartResponse(env,job,id,raw);
    return json({
      status:"complete",
      ...saved,
      engine:raw.engine||"brightdata-browser-winmart",
      country:raw.country||""
    },200,"");
  }

  if(raw.go_response){
    const saved=await persistGoResponse(env,job,id,raw);
    return json({
      status:"complete",
      ...saved,
      engine:raw.engine||"brightdata-browser-go",
      country:raw.country||""
    },200,"");
  }

  if(!raw.bhx_response||!raw.bhx_response.data){
    return json({error:"missing_source_response"},400,"");
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
  }catch(error){
    const detail=String(error&&error.stack||error&&error.message||error).slice(0,1800);
    return json({
      error:"complete_failed",
      detail
    },500,"");
  }
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

      if(raw.winmart_response){
        const saved=await persistWinmartResponse(env,job,id,raw);
        return json({
          status:"complete",
          ...saved,
          engine:raw.engine||"brightdata-browser-winmart",
          country:raw.country||""
        },200,origin);
      }

      if(raw.go_response){
        const saved=await persistGoResponse(env,job,id,raw);
        return json({
          status:"complete",
          ...saved,
          engine:raw.engine||"brightdata-browser-go",
          country:raw.country||""
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



async function getPreference(env,url){
  const row=await env.DB.prepare(
    "SELECT state,auto_refresh,refresh_hours,pinned,updated_at FROM link_preferences WHERE link_url=?"
  ).bind(url).first();
  return row||{
    state:"normal",
    auto_refresh:0,
    refresh_hours:24,
    pinned:0,
    updated_at:""
  };
}

async function setPreference(env,url,state,refreshHours){
  const normalized=canonicalSource(url);
  const allowed=new Set(["normal","watch","hidden"]);
  if(!allowed.has(state))throw new Error("invalid_preference_state");

  const hours=state==="watch"
    ?Math.min(168,Math.max(1,Number(refreshHours)||6))
    :24;
  const auto=state==="watch"?1:0;
  const now=new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO link_preferences(
      link_url,state,auto_refresh,refresh_hours,pinned,created_at,updated_at
    ) VALUES(?,?,?,?,0,?,?)
    ON CONFLICT(link_url) DO UPDATE SET
      state=excluded.state,
      auto_refresh=excluded.auto_refresh,
      refresh_hours=excluded.refresh_hours,
      updated_at=excluded.updated_at
  `).bind(normalized,state,auto,hours,now,now).run();

  return getPreference(env,normalized);
}

async function handlePreference(request,env,origin){
  let body;
  try{body=await request.json();}
  catch{return json({error:"invalid_json"},400,origin);}

  let url;
  try{url=canonicalSource(body.url);}
  catch{return json({error:"invalid_source_url"},400,origin);}

  const link=await env.DB.prepare(
    "SELECT canonical_url FROM links WHERE canonical_url=? LIMIT 1"
  ).bind(url).first();
  if(!link)return json({error:"link_not_found"},404,origin);

  const state=String(body.state||"normal");
  const preference=await setPreference(
    env,url,state,body.refresh_hours
  );
  return json({ok:true,url,preference},200,origin);
}

async function queueDueRefreshes(env,limit=10){
  const max=Math.min(20,Math.max(1,Number(limit)||10));
  const rows=await env.DB.prepare(`
    SELECT
      l.canonical_url,l.link_type,l.last_checked_at,
      p.refresh_hours
    FROM link_preferences p
    JOIN links l ON l.canonical_url=p.link_url
    WHERE p.state='watch'
      AND p.auto_refresh=1
      AND COALESCE(l.last_status,'')<>'unlisted'
      AND (
        l.last_checked_at IS NULL OR
        datetime(l.last_checked_at) <= datetime(
          'now','-' || CAST(p.refresh_hours AS TEXT) || ' hours'
        )
      )
      AND NOT EXISTS(
        SELECT 1 FROM jobs j
        WHERE j.canonical_url=l.canonical_url
          AND j.status IN ('queued','running')
          AND datetime(j.updated_at) > datetime('now','-2 hours')
      )
    ORDER BY COALESCE(l.last_checked_at,'1970-01-01') ASC
    LIMIT ?
  `).bind(max).all();

  const queued=[];
  const errors=[];
  for(const row of rows.results||[]){
    const requestId=crypto.randomUUID().replace(/-/g,"");
    const now=new Date().toISOString();
    try{
      await env.DB.prepare(`
        INSERT INTO jobs(
          request_id,input_url,canonical_url,link_type,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?)
      `).bind(
        requestId,row.canonical_url,row.canonical_url,
        row.link_type||heuristicType(row.canonical_url),
        "queued",now,now
      ).run();

      const sourceKey=sourceKeyForUrl(row.canonical_url);
      const r=await dispatchGithub(
        env,browserSourceUrl(row.canonical_url),requestId,sourceKey
      );
      if(!r.ok){
        const detail=(await r.text()).slice(0,500);
        throw new Error("github_dispatch_"+r.status+":"+detail);
      }

      await env.DB.prepare(
        "UPDATE links SET last_status='queued',last_request_id=?,updated_at=? WHERE canonical_url=?"
      ).bind(requestId,now,row.canonical_url).run();

      queued.push({
        url:row.canonical_url,
        request_id:requestId,
        refresh_hours:Number(row.refresh_hours)||6
      });
    }catch(error){
      const detail=String(error&&error.message||error).slice(0,700);
      await env.DB.prepare(
        "UPDATE jobs SET status='error',error=?,updated_at=? WHERE request_id=?"
      ).bind(detail,new Date().toISOString(),requestId).run();
      errors.push({url:row.canonical_url,error:detail});
    }
  }
  return {queued,errors};
}

async function handleRefreshDue(request,env){
  if(!callbackAuthorized(request,env)){
    return json({error:"unauthorized"},401,"");
  }
  let body={};
  try{body=await request.json();}catch{}
  const result=await queueDueRefreshes(env,body.limit||10);
  return json({
    ok:true,
    queued_count:result.queued.length,
    error_count:result.errors.length,
    ...result
  },200,"");
}

async function handleCleanupIngestionRules(request,env){
  if(!callbackAuthorized(request,env)){
    return json({error:"unauthorized"},401,"");
  }

  const result=await env.DB.prepare(`
    SELECT canonical_url,source,name,packaging,last_status
    FROM links
    WHERE link_type='product'
      AND COALESCE(last_status,'')<>'unlisted'
    ORDER BY updated_at DESC
    LIMIT 5000
  `).all();

  const rejected=[];
  const reasons={};
  for(const row of result.results||[]){
    if(String(row.source||"")!=="Bách Hóa XANH")continue;
    const identity=getlinkProductIdentity(
      row.name||"",
      row.canonical_url||"",
      row.packaging||""
    );
    if(identity.keep)continue;
    rejected.push({
      url:row.canonical_url,
      name:row.name||"",
      reason:identity.reason||"filtered"
    });
    reasons[identity.reason||"filtered"]=(reasons[identity.reason||"filtered"]||0)+1;
  }

  const now=new Date().toISOString();
  for(let i=0;i<rejected.length;i+=40){
    const chunk=rejected.slice(i,i+40);
    const statements=[];
    for(const item of chunk){
      statements.push(
        env.DB.prepare(
          "UPDATE links SET last_status='unlisted',updated_at=? WHERE canonical_url=?"
        ).bind(now,item.url)
      );
      statements.push(
        env.DB.prepare(
          "DELETE FROM link_comparison WHERE link_url=?"
        ).bind(item.url)
      );
      statements.push(
        env.DB.prepare(
          "DELETE FROM link_pack_hierarchy WHERE link_url=?"
        ).bind(item.url)
      );
    }
    if(statements.length)await env.DB.batch(statements);
  }

  return json({
    ok:true,
    scanned:Number(result.results&&result.results.length||0),
    unlisted:rejected.length,
    reasons,
    sample:rejected.slice(0,25)
  },200,"");
}

async function handleRebuildIdentities(request,env){
  if(!callbackAuthorized(request,env)){
    return json({error:"unauthorized"},401,"");
  }

  const rows=await env.DB.prepare(`
    SELECT
      l.canonical_url,l.source,l.group_name,l.branch_name,l.name,l.packaging,
      cmp.size_value,cmp.size_unit,
      h.label1,h.qty1,h.label2,h.qty2,h.label3,h.qty3
    FROM links l
    LEFT JOIN source_product_identity i
      ON i.link_url=l.canonical_url
    LEFT JOIN link_comparison cmp
      ON cmp.link_url=l.canonical_url
    LEFT JOIN link_pack_hierarchy h
      ON h.link_url=l.canonical_url
    WHERE l.link_type='product'
      AND COALESCE(l.last_status,'')<>'unlisted'
      AND TRIM(COALESCE(l.name,''))<>''
    ORDER BY l.updated_at DESC
    LIMIT 6000
  `).all();

  const statements=[];
  const now=new Date().toISOString();
  for(const row of rows.results||[]){
    statements.push(sourceIdentityStatement(env,{
      link_url:row.canonical_url,
      source_name:row.source||"",
      source_product_id:"",
      source_code:"",
      barcode:"",
      sku:"",
      brand:row.branch_name||"",
      category:row.group_name||"",
      raw_name:row.name||"",
      raw_description:row.packaging||"",
      hierarchy:{
        label1:row.label1||"",qty1:Number(row.qty1)||0,
        label2:row.label2||"",qty2:Number(row.qty2)||0,
        label3:row.label3||"",qty3:Number(row.qty3)||0
      },
      size:{
        value:row.size_value??null,
        unit:row.size_unit||""
      }
    },now));
  }

  for(let i=0;i<statements.length;i+=40){
    await env.DB.batch(statements.slice(i,i+40));
  }

  const total=await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM source_product_identity"
  ).first();

  return json({
    ok:true,
    backfilled:statements.length,
    source_identities:Number(total&&total.n||0)
  },200,"");
}

async function handleImageRefreshTargets(request,env){
  if(!callbackAuthorized(request,env)){
    return json({error:"unauthorized"},401,"");
  }

  const requestUrl=new URL(request.url);
  const mode=String(requestUrl.searchParams.get("mode")||"all").toLowerCase();

  if(mode==="missing"){
    const missing=await env.DB.prepare(`
      SELECT l.canonical_url AS url
      FROM links l
      LEFT JOIN link_assets a ON a.link_url=l.canonical_url
      WHERE l.link_type='product'
        AND COALESCE(l.last_status,'')<>'unlisted'
        AND (a.image_url IS NULL OR TRIM(a.image_url)='')
      ORDER BY l.canonical_url
    `).all();

    const targets=(missing.results||[])
      .map(row=>String(row.url||"").trim())
      .filter(Boolean)
      .map(url=>({url,kind:"product"}));

    return json({
      ok:true,
      mode:"missing",
      target_count:targets.length,
      targets
    },200,"");
  }

  const categories=await env.DB.prepare(`
    SELECT DISTINCT parent_url AS url
    FROM links
    WHERE link_type='product'
      AND parent_url IS NOT NULL
      AND TRIM(parent_url)<>''
      AND COALESCE(last_status,'')<>'unlisted'
    ORDER BY parent_url
  `).all();

  const standalone=await env.DB.prepare(`
    SELECT canonical_url AS url
    FROM links
    WHERE link_type='product'
      AND (parent_url IS NULL OR TRIM(parent_url)='')
      AND COALESCE(last_status,'')<>'unlisted'
    ORDER BY canonical_url
  `).all();

  const seen=new Set();
  const targets=[];
  for(const row of categories.results||[]){
    const url=String(row.url||"").trim();
    if(!url||seen.has(url))continue;
    seen.add(url);
    targets.push({url,kind:"category"});
  }
  for(const row of standalone.results||[]){
    const url=String(row.url||"").trim();
    if(!url||seen.has(url))continue;
    seen.add(url);
    targets.push({url,kind:"product"});
  }

  return json({
    ok:true,
    mode:"all",
    target_count:targets.length,
    targets
  },200,"");
}

async function handleImageRefresh(request,env){
  if(!callbackAuthorized(request,env)){
    return json({error:"unauthorized"},401,"");
  }

  let raw;
  try{raw=await request.json();}
  catch{return json({error:"invalid_json"},400,"");}

  if(!raw||raw.status==="error"){
    return json({
      error:"source_error",
      detail:String(raw&&raw.detail||raw&&raw.error||"scrape_failed").slice(0,700)
    },400,"");
  }
  if(!raw.bhx_response||!raw.bhx_response.data){
    return json({error:"missing_bhx_response"},400,"");
  }

  const inputUrl=String(raw.input_url||"").trim();
  if(!inputUrl)return json({error:"missing_input_url"},400,"");

  const kind=raw.kind==="product"?"product":"category";
  const refreshId="image-refresh-"+Date.now();
  const normalized=kind==="product"
    ?productDetailPayload(inputUrl,refreshId,raw.bhx_response.data)
    :categoryPayload(inputUrl,refreshId,raw.bhx_response.data);

  const items=kind==="product"
    ?[normalized.product].filter(Boolean)
    :(Array.isArray(normalized.products)?normalized.products:[]);

  let updated=0;
  let missing=0;
  for(const item of items){
    const url=String(item&&item.url||"").trim();
    const image=String(item&&item.image||"").trim();
    if(!url||!image){
      missing+=1;
      continue;
    }
    await persistLinkAsset(
      env,canonicalBhx(url),image,
      item.last_checked_at||normalized.checked_at||new Date().toISOString()
    );
    updated+=1;
  }

  return json({
    ok:true,
    input_url:inputUrl,
    kind,
    discovered:items.length,
    updated,
    missing
  },200,"");
}

function isCategoryRootUrl(value){
  try{return pathParts(canonicalBhx(value)).length===1;}
  catch{return false;}
}

async function handleLibrary(url,env,origin){
  const view=String(url.searchParams.get("view")||"groups");
  const limit=Math.min(10000,Math.max(1,Number(url.searchParams.get("limit")||500)));

  if(view==="groups"){
    const categories=await env.DB.prepare(
      "SELECT l.canonical_url,l.name,l.group_name,l.updated_at,COALESCE(p.state,'normal') AS preference_state FROM links l LEFT JOIN link_preferences p ON p.link_url=l.canonical_url WHERE l.link_type='category' AND COALESCE(p.state,'normal')<>'hidden' ORDER BY l.updated_at DESC LIMIT 300"
    ).all();

    const productParents=await env.DB.prepare(
      "SELECT l.parent_url,MAX(l.group_name) AS group_name,COUNT(*) AS product_count,MAX(l.updated_at) AS updated_at FROM links l LEFT JOIN link_preferences p ON p.link_url=l.canonical_url WHERE l.link_type='product' AND l.parent_url IS NOT NULL AND TRIM(COALESCE(l.name,''))<>'' AND COALESCE(l.current_price,l.promotion_price) IS NOT NULL AND COALESCE(l.last_status,'')<>'unlisted' AND COALESCE(p.state,'normal')<>'hidden' GROUP BY l.parent_url ORDER BY updated_at DESC LIMIT 500"
    ).all();

    const map=new Map();
    for(const row of categories.results||[]){
      if(!isCategoryRootUrl(row.canonical_url))continue;
      map.set(row.canonical_url,{
        url:row.canonical_url,
        name:cleanText(row.name||row.group_name||slugTitle(row.canonical_url)),
        product_count:0,
        updated_at:row.updated_at||""
      });
    }
    for(const row of productParents.results||[]){
      if(!row.parent_url||!isCategoryRootUrl(row.parent_url))continue;
      const previous=map.get(row.parent_url);
      map.set(row.parent_url,{
        url:row.parent_url,
        name:cleanText(
          row.group_name||
          (previous&&previous.name)||
          slugTitle(row.parent_url)
        ),
        product_count:Number(row.product_count)||0,
        updated_at:String(
          (previous&&previous.updated_at)>row.updated_at
            ?previous.updated_at
            :row.updated_at||previous&&previous.updated_at||""
        )
      });
    }
    const groups=Array.from(map.values())
      .filter(x=>Number(x.product_count)>0)
      .sort((a,b)=>a.name.localeCompare(b.name,"vi"));
    return json({groups},200,origin);
  }

  if(view==="products"||view==="search"){
    let parent="";
    const q=cleanText(url.searchParams.get("q")||"");
    const includeHidden=url.searchParams.get("include_hidden")==="1";
    const stateFilter=String(url.searchParams.get("state")||"");
    if(view==="products"){
      try{parent=canonicalBhx(url.searchParams.get("parent")||"");}
      catch{return json({error:"invalid_parent"},400,origin);}
    }

    let sql=`
      SELECT
        l.id,l.canonical_url,l.parent_url,l.source,l.group_name,l.branch_name,
        l.branch_name AS brand_name,l.name,
        ident.category AS source_category_name,
        (
          SELECT c.name
          FROM links c
          WHERE c.source='WinMart'
            AND c.link_type='category'
            AND c.last_request_id=l.last_request_id
          ORDER BY c.updated_at DESC
          LIMIT 1
        ) AS source_root_name,
        l.packaging,l.current_price,l.original_price,l.promotion_price,
        l.promotion_text,l.last_checked_at,l.last_status,l.updated_at,
        COALESCE(pref.state,'normal') AS preference_state,
        COALESCE(pref.auto_refresh,0) AS auto_refresh,
        COALESCE(pref.refresh_hours,24) AS refresh_hours,
        cmp.pack_kind,cmp.pack_quantity,cmp.pack_unit,
        cmp.size_value,cmp.size_unit,
        cmp.regular_pack_price,cmp.promo_pack_price,
        cmp.regular_unit_price,cmp.promo_unit_price,
        cmp.promotion_active,
        h.label1 AS pack_label_1,
        h.qty1 AS pack_qty_1,
        h.label2 AS pack_label_2,
        h.qty2 AS pack_qty_2,
        h.label3 AS pack_label_3,
        h.qty3 AS pack_qty_3,
        h.evidence AS pack_evidence,
        ident.source_product_id,ident.source_code,ident.barcode,ident.sku,
        ident.raw_name AS source_raw_name,
        ident.raw_description AS source_raw_description,
        ident.match_key,ident.match_basis,
        asset.image_url AS image,
        COALESCE(cmp.promo_unit_price,cmp.regular_unit_price) AS unit_price,
        COALESCE(cmp.promotion_active,0) AS has_promo,
        NULL AS carton_price,
        NULL AS carton_sys_price,
        NULL AS carton_quantity,
        NULL AS carton_unit,
        NULL AS retail_price,
        NULL AS retail_unit
      FROM links l
      LEFT JOIN link_preferences pref
        ON pref.link_url=l.canonical_url
      LEFT JOIN link_assets asset
        ON asset.link_url=l.canonical_url
      LEFT JOIN link_comparison cmp
        ON cmp.link_url=l.canonical_url
      LEFT JOIN link_pack_hierarchy h
        ON h.link_url=l.canonical_url
      LEFT JOIN source_product_identity ident
        ON ident.link_url=l.canonical_url
      WHERE l.link_type='product'
        AND TRIM(COALESCE(l.name,''))<>''
        AND COALESCE(l.current_price,l.promotion_price) IS NOT NULL
        AND COALESCE(l.last_status,'')<>'unlisted'
    `;
    const binds=[];
    if(!includeHidden){
      sql+=" AND COALESCE(pref.state,'normal')<>'hidden'";
    }
    if(stateFilter==="watch"||stateFilter==="hidden"||stateFilter==="normal"){
      sql+=" AND COALESCE(pref.state,'normal')=?";
      binds.push(stateFilter);
    }
    if(parent){
      sql+=" AND l.parent_url=?";
      binds.push(parent);
    }
    if(q){
      sql+=" AND (l.name LIKE ? OR l.group_name LIKE ? OR l.branch_name LIKE ? OR l.packaging LIKE ?)";
      const like="%"+q+"%";
      binds.push(like,like,like,like);
    }
    sql+=" ORDER BY l.name COLLATE NOCASE ASC,l.updated_at DESC LIMIT ?";
    binds.push(limit);

    const result=await env.DB.prepare(sql).bind(...binds).all();
    let products=(result.results||[]).map(row=>{
      const isWinmart=String(row.source||"").toLowerCase().includes("winmart");
      let hierarchy;
      let fresh;

      if(isWinmart){
        // RAW ONLY: WinMart type stays in links.packaging. Never classify it
        // into Thùng/Giữa/Lẻ inside the ingestion/library layer.
        hierarchy=winmartRawHierarchy();
        fresh=winmartRawComparison(
          row.name||"",
          row.current_price||row.promotion_price||0
        );
      }else{
        // BHX keeps the established three-level parser.
        hierarchy=packHierarchyData(
          row.name||"",row.canonical_url||"",row.packaging||"",
          row.pack_quantity||1,row.pack_unit||""
        );
        fresh=comparisonData({
          name:row.name||"",
          url:row.canonical_url||"",
          packagingText:row.packaging||"",
          featureText:"",
          packCount:row.pack_quantity||1,
          packUnit:row.pack_unit||"",
          current:row.current_price,
          sysPrice:row.original_price||row.current_price,
          discount:0,
          promoText:row.promotion_text||"",
          hierarchy
        });
      }
      return {
        ...row,
        pack_label_1:hierarchy.label1||"",
        pack_qty_1:Number(hierarchy.qty1)||0,
        pack_label_2:hierarchy.label2||"",
        pack_qty_2:Number(hierarchy.qty2)||0,
        pack_label_3:hierarchy.label3||"",
        pack_qty_3:Number(hierarchy.qty3)||0,
        pack_evidence:hierarchy.evidence||"",
        hierarchy_locked:hierarchy.locked?1:0,
        web_carton_price:fresh.regular_carton_price,
        promo_carton_price:fresh.promo_carton_price,
        web_middle_price:fresh.regular_middle_price,
        promo_middle_price:fresh.promo_middle_price,
        web_leaf_price:fresh.regular_leaf_price,
        promo_leaf_price:fresh.promo_leaf_price,
        promo_pack_price:fresh.promo_pack_price,
        promo_unit_price:fresh.promo_unit_price,
        promotion_active:fresh.promotion_active?1:0,
        has_promo:fresh.promotion_active?1:0,
        unit_price:fresh.promo_unit_price||fresh.regular_unit_price,
        quantity_offer_active:fresh.quantity_offer_active?1:0,
        quantity_offer_min_packs:fresh.quantity_offer_min_packs,
        quantity_offer_total_price:fresh.quantity_offer_total_price
      };
    });
    return json({products},200,origin);
  }

  if(view==="matches"){
    const rows=await env.DB.prepare(`
      SELECT
        i.link_url,i.source_name,i.source_product_id,i.source_code,i.barcode,i.sku,
        i.brand,i.category,i.raw_name,i.raw_description,
        i.size_value,i.size_unit,
        i.pack_label_1,i.pack_qty_1,i.pack_label_2,i.pack_qty_2,
        i.pack_label_3,i.pack_qty_3,
        i.match_name,i.match_key,i.match_basis,
        l.name,l.current_price,l.original_price,l.promotion_price,l.parent_url
      FROM source_product_identity i
      JOIN links l ON l.canonical_url=i.link_url
      WHERE TRIM(COALESCE(i.match_key,''))<>''
        AND l.link_type='product'
        AND COALESCE(l.last_status,'')<>'unlisted'
      ORDER BY i.match_key,i.source_name,i.link_url
      LIMIT 6000
    `).all();

    const grouped=new Map();
    for(const row of rows.results||[]){
      const key=String(row.match_key||"");
      if(!key)continue;
      if(!grouped.has(key)){
        grouped.set(key,{
          match_key:key,
          match_basis:row.match_basis||"",
          items:[],
          sources:new Set()
        });
      }
      const group=grouped.get(key);
      group.sources.add(row.source_name||"");
      group.items.push(row);
    }

    const matches=[...grouped.values()]
      .filter(group=>group.sources.size>=2)
      .map(group=>({
        match_key:group.match_key,
        match_basis:group.match_basis,
        source_count:group.sources.size,
        item_count:group.items.length,
        items:group.items
      }))
      .sort((a,b)=>b.source_count-a.source_count||b.item_count-a.item_count);

    return json({
      matches,
      match_group_count:matches.length,
      rule:"barcode exact; otherwise strict brand + size + normalized name"
    },200,origin);
  }

  if(view==="item"){
    let itemUrl;
    try{itemUrl=canonicalSource(url.searchParams.get("url")||"");}
    catch{return json({error:"invalid_url"},400,origin);}

    const cached=await env.DB.prepare(
      "SELECT result_json,updated_at FROM jobs WHERE canonical_url=? AND status='complete' AND result_json IS NOT NULL ORDER BY updated_at DESC LIMIT 1"
    ).bind(itemUrl).first();
    if(cached&&cached.result_json){
      try{
        const payload=JSON.parse(cached.result_json);
        const isWinmartPayload=String(
          payload&&payload.source&&payload.source.key||""
        )==="winmart";
        const usableWinmart=!isWinmartPayload||winmartCacheIsComplete(payload);
        if(Number(payload&&payload.schema_version||0)>=20&&usableWinmart){
          const preference=await getPreference(env,itemUrl);
          return json({
            status:"complete",
            payload,
            source:"d1-library",
            updated_at:cached.updated_at||"",
            preference
          },200,origin);
        }
      }catch{}
    }

    // Library fallback is also one-link/one-result only. Never rebuild a
    // product detail from product_variants because those rows can be
    // temporary sibling choices from an older BHX response.
    const row=await env.DB.prepare(`
      SELECT
        l.*,
        a.image_url AS stored_image,
        cmp.pack_kind AS cmp_pack_kind,
        cmp.pack_quantity AS cmp_pack_quantity,
        cmp.pack_unit AS cmp_pack_unit,
        cmp.size_value AS cmp_size_value,
        cmp.size_unit AS cmp_size_unit,
        cmp.regular_pack_price AS cmp_regular_pack_price,
        cmp.promo_pack_price AS cmp_promo_pack_price,
        cmp.regular_unit_price AS cmp_regular_unit_price,
        cmp.promo_unit_price AS cmp_promo_unit_price,
        cmp.promotion_active AS cmp_promotion_active,
        h.label1 AS pack_label_1,
        h.qty1 AS pack_qty_1,
        h.label2 AS pack_label_2,
        h.qty2 AS pack_qty_2,
        h.label3 AS pack_label_3,
        h.qty3 AS pack_qty_3,
        h.evidence AS pack_evidence
      FROM links l
      LEFT JOIN link_assets a ON a.link_url=l.canonical_url
      LEFT JOIN link_comparison cmp ON cmp.link_url=l.canonical_url
      LEFT JOIN link_pack_hierarchy h ON h.link_url=l.canonical_url
      WHERE l.canonical_url=?
      LIMIT 1
    `).bind(itemUrl).first();
    if(!row)return json({error:"not_found"},404,origin);

    const rowIsWinmart=String(row.source||"").toLowerCase().includes("winmart");
    const mainHierarchy=rowIsWinmart
      ?winmartRawHierarchy()
      :packHierarchyData(
          row.name||"",itemUrl,row.packaging||"",
          row.cmp_pack_quantity||1,row.cmp_pack_unit||""
        );
    const mainComparison=rowIsWinmart
      ?winmartRawComparison(
          row.name||"",
          row.current_price||row.promotion_price||0
        )
      :comparisonData({
          name:row.name||"",
          url:itemUrl,
          packagingText:row.packaging||"",
          featureText:"",
          packCount:row.cmp_pack_quantity||1,
          packUnit:row.cmp_pack_unit||"",
          current:row.current_price,
          sysPrice:row.original_price||row.current_price,
          discount:0,
          promoText:row.promotion_text||"",
          hierarchy:mainHierarchy
        });

    const main={
      source:String(row.source||"").toLowerCase().includes("winmart")
        ?{key:"winmart",name:"WinMart",host:"winmart.vn"}
        :(String(row.source||"").toLowerCase().includes("go")
          ?{key:"go",name:"GO!",host:"sieuthi-go.vn"}
          :{key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"}),
      group:row.group_name||"",
      branch:row.branch_name||"",
      name:row.name||slugTitle(itemUrl),
      packaging:{text:row.packaging||""},
      hierarchy:mainHierarchy,
      comparison:mainComparison,
      price:{current:row.current_price||null,original:row.original_price||null},
      promotion:{
        active:Boolean(mainComparison.promotion_active),
        price:mainComparison.promo_pack_price||null,
        text:mainComparison.promotion_text||""
      },
      url:itemUrl,
      image:row.stored_image||"",
      last_checked_at:row.last_checked_at||""
    };
    const preference=await getPreference(env,itemUrl);
    return json({
      status:"complete",
      source:"d1-library",
      preference,
      payload:{
        schema_version:20,
        request_id:row.last_request_id||"",
        input_url:itemUrl,
        input_type:"product",
        checked_at:row.last_checked_at||"",
        category_name:row.group_name||"",
        product:main,
        products:[main],
        variants:[],
        discovered_links:[]
      }
    },200,origin);
  }

  return json({error:"invalid_view"},400,origin);
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
    binds.push(canonicalSource(parent));
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
        return await handleCreate(request,env,origin||"*");
      }
      if(request.method==="POST"&&url.pathname==="/api/progress"){
        return handleProgress(request,env);
      }
      if(request.method==="POST"&&url.pathname==="/api/complete"){
        return handleComplete(request,env);
      }
      if(request.method==="POST"&&url.pathname==="/api/preference"){
        return handlePreference(request,env,origin||"*");
      }
      if(request.method==="POST"&&url.pathname==="/api/refresh-due"){
        return handleRefreshDue(request,env);
      }
      if(request.method==="POST"&&url.pathname==="/api/cleanup-ingestion-rules"){
        return handleCleanupIngestionRules(request,env);
      }
      if(request.method==="POST"&&url.pathname==="/api/rebuild-identities"){
        return handleRebuildIdentities(request,env);
      }
      if(request.method==="GET"&&url.pathname==="/api/image-refresh-targets"){
        return handleImageRefreshTargets(request,env);
      }
      if(request.method==="POST"&&url.pathname==="/api/image-refresh"){
        return handleImageRefresh(request,env);
      }
      if(request.method==="GET"&&url.pathname==="/api/result"){
        return handleResult(url,env,origin||"*");
      }
      if(request.method==="GET"&&url.pathname==="/api/library"){
        return handleLibrary(url,env,origin||"*");
      }
      if(request.method==="GET"&&url.pathname==="/api/links"){
        return handleLinks(url,env,origin||"*");
      }
      if(request.method==="GET"&&url.pathname==="/health"){
        const count=await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM links"
        ).first();
        const identityCount=await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM source_product_identity"
        ).first();
        return json({
          ok:true,
          mode:"bhx-winmart-direct-go-browser",
          dispatcher:Boolean(env.GITHUB_TOKEN),
          links:Number(count&&count.n||0),
          source_identities:Number(identityCount&&identityCount.n||0)
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
