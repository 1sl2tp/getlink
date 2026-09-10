from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "supabase/functions/getlink-orders/index.ts"
text = path.read_text(encoding="utf-8")

old = '''  const {error}=await db.rpc("getlink_sales_create_order",{
    p_order:{id,customerAccountId:customer.id,createdByAccountId:actor.id,submittedAt},
    p_items:items
  });
  if(error)throw error;
  return {
    id,customerId:customer.id,customerName:customer.name,orderedAt:submittedAt,status:"pending",
    total,totalCost,items:items.map((item:any)=>({
      productId:item.productCode,name:item.productName,qty:item.quantity,price:item.unitPriceVnd,
      cost:item.unitCostVnd,sourceId:item.sourceKey,url:item.productUrl
    }))
  };
'''

new = '''  const {error}=await db.rpc("getlink_sales_create_order",{
    p_order:{id,customerAccountId:customer.id,createdByAccountId:actor.id,submittedAt},
    p_items:items
  });
  if(error)throw error;

  // The database owns the human order number and final persisted totals/status.
  // Read the inserted row back so the submit response is immediately usable by
  // both the purchase confirmation and order manager without falling back to UUID.
  const {data:created,error:createdError}=await db.from("getlink_sales_orders")
    .select("order_no,status,total_amount_vnd,total_cost_vnd,submitted_at")
    .eq("id",id)
    .single();
  if(createdError||!created)throw createdError||fail("Không đọc được đơn vừa tạo",500);

  return {
    id,orderNo:Number(created.order_no||0),customerId:customer.id,customerName:customer.name,
    orderedAt:created.submitted_at||submittedAt,status:String(created.status||"pending"),
    total:Number(created.total_amount_vnd||total),totalCost:Number(created.total_cost_vnd||totalCost),
    items:items.map((item:any)=>({
      productId:item.productCode,name:item.productName,qty:item.quantity,price:item.unitPriceVnd,
      cost:item.unitCostVnd,sourceId:item.sourceKey,url:item.productUrl
    }))
  };
'''

count = text.count(old)
assert count == 1, f"expected one create-order response block, found {count}"
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Tạp hóa create response now returns authoritative order number")
