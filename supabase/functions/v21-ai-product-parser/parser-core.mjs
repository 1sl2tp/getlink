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

// Explicit numeric-leading names. These are parsing exceptions only; no catalog/data lookup happens here.
const NUMERIC_NAME_PREFIXES=['555','3 mien','7 up'];

function numericNamePrefix(value){
  const text=normalize(value);
  for(const prefix of NUMERIC_NAME_PREFIXES){
    if(text===prefix||text.startsWith(`${prefix} `))return prefix;
  }
  return null;
}

function nameRemainderAfterNumericPrefix(value){
  const text=normalize(value);
  const prefix=numericNamePrefix(text);
  if(!prefix)return text;
  return text.slice(prefix.length).trim();
}

function looksLikeUnseparatedMultiItem(productName){
  const tokens=nameRemainderAfterNumericPrefix(productName).split(/\s+/).filter(Boolean);
  for(let i=0;i<tokens.length-1;i++){
    if(!/^\d+(?:[.,]\d+)?$/.test(tokens[i]))continue;
    if(tokens.slice(i+1).some(token=>/[a-z]/i.test(token)))return true;
  }
  return false;
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

  // If a segment starts with a known numeric-leading name, that leading number belongs to the name.
  // It only becomes an order line when a separate quantity exists at the end.
  if(numericNamePrefix(text)){
    const match=text.match(endUnit);
    if(!match||!numericNamePrefix(match[1]))return null;
    return finalize(match[2],match[1]);
  }

  let match=text.match(startUnit);
  if(match)return finalize(match[1],match[3]);

  match=text.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/u);
  if(match)return finalize(match[1],match[2]);

  match=text.match(endUnit);
  if(match)return finalize(match[2],match[1]);

  return null;
}

export function splitCustomerSegments(value){
  const text=String(value??'').replace(/\r\n?/g,'\n');
  const parts=[];
  let buffer='';

  for(let i=0;i<text.length;i++){
    const char=text[i];
    const simpleSeparator=char==='/'||char===';'||char==='\n';
    const decimalComma=char===','&&/\d/.test(text[i-1]||'')&&/\d/.test(text[i+1]||'');
    const commaSeparator=char===','&&!decimalComma;

    if(simpleSeparator||commaSeparator){
      const part=buffer.trim();
      if(part)parts.push(part);
      buffer='';
      continue;
    }
    buffer+=char;
  }

  const tail=buffer.trim();
  if(tail)parts.push(tail);
  return parts;
}

export function parseCustomerTextDetailed(value){
  const original=String(value??'').replace(/\r\n?/g,'\n').trim();
  if(!original||original.includes('=')||original.includes(':'))return {lines:[],confirmations:[]};

  const segments=splitCustomerSegments(original);
  if(!segments.length)return {lines:[],confirmations:[]};

  const lines=[];
  for(const segment of segments){
    const parsed=parseSegmentDetailed(segment);
    if(!parsed)return {lines:[],confirmations:[]};
    lines.push(parsed);
  }
  return {lines,confirmations:[]};
}

export function parseCustomerText(value){
  return parseCustomerTextDetailed(value).lines;
}
