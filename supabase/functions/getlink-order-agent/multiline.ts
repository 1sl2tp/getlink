export type OrderFragment={
  index:number;
  rawText:string;
  quantity:number|null;
  rawProductText:string;
  unitHint:string|null;
};

const LEADING_UNITS:Record<string,string>={
  bich:"bịch",
  bịch:"bịch",
  tui:"túi",
  goi:"gói",
  hop:"hộp",
  chai:"chai",
  lon:"lon",
  loc:"lốc",
  thung:"thùng",
  cay:"cây",
  bao:"bao",
};

function clean(value:unknown):string{
  return String(value??"").replace(/\s+/g," ").trim();
}

function normalizeUnit(value:string):string{
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/gi,"d").toLowerCase();
}

function parseFragment(rawText:string,index:number):OrderFragment{
  const raw=clean(rawText);
  const quantityMatch=raw.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/u);
  if(!quantityMatch){
    return {index,rawText:raw,quantity:null,rawProductText:raw,unitHint:null};
  }
  const quantity=Number(quantityMatch[1].replace(",","."));
  let productText=clean(quantityMatch[2]);
  let unitHint:string|null=null;
  const first=productText.match(/^(\S+)\s+(.+)$/u);
  if(first){
    const unit=LEADING_UNITS[normalizeUnit(first[1])];
    if(unit){
      unitHint=unit;
      productText=clean(first[2]);
    }
  }
  return {
    index,
    rawText:raw,
    quantity:Number.isFinite(quantity)&&quantity>0?quantity:null,
    rawProductText:productText,
    unitHint,
  };
}

export function segmentOrderMessage(text:unknown):OrderFragment[]{
  const raw=String(text??"").replace(/\r\n?/g,"\n");
  const parts:string[]=[];
  for(const physicalLine of raw.split("\n")){
    const line=clean(physicalLine.replace(/^\s*[-•*]+\s*/u,""));
    if(!line)continue;
    const chunks=line.split(/,\s+(?=\d+(?:\.\d+)?\s+)/u).map(clean).filter(Boolean);
    parts.push(...chunks);
  }
  return parts.map((part,index)=>parseFragment(part,index));
}
