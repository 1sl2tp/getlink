export type InputOnlyItem={
  rawText:string;
  productName:string;
  quantity:number;
  unitHint:string|null;
};

export type InputOnlyResult={
  kind:"order"|"silent";
  items:InputOnlyItem[];
  reply:string;
};

const UNIT_DISPLAY:Record<string,string>={
  thung:"thùng",hop:"hộp",goi:"gói",bich:"bịch",tui:"túi",cay:"cây",chai:"chai",lon:"lon",loc:"lốc",khay:"khay",
};
const UNIT_KEYS=Object.keys(UNIT_DISPLAY).join("|");
const clean=(value:unknown)=>String(value??"").replace(/\s+/g," ").trim();
const normalize=(value:unknown)=>String(value??"")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/đ/gi,"d")
  .toLowerCase()
  .replace(/\s+/g," ")
  .trim();
const quantity=(value:string)=>Number(value.replace(",","."));
const q=(value:number)=>Number.isInteger(value)?String(value):String(Math.round(value*100)/100);

function parseLine(value:unknown):InputOnlyItem|null{
  const rawText=clean(value);
  if(!rawText||rawText.includes("=")||rawText.includes("\n"))return null;
  const n=normalize(rawText);

  let match=n.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_KEYS})\\s+(.+)$`,"i"));
  if(match){
    const amount=quantity(match[1]);
    if(amount>0)return {rawText,productName:clean(match[3]),quantity:amount,unitHint:UNIT_DISPLAY[match[2]]||match[2]};
  }

  match=n.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/i);
  if(match){
    const amount=quantity(match[1]);
    if(amount>0)return {rawText,productName:clean(match[2]),quantity:amount,unitHint:null};
  }

  match=n.match(new RegExp(`^(.+?)\\s+(?:x\\s*)?(\\d+(?:[.,]\\d+)?)(?:\\s+(${UNIT_KEYS}))?$`,"i"));
  if(match){
    const amount=quantity(match[2]);
    if(amount>0)return {rawText,productName:clean(match[1]),quantity:amount,unitHint:match[3]?UNIT_DISPLAY[match[3]]||match[3]:null};
  }

  return null;
}

function looksLikeUnseparatedMultiItem(productName:string):boolean{
  const tokens=normalize(productName).split(/\s+/).filter(Boolean);
  const bareNumbers=tokens.filter(token=>/^\d+(?:[.,]\d+)?$/.test(token));
  if(bareNumbers.length<2)return false;
  const last=tokens[tokens.length-1]||"";
  return /[a-z]/.test(last)&&!/^\d/.test(last);
}

function format(item:InputOnlyItem):string{
  return `${clean(item.productName)} × ${q(item.quantity)}${item.unitHint?` ${item.unitHint}`:""}`;
}

export function parseInputOnly(value:unknown):InputOnlyResult{
  const original=String(value??"").replace(/\r\n?/g,"\n").trim();
  if(!original||original.includes("=")||original.includes(":"))return {kind:"silent",items:[],reply:""};

  const explicitSeparator=/(?:\/|;|\n|,(?!\d))/u;
  if(explicitSeparator.test(original)){
    const chunks=original.split(/\s*(?:\/|;|\n|,(?!\d))\s*/u).map(clean).filter(Boolean);
    if(chunks.length<2)return {kind:"silent",items:[],reply:""};
    const parsed=chunks.map(parseLine);
    if(parsed.some(item=>!item))return {kind:"silent",items:[],reply:""};
    const items=parsed as InputOnlyItem[];
    return {kind:"order",items,reply:items.map(format).join("\n")};
  }

  const item=parseLine(original);
  if(!item||looksLikeUnseparatedMultiItem(item.productName))return {kind:"silent",items:[],reply:""};
  return {kind:"order",items:[item],reply:format(item)};
}
