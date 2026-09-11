import { normalizeCustomerText } from "./normalize.ts";
import type { OrderFragment } from "./multiline.ts";

export type DeterministicOrderFamily=
  |"sua_chua"|"probi_to"|"probi_be"|"thuoc_la"|"milo"
  |"mi_chinh"|"hoa_my_pham"|"dau_an"|null;

export type DeterministicOrderContext={
  family:DeterministicOrderFamily;
};

export type DeterministicOrderItem={
  lookupText:string;
  quantity:number;
  unitHint:string|null;
};

export type DeterministicOrderParse={
  items:DeterministicOrderItem[];
  unresolved:string[];
  context:DeterministicOrderContext;
};

export type DeterministicFragmentReason=
  |"not_in_catalog"|"ambiguous"|"size_mismatch"|"needs_owner_confirmation"|"other";

export type DeterministicFragmentParse={
  kind:"resolved"|"unresolved";
  rawText:string;
  rawProductText:string;
  quantity:number|null;
  unitHint:string|null;
  lookupText:string|null;
  reason:DeterministicFragmentReason|null;
  context:DeterministicOrderContext;
};

export function emptyOrderContext():DeterministicOrderContext{
  return {family:null};
}

function cleanRaw(value:unknown):string{
  return String(value??"").replace(/\s+/g," ").trim();
}

function validQuantity(value:unknown):number|null{
  const quantity=Number(String(value??"").replace(",","."));
  return Number.isFinite(quantity)&&quantity>0?quantity:null;
}

function item(lookupText:string,quantity:number,unitHint:string|null=null):DeterministicOrderItem{
  return {lookupText,quantity,unitHint};
}

function result(
  items:DeterministicOrderItem[],
  context:DeterministicOrderContext,
  raw:string,
):DeterministicOrderParse{
  return {items,unresolved:items.length?[]:[raw],context};
}

function resolvedFragment(
  fragment:OrderFragment,
  lookupText:string,
  family:Exclude<DeterministicOrderFamily,null>,
):DeterministicFragmentParse{
  return {
    kind:"resolved",
    rawText:fragment.rawText,
    rawProductText:fragment.rawProductText,
    quantity:fragment.quantity,
    unitHint:fragment.unitHint,
    lookupText,
    reason:null,
    context:{family},
  };
}

function unresolvedFragment(
  fragment:OrderFragment,
  family:DeterministicOrderFamily,
  reason:DeterministicFragmentReason,
):DeterministicFragmentParse{
  return {
    kind:"unresolved",
    rawText:fragment.rawText,
    rawProductText:fragment.rawProductText,
    quantity:fragment.quantity,
    unitHint:fragment.unitHint,
    lookupText:null,
    reason,
    context:{family},
  };
}

