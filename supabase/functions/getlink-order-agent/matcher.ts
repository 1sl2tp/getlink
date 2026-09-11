import { normalizeCustomerText } from "./normalize.ts";
import type { ProductResolution, ResolutionSource } from "./types.ts";

export const STORE_ALIAS_PROMOTION_CUSTOMERS=3;
const CATALOG_PAGE_SIZE=1000;
const CATALOG_MAX_ROWS=10000;

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

async function loadCompleteActiveCatalog(db:any):Promise<{rows:any[];complete:boolean}>{
  const rows:any[]=[];
  for(let start=0;start<CATALOG_MAX_ROWS;start+=CATALOG_PAGE_SIZE){
    const {data,error}=await db.from("getlink_supplier_products")
      .select("product_code,product_name,is_active,stock_status")
      .eq("is_active",true)
      .order("product_code",{ascending:true})
      .range(start,start+CATALOG_PAGE_SIZE-1);
    if(error)throw error;
    const page=Array.isArray(data)?data:[];
    rows.push(...page);
    if(page.length<CATALOG_PAGE_SIZE)return {rows,complete:true};
  }
  return {rows,complete:false};
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

  const catalog=await loadCompleteActiveCatalog(db);
  if(!catalog.complete)return null;
  const candidates=catalog.rows
    .filter((row:any)=>String(row?.stock_status||"")!=="inactive")
    .map((row:any)=>({row,key:normalizeCustomerText(row.product_name)}))
    .filter((x:any)=>x.key===q||x.key.includes(q)||q.includes(x.key))
    .sort((a:any,b:any)=>Math.abs(a.key.length-q.length)-Math.abs(b.key.length-q.length));
  if(!candidates.length)return null;
  const exactCandidates=candidates.filter((candidate:any)=>candidate.key===q);
  if(exactCandidates.length===1)return productResolution(exactCandidates[0].row,"canonical",0.98);
  if(exactCandidates.length>1)return null;
  if(candidates.length===1)return productResolution(candidates[0].row,"fuzzy",0.86);
  return null;
}
