import { normalizeCustomerText } from "./normalize.ts";

export const MARKET_MAX_AGE_MS=24*60*60*1000;
export const NATIVE_ORDER_RPC="getlink_sales_create_order";

type StoreMarketInput={
  productCode:string;
  priceVnd:number;
  equivalenceKey:string;
};

type ReferenceMarketInput={
  priceVnd:number;
  equivalenceKey:string;
  checkedAt:string|Date;
};

export type MarketComparison={
  position:"near"|"store_higher"|"store_lower";
  storePriceVnd:number;
  referencePriceVnd:number;
  differenceVnd:number;
  differencePercent:number;
};

export function marketComparison(
  store:StoreMarketInput,
  reference:ReferenceMarketInput,
  now:Date=new Date(),
):MarketComparison|null{
  const storePrice=Math.round(Number(store?.priceVnd));
  const referencePrice=Math.round(Number(reference?.priceVnd));
  if(!Number.isFinite(storePrice)||storePrice<=0||!Number.isFinite(referencePrice)||referencePrice<=0)return null;
  if(!store?.equivalenceKey||store.equivalenceKey!==reference?.equivalenceKey)return null;
  const checkedAt=reference.checkedAt instanceof Date?reference.checkedAt:new Date(reference.checkedAt);
  const age=now.getTime()-checkedAt.getTime();
  if(!Number.isFinite(checkedAt.getTime())||age<0||age>MARKET_MAX_AGE_MS)return null;
  const differenceVnd=storePrice-referencePrice;
  const differencePercent=Math.abs(differenceVnd)/referencePrice*100;
  const position=differencePercent<1?"near":differenceVnd>0?"store_higher":"store_lower";
  return {position,storePriceVnd:storePrice,referencePriceVnd:referencePrice,differenceVnd,differencePercent};
}

export async function loadSellableProduct(db:any,productCode:string):Promise<any|null>{
  const {data,error}=await db.from("getlink_supplier_products")
    .select("product_code,product_name,display_price_vnd,carton_price_vnd,retail_price_vnd,primary_packaging,retail_packaging,retail_unit,units_per_carton,stock_status,is_active,supplier_price_direction,supplier_price_delta_vnd,supplier_price_changed_at,updated_at")
    .eq("product_code",productCode)
    .eq("is_active",true)
    .maybeSingle();
  if(error)throw error;
  if(!data||String(data.stock_status||"")==="inactive")return null;
  return data;
}

export async function buildCommercialFacts(db:any,productCode:string,quantity:number){
  const product=await loadSellableProduct(db,productCode);
  if(!product)throw new Error("product_unavailable");
  const unitPrice=Math.max(0,Math.round(Number(product.display_price_vnd)||0));
  const qty=Number(quantity);
  if(!Number.isFinite(qty)||qty<=0)throw new Error("invalid_quantity");
  const unitLabel=String(product.primary_packaging||product.retail_packaging||product.retail_unit||"").trim();
  const isCarton=/\bthung\b/u.test(normalizeCustomerText(unitLabel));
  return {
    productCode:String(product.product_code),
    productName:String(product.product_name),
    quantity:qty,
    unitLabel,
    unitPriceVnd:unitPrice,
    lineTotalVnd:Math.round(unitPrice*qty),
    cartonEquivalent:isCarton?qty:0,
    unitsPerCarton:product.units_per_carton==null?null:Number(product.units_per_carton),
    supplierPriceDirection:product.supplier_price_direction||null,
    supplierPriceDeltaVnd:product.supplier_price_delta_vnd==null?null:Number(product.supplier_price_delta_vnd),
    supplierPriceChangedAt:product.supplier_price_changed_at||null,
    productUpdatedAt:product.updated_at||null,
  };
}
