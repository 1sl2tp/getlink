import type { ParsedIntent } from "./types.ts";
import { normalizeCustomerText } from "./normalize.ts";

export const TURN_DEBOUNCE_MS=4000;
export const ROUND_STEP=5;
export const ROUND_MAX_GAP=3;

const CONFIRM = new Set(["ok","oke","oki","dong y","dung","dung roi","chot","chot nhe","chot nha"]);
const DECLINE = new Set(["thoi","khong","ko","k","khong can","thoi em","khong lay them"]);
const UNIT_MAP:Record<string,string>={
  thung:"thùng",cay:"cây",loc:"lốc",hop:"hộp",goi:"gói",bich:"bịch",chai:"chai",lon:"lon",tui:"túi",cai:"cái",
};

export function nextRoundSuggestion(cartonEquivalent: number): {target:number;gap:number}|null {
  const current=Number(cartonEquivalent);
  if(!Number.isFinite(current)||current<5)return null;
  const target=Math.ceil((current+Number.EPSILON)/ROUND_STEP)*ROUND_STEP;
  const effectiveTarget=target<=current?target+ROUND_STEP:target;
  const gap=effectiveTarget-current;
  if(gap<1||gap>ROUND_MAX_GAP)return null;
  return {target:effectiveTarget,gap};
}

function quantityFromTail(text:string): {name:string;quantity:number;unit:string|null}|null {
  const match=text.match(/^(.*?)(?:\s+)(\d+(?:[.,]\d+)?)\s*(thung|cay|loc|hop|goi|bich|chai|lon|tui|cai)?$/u);
  if(!match)return null;
  const quantity=Number(match[2].replace(",","."));
  const name=match[1].trim();
  if(!name||!Number.isFinite(quantity)||quantity<=0)return null;
  return {name,quantity,unit:match[3]?UNIT_MAP[match[3]]||match[3]:null};
}

export function parseFastCommand(text:unknown): ParsedIntent|null {
  const raw=String(text??"").trim();
  const normalized=normalizeCustomerText(raw);
  if(!normalized)return null;
  if(CONFIRM.has(normalized))return {
    intent:"confirm",raw_product_text:"",quantity:null,unit_hint:null,attributes:{},line_note:"",
    reference_target:null,needs_clarification:false,
  };
  if(DECLINE.has(normalized))return {
    intent:"decline",raw_product_text:"",quantity:null,unit_hint:null,attributes:{},line_note:"",
    reference_target:null,needs_clarification:false,
  };

  const priceMatch=normalized.match(/^(?:gia\s+)?(.+?)(?:\s+hom nay)?\s*(?:bao nhieu|gia|\?)$/u);
  if(priceMatch?.[1])return {
    intent:"price_query",raw_product_text:priceMatch[1].trim(),quantity:null,unit_hint:null,attributes:{},line_note:"",
    reference_target:null,needs_clarification:false,
  };

  const listMatch=normalized.match(/^(?:gui|bao)\s+(?:gia|bang gia)(?:\s+(.+))?$/u);
  if(listMatch)return {
    intent:"price_list",raw_product_text:(listMatch[1]||"toan bo").trim(),quantity:null,unit_hint:null,attributes:{},line_note:"",
    reference_target:null,needs_clarification:false,
  };

  const qty=quantityFromTail(normalized);
  if(qty)return {
    intent:"add_item",raw_product_text:qty.name,quantity:qty.quantity,unit_hint:qty.unit,attributes:{},line_note:"",
    reference_target:null,needs_clarification:false,
  };
  return null;
}