export function parseDeterministicOrderFragment(
  fragment:OrderFragment,
  prior:DeterministicOrderContext=emptyOrderContext(),
):DeterministicFragmentParse{
  const normalized=normalizeCustomerText(fragment.rawProductText);
  const priorFamily=prior?.family??null;

  if(!normalized||!fragment.quantity){
    return unresolvedFragment(fragment,priorFamily,"other");
  }

  if(normalized==="huong duong"){
    return unresolvedFragment(fragment,priorFamily,"not_in_catalog");
  }

  const bat=normalized.match(/^bat\s+(.+)$/u);
  if(bat){
    const size=bat[1].replace(/\s+/g,"");
    if(size==="1kg"||size==="1")return resolvedFragment(fragment,"Mi chinh bat 1","mi_chinh");
    if(size==="454"||size==="454g")return resolvedFragment(fragment,"Mi chinh bat 454","mi_chinh");
    if(size==="1.8kg"||size==="1,8kg")return unresolvedFragment(fragment,"mi_chinh","size_mismatch");
    return unresolvedFragment(fragment,"mi_chinh","needs_owner_confirmation");
  }

  const omo=normalized.match(/^omo\s+(.+)$/u);
  if(omo){
    const size=omo[1].replace(/\s+/g,"");
    const names:Record<string,string>={
      "1.15kg":"Bot giat omo 1.15kg",
      "5.5kg":"Bot giat omo 5.5kg",
      "5.1kg":"Bot giat omo 5.1kg",
      "2.9kg":"Bot giat omo 2.9kg",
      "2.6kg":"Bot giat omo 2.6kg",
      "700g":"Bot giat omo 700g",
      "380g":"Bot giat omo 380g",
    };
    const lookup=names[size];
    return lookup
      ?resolvedFragment(fragment,lookup,"hoa_my_pham")
      :unresolvedFragment(fragment,"hoa_my_pham","needs_owner_confirmation");
  }

  const lan=normalized.match(/^cai\s+lan\s+(1|5)(?:l)?$/u);
  if(lan)return resolvedFragment(fragment,`Dau lan ${lan[1]}`,"dau_an");

  const meizan=normalized.match(/^meizan\s+(1|5)(?:l)?$/u);
  if(meizan)return resolvedFragment(fragment,`Dau zan ${meizan[1]}`,"dau_an");

  const gao=normalized.match(/^gao\s+2(?:l)?$/u);
  if(gao){
    return priorFamily==="dau_an"
      ?resolvedFragment(fragment,"Dau sim gao 2","dau_an")
      :unresolvedFragment(fragment,priorFamily,"needs_owner_confirmation");
  }

  const nep=normalized.match(/^nep\s+2(?:l)?$/u);
  if(nep){
    return priorFamily==="dau_an"
      ?resolvedFragment(fragment,"Dau nep 2","dau_an")
      :unresolvedFragment(fragment,priorFamily,"needs_owner_confirmation");
  }

  return unresolvedFragment(fragment,priorFamily,"not_in_catalog");
}

function probiVariantLookup(family:"probi_to"|"probi_be",variant:string):string|null{
  const prefix=family==="probi_to"?"Sua probi to":"Sua probi be";
  if(["co","co duong","trang"].includes(variant))return `${prefix} trang`;
  if(["it","it duong"].includes(variant))return `${prefix} mau - it`;
  if(["vq","viet quat"].includes(variant))return `${prefix} mau - viet quat`;
  if(["dau"].includes(variant))return `${prefix} mau - dâu`;
  if(family==="probi_be"&&["dua","dua thom"].includes(variant))return `${prefix} mau - dứa`;
  if(family==="probi_be"&&["dua gang"].includes(variant))return `${prefix} mau - dưa gang`;
  return null;
}

function parseProbi(raw:string,normalized:string):DeterministicOrderParse|null{
  const head=normalized.match(/^probi\s+(to|be)\s*:?[\s]*(.*)$/u);
  if(!head)return null;
  const family:DeterministicOrderContext={family:head[1]==="to"?"probi_to":"probi_be"};
  const tail=head[2].trim();
  if(!tail)return {items:[],unresolved:[raw],context:family};
  const items:DeterministicOrderItem[]=[];
  const unresolved:string[]=[];
  for(const part of tail.split(/\s*,\s*/u).filter(Boolean)){
    const m=part.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/u);
    const quantity=m?validQuantity(m[1]):null;
    const variant=m?.[2]?.trim()||"";
    const lookup=quantity?probiVariantLookup(family.family as "probi_to"|"probi_be",variant):null;
    if(quantity&&lookup)items.push(item(lookup,quantity,"thùng"));
    else unresolved.push(part);
  }
  return {items,unresolved,context:family};
}

function yogurtLookup(variant:string):string|null{
  if(["khong","khong duong","ko","ko duong"].includes(variant))return "Sua chua khong";
  if(["it","it duong"].includes(variant))return "Sua chua it";
  if(["co","co duong"].includes(variant))return "Sua chua co";
  if(["nha dam","nha dam co","nha dam co duong"].includes(variant))return "Sua chua nha dam co";
  if(["nha dam it","nha dam it duong"].includes(variant))return "Sua chua nha dam it";
  return null;
}

