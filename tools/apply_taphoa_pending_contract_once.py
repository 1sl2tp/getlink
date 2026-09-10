from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "supabase/functions/getlink-orders/index.ts"
text = path.read_text(encoding="utf-8")
old_select = '.select("order_no,status,total_amount_vnd,total_cost_vnd,submitted_at")'
new_select = '.select("order_no,total_amount_vnd,total_cost_vnd,submitted_at")'
old_status = 'orderedAt:created.submitted_at||submittedAt,status:String(created.status||"pending"),'
new_status = 'orderedAt:created.submitted_at||submittedAt,status:"pending",'
assert text.count(old_select) == 1, text.count(old_select)
assert text.count(old_status) == 1, text.count(old_status)
text = text.replace(old_select, new_select, 1).replace(old_status, new_status, 1)
path.write_text(text, encoding="utf-8")
print("Preserved pending create-response contract while keeping DB order number")
