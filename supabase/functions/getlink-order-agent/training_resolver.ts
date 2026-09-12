import { normalizeCustomerText } from "./normalize.ts";

export type TrainingCatalogItem={productCode:string;productName:string};
export type TrainingAlias={aliasNormalized:string;productCode:string;scope?:"customer"|"store"};
export type TrainingResolution={productCode:string;productName:string;source:"customer_alias"|"store_alias"|"canonical"|"fuzzy"};
export type SimpleOrderLine={rawText:string;productText:string;quantity:number;unitHint:string|null};

const GENERIC_TOKENS=new Set([
  "mi","bia","dau","an","sua","banh","nuoc","bot","tuong","xuc","xich","keo","mam","nem","cf","ca","chai","lon","hop","goi","bich","tui","thung",
]);
const UNIT_DISPLAY:Record<string,string>={
  thung:"thùng",hop:"hộp",goi:"gói",bich:"bịch",tui:"túi",cay:"cây",chai:"chai",lon:"lon",loc:"lốc",khay:"khay",
};
const UNIT_KEYS=Object.keys(UNIT_DISPLAY).join("|");

function clean(value:unknown):string{return String(value??"").replace(/\s+/g," ").trim();}
function normalized(value:unknown):string{return normalizeCustomerText(value).replace(/[×]/g,"x");}
function compact(value:unknown):string{return normalized(value).replace(/[^a-z0-9]+/g,"");}
function numberValue(value:string):number{return Number(value.replace(",","."));}
function numericTokens(value:unknown):string[]{return normalized(value).match(/\d+(?:[.,]\d+)?/g)?.map(v=>v.replace(",","."))||[];}
function wordTokens(value:unknown):string[]{
  return normalized(value)
    .replace(/(\d+(?:[.,]\d+)?)\s*(kg|ml|g|l)\b/g,"$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
function distinctiveTokens(value:unknown):string[]{return wordTokens(value).filter(t=>!GENERIC_TOKENS.has(t)&&!/^\d/.test(t)&&!["kg","ml","g","l"].includes(t));}

function levenshtein(a:string,b:string):number{
  if(a===b)return 0;
  if(!a.length)return b.length;
  if(!b.length)return a.length;
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let left=i,diag=row[0];row[0]=i;
    for(let j=1;j<=b.length;j++){
      const up=row[j];
      const next=Math.min(up+1,left+1,diag+(a[i-1]===b[j-1]?0:1));
      diag=up;row[j]=next;left=next;
    }
  }
  return row[b.length];
}

function prefixRelated(a:string,b:string):boolean{
  return Math.min(a.length,b.length)>=3&&(a.startsWith(b)||b.startsWith(a));
}

function candidateScore(query:string,item:TrainingCatalogItem):number{
  const q=normalized(query),k=normalized(item.productName);
  if(!q||!k)return 0;
  if(q===k)return 1;
  const qc=compact(q),kc=compact(k);
  if(qc===kc)return .99;
  const dist=levenshtein(qc,kc),ratio=dist/Math.max(qc.length,kc.length,1);
  let score=ratio<=.18?.91:0;

  const qWords=distinctiveTokens(q),kWords=distinctiveTokens(k);
  const qNums=numericTokens(q),kNums=numericTokens(k);
  const numberMatch=!kNums.length||kNums.every(n=>qNums.includes(n));
  let wordMatches=0;
  for(const kt of kWords){
    if(qWords.some(qt=>qt===kt||prefixRelated(qt,kt))||kt.length>=4&&qc.includes(kt))wordMatches++;
  }
  if(kWords.length&&wordMatches){
    const coverage=wordMatches/kWords.length;
    let lexical=.62+.22*coverage;
    if(numberMatch&&kNums.length)lexical+=.09;
    if(!numberMatch&&kNums.length)lexical-=.22;
    score=Math.max(score,Math.min(.96,lexical));
  }
  return score;
}

function catalogByCode(catalog:TrainingCatalogItem[],code:string):TrainingCatalogItem|null{
  return catalog.find(row=>String(row.productCode)===String(code))||null;
}

export function rankTrainingCandidates(rawText:string,catalog:TrainingCatalogItem[],limit=12):Array<TrainingCatalogItem&{score:number}>{
  return catalog
    .map(row=>({...row,score:candidateScore(rawText,row)}))
    .filter(row=>row.score>0)
    .sort((a,b)=>b.score-a.score||a.productName.localeCompare(b.productName,"vi"))
    .slice(0,Math.max(1,limit));
}

export function resolveTrainingProduct(rawText:string,catalog:TrainingCatalogItem[],aliases:TrainingAlias[]=[]):TrainingResolution|null{
  const q=normalized(rawText);
  if(!q)return null;
  const alias=aliases.find(row=>normalized(row.aliasNormalized)===q);
  if(alias){
    const product=catalogByCode(catalog,alias.productCode);
    if(product)return {productCode:product.productCode,productName:product.productName,source:alias.scope==="store"?"store_alias":"customer_alias"};
  }

  const exact=catalog.filter(row=>normalized(row.productName)===q||compact(row.productName)===compact(q));
  if(exact.length===1)return {productCode:exact[0].productCode,productName:exact[0].productName,source:"canonical"};
  if(exact.length>1)return null;

  const ranked=rankTrainingCandidates(q,catalog,3);
  if(!ranked.length||ranked[0].score<.82)return null;
  if(ranked.length>1&&ranked[1].score>=.82&&Math.abs(ranked[0].score-ranked[1].score)<.06)return null;
  return {productCode:ranked[0].productCode,productName:ranked[0].productName,source:"fuzzy"};
}

export function parseSimpleOrderLine(value:unknown):SimpleOrderLine|null{
  const rawText=clean(value);
  if(!rawText||rawText.includes("=")||rawText.includes("\n"))return null;
  const unitPattern=new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_KEYS})\\s+(.+)$`,"i");
  const normalizedRaw=normalized(rawText);
  let match=normalizedRaw.match(unitPattern);
  if(match){
    const quantity=numberValue(match[1]);
    if(quantity>0)return {rawText,productText:clean(match[3]),quantity,unitHint:UNIT_DISPLAY[match[2].toLowerCase()]||match[2]};
  }
  match=normalizedRaw.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/i);
  if(match){
    const quantity=numberValue(match[1]);
    if(quantity>0)return {rawText,productText:clean(match[2]),quantity,unitHint:null};
  }
  const endUnit=new RegExp(`^(.+?)\\s+(?:x\\s*)?(\\d+(?:[.,]\\d+)?)(?:\\s+(${UNIT_KEYS}))?$`,"i");
  match=normalizedRaw.match(endUnit);
  if(match){
    const quantity=numberValue(match[2]);
    if(quantity>0)return {rawText,productText:clean(match[1]),quantity,unitHint:match[3]?UNIT_DISPLAY[match[3].toLowerCase()]||match[3]:null};
  }
  return null;
}

function exactCatalog(value:string,catalog:TrainingCatalogItem[]):TrainingCatalogItem|null{
  const q=normalized(value),qc=compact(value);
  const rows=catalog.filter(row=>normalized(row.productName)===q||compact(row.productName)===qc);
  return rows.length===1?rows[0]:null;
}

export function resolveTeachingEquation(value:unknown,catalog:TrainingCatalogItem[]):{aliasDisplay:string;aliasNormalized:string;productCode:string;productName:string}|null{
  const raw=clean(value),parts=raw.split("=").map(clean).filter(Boolean);
  if(parts.length!==2)return null;
  const left=exactCatalog(parts[0],catalog),right=exactCatalog(parts[1],catalog);
  if(Boolean(left)===Boolean(right))return null;
  const product=left||right!;
  const aliasDisplay=left?parts[1]:parts[0];
  const aliasNormalized=normalized(aliasDisplay);
  if(!aliasNormalized||aliasNormalized===normalized(product.productName))return null;
  return {aliasDisplay,aliasNormalized,productCode:product.productCode,productName:product.productName};
}
