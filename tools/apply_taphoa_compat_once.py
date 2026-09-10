from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel, text):
    (ROOT / rel).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


edge_rel = "supabase/functions/getlink-orders/index.ts"
edge = read(edge_rel)
old = '''  const rpcName=quick?"getlink_sales_create_quick_sale":"getlink_sales_create_order";
  const {error}=await db.rpc(rpcName,{
    p_order:{id,customerAccountId:customer.id,createdByAccountId:actor.id,submittedAt},
    p_items:items
  });
  if(error)throw error;
  return await readOrder(id,actor);
}'''
new = '''  const rpcArgs={
    p_order:{id,customerAccountId:customer.id,createdByAccountId:actor.id,submittedAt},
    p_items:items
  };
  const {error}=quick
    ?await db.rpc("getlink_sales_create_quick_sale",rpcArgs)
    :await db.rpc("getlink_sales_create_order",rpcArgs);
  if(error)throw error;

  // Keep the human order number explicit at the create boundary. It is owned by
  // the database identity column and must be immediately available to the UI.
  const {data:persisted,error:persistedError}=await db.from("getlink_sales_orders")
    .select("order_no,status")
    .eq("id",id)
    .single();
  if(persistedError||!persisted)throw persistedError||fail("Không đọc được đơn vừa tạo",500);
  const created=await readOrder(id,actor);
  return quick
    ?{...created,orderNo:Number(persisted.order_no||0)}
    :{...created,orderNo:Number(persisted.order_no||0),status:"pending"};
}'''
edge = replace_once(edge, old, new, "explicit create RPC and order number")
write(edge_rel, edge)

order_rel = "order-management.js"
order = read(order_rel)
order = replace_once(
    order,
    '''  async function performOrderAction(action,id){''',
    '''  async function performAdminAction(action,id){
    return performOrderAction(action,id);
  }

  async function performOrderAction(action,id){''',
    "legacy action boundary compatibility",
)
write(order_rel, order)

for rel in [
    "tools/apply_taphoa_compat_once.py",
    ".github/workflows/apply-taphoa-compat-once.yml",
]:
    path = ROOT / rel
    if path.exists():
        path.unlink()

print("Applied GETLINK sales contract compatibility patch")
