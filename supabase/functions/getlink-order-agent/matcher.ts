import { normalizeCustomerText } from "./normalize.ts";
import type { ProductResolution, ResolutionSource } from "./types.ts";

export const STORE_ALIAS_PROMOTION_CUSTOMERS=3;

const RANK:Record<ResolutionSource,number>={
  customer_alias:0,
  store_alias:1,
  canonical:2,
  fuzzy:3,
  llm:4,
  clarification:5,
  admin_edit:6,
};

export function resolutionSourceRank(source:ResolutionSource):number{
  return RANK[source] ?? 99;
}

function productResolution(row:any,source:ResolutionSource,confidence:number):ProductResolution{
  if(!row?.product_code)return null;
  return {
    productCode:String(row.product_code),
    productName:String(row.product_name||row.alias_display||row.product_code),
    confidence,
    source,
  };
}

export async function resolveProduct(
  db:any,
  customerId:string,
  rawText:string,
):Promise<ProductResolution>{
  const q=normalizeCustomerText(rawText);
  if(!q)return null;

  const {data:customerAlias}=await db.from("getlink_ai_product_aliases")
    .select("product_code,alias_display,getlink_supplier_products!inner(product_name,is_active,stock_status)")
    .eq("scope","customer")
    .eq("customer_account_id",customerId)
    .eq("alias_normalized",q)
    .maybeSingle();
  if(customerAlias?.product_code){
    const p=Array.isArray(customerAlias.getlink_supplier_products)
      ?customerAlias.getlink_supplier_products[0]
      :customerAlias.getlink_supplier_products;
    if(p?.is_active!==false&&String(p?.stock_status||"")!=="inactive"){
      return productResolution({product_code:customerAlias.product_code,product_name:p?.product_name||customerAlias.alias_display},"customer_alias",1);
    }
  }

  const {data:storeAlias}=await db.from("getlink_ai_product_aliases")
    .select("product_code,alias_display,getlink_supplier_products!inner(product_name,is_active,stock_status)")
    .eq("scope","store")
    .eq("alias_normalized",q)
    .maybeSingle();
  if(storeAlias?.product_code){
    const p=Array.isArray(storeAlias.getlink_supplier_products)
      ?storeAlias.getlink_supplier_products[0]
      :storeAlias.getlink_supplier_products;
    if(p?.is_active!==false&&String(p?.stock_status||"")!=="inactive"){
      return productResolution({product_code:storeAlias.product_code,product_name:p?.product_name||storeAlias.alias_display},"store_alias",0.99);
    }
  }

  const {data:exactCode}=await db.from("getlink_supplier_products")
    .select("product_code,product_name,is_active,stock_status")
    .eq("product_code",rawText.trim())
    .eq("is_active",true)
    .maybeSingle();
  if(exactCode?.product_code)return productResolution(exactCode,"canonical",0.99);

  const {data:rows}=await db.from("getlink_supplier_products")
    .select("product_code,product_name,is_active,stock_status")
    .eq("is_active",true)
    .limit(250);
  const candidates=(Array.isArray(rows)?rows:[])
    .map((row:any)=>({row,key:normalizeCustomerText(row.product_name)}))
    .filter((x:any)=>x.key===q||x.key.includes(q)||q.includes(x.key))
    .sort((a:any,b:any)=>Math.abs(a.key.length-q.length)-Math.abs(b.key.length-q.length));
  if(!candidates.length)return null;
  const first=candidates[0];
  const exact=first.key===q;
  if(exact)return productResolution(first.row,"canonical",0.98);
  if(candidates.length===1)return productResolution(first.row,"fuzzy",0.86);
  return null;
}