function parseYogurt(raw:string,normalized:string,context:DeterministicOrderContext):DeterministicOrderParse|null{
  let m=normalized.match(/^(\d+(?:[.,]\d+)?)\s+(?:sua\s+)?chua\s+(.+)$/u);
  if(m){
    const quantity=validQuantity(m[1]);
    const lookup=quantity?yogurtLookup(m[2].trim()):null;
    const next={family:"sua_chua" as const};
    return lookup&&quantity?result([item(lookup,quantity,"thùng")],next,raw):result([],next,raw);
  }
  if(context.family!=="sua_chua")return null;
  m=normalized.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/u);
  if(!m)return null;
  const quantity=validQuantity(m[1]);
  const lookup=quantity?yogurtLookup(m[2].trim()):null;
  return lookup&&quantity?result([item(lookup,quantity,"thùng")],context,raw):null;
}

function parseTobacco(raw:string,normalized:string):DeterministicOrderParse|null{
  const patterns:Array<[RegExp,string]>=[
    [/^(\d+(?:[.,]\d+)?)\s+thang\s+long\s+mem$/u,"Mềm"],
    [/^(\d+(?:[.,]\d+)?)\s+thang\s+long\s+cung$/u,"Cứng"],
    [/^(\d+(?:[.,]\d+)?)\s+thang\s+long\s+det$/u,"Dẹt"],
    [/^(\d+(?:[.,]\d+)?)\s+sai\s+gon\s+xanh$/u,"SG xanh"],
    [/^(\d+(?:[.,]\d+)?)\s+sai\s+gon\s+bac$/u,"SG bạc"],
    [/^(\d+(?:[.,]\d+)?)\s+sai\s+gon\s+(?:dua|melon)$/u,"SG melon"],
    [/^(\d+(?:[.,]\d+)?)\s+sai\s+gon\s+dao$/u,"SG đào"],
  ];
  for(const [pattern,lookup] of patterns){
    const m=normalized.match(pattern);
    const quantity=m?validQuantity(m[1]):null;
    if(quantity)return result([item(lookup,quantity,"cây")],{family:"thuoc_la"},raw);
  }
  return null;
}

function parseMilo(raw:string,normalized:string):DeterministicOrderParse|null{
  const m=normalized.match(/^(\d+(?:[.,]\d+)?)\s+(?:sua\s+)?milo\s+(.+)$/u);
  if(!m)return null;
  const quantity=validQuantity(m[1]);
  if(!quantity)return result([],{family:"milo"},raw);
  const variant=m[2].trim();
  if(["it duong to","to it duong","to it"].includes(variant)){
    return result([item("Sua milo to it",quantity,"thùng")],{family:"milo"},raw);
  }
  if(["co duong to","to co duong","to"].includes(variant)){
    return result([item("Sua milo to",quantity,"thùng")],{family:"milo"},raw);
  }
  if(["be","be co duong"].includes(variant)){
    return result([item("Sua milo be",quantity,"thùng")],{family:"milo"},raw);
  }
  return result([],{family:"milo"},raw);
}

export function parseCustomerOrderText(
  text:unknown,
  prior:DeterministicOrderContext=emptyOrderContext(),
):DeterministicOrderParse{
  const raw=cleanRaw(text);
  const normalized=normalizeCustomerText(raw);
  const context:DeterministicOrderContext={family:prior?.family??null};
  if(!normalized)return {items:[],unresolved:[],context};

  return parseProbi(raw,normalized)
    ??parseYogurt(raw,normalized,context)
    ??parseTobacco(raw,normalized)
    ??parseMilo(raw,normalized)
    ??{items:[],unresolved:[raw],context};
}
