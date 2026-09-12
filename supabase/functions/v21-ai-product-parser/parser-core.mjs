function clean(value){
  return String(value??'').replace(/\s+/g,' ').trim();
}

function normalize(value){
  return String(value??'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/đ/gi,'d')
    .toLowerCase()
    .replace(/\s+/g,' ')
    .trim();
}

function numberValue(value){
  const n=Number(String(value??'').replace(',','.'));
  return Number.isFinite(n)&&n>0?n:null;
}

function quantityText(value){
  const n=numberValue(value);
  if(n==null)return '1';
  return Number.isInteger(n)?String(n):String(Math.round(n*100)/100);
}

function upperFirst(value){
  const text=clean(value);
  if(!text)return '';
  return text.slice(0,1).toLocaleUpperCase('vi-VN')+text.slice(1);
}

const UNIT='(?:t|th|thùng|thung|bao|ba0|bịch|bich|gói|goi|chai|lốc|loc|hộp|hop|cây|cay|lon|khay|túi|tui)';
const startUnit=new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})\\s+(.+)$`,'iu');
const endUnit=new RegExp(`^(.+?)\\s+(?:x\\s*)?(\\d+(?:[.,]\\d+)?)(?:\\s*(${UNIT}))?$`,'iu');

function looksLikeUnseparatedMultiItem(productName){
  const tokens=normalize(productName).split(/\s+/).filter(Boolean);
  const bareNumbers=tokens.filter(token=>/^\d+(?:[.,]\d+)?$/.test(token));
  if(bareNumbers.length<2)return false;
  const last=tokens[tokens.length-1]||'';
  return /[a-z]/.test(last)&&!/^\d/.test(last);
}

function finalize(quantity,name){
  const q=numberValue(quantity);
  const productName=upperFirst(name);
  if(q==null||!productName||looksLikeUnseparatedMultiItem(productName))return null;
  return {quantity:q,productName,line:`${quantityText(q)} ${productName}`};
}

function parseSegmentDetailed(raw){
  const text=clean(raw);
  if(!text||text.includes('=')||text.includes(':'))return null;

  let match=text.match(startUnit);
  if(match)return finalize(match[1],match[3]);

  match=text.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/u);
  if(match)return finalize(match[1],match[2]);

  match=text.match(endUnit);
  if(match)return finalize(match[2],match[1]);

  return null;
}

export function splitCustomerSegments(value){
  return String(value??'')
    .replace(/\r\n?/g,'\n')
    .split(/\s*(?:\/|;|\n|,(?!\d))\s*/u)
    .map(part=>part.trim())
    .filter(Boolean);
}

export function parseCustomerTextDetailed(value){
  const lines=[];
  for(const segment of splitCustomerSegments(value)){
    const parsed=parseSegmentDetailed(segment);
    if(parsed)lines.push(parsed);
  }
  return {lines,confirmations:[]};
}

export function parseCustomerText(value){
  return parseCustomerTextDetailed(value).lines;
}
