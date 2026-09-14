from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor {label}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    a = text.find(start)
    if a < 0:
        raise SystemExit(f"missing start {label}: {start}")
    b = text.find(end, a + len(start))
    if b < 0:
        raise SystemExit(f"missing end {label}: {end}")
    return text[:a] + replacement + text[b:]


# Server: keep catalog authoritative by default; allow admin-only order snapshot overrides.
path = "supabase/functions/getlink-orders/index.ts"
s = read(path)
s = replace_once(
    s,
    'type CreateInput={url:string;qty:number;bargainPriceVnd:number;lineNote:string};',
    'type CreateInput={url:string;qty:number;bargainPriceVnd:number;lineNote:string;nameOverride:string;sellingPriceVnd:number|null};',
    "CreateInput",
)
resolve = '''async function resolveCreateItems(raw:unknown,actor:Identity){
  if(!Array.isArray(raw)||raw.length===0)throw fail("Đơn phải có ít nhất một sản phẩm");
  if(raw.length>100)throw fail("Đơn có quá nhiều sản phẩm");
  const requested:CreateInput[]=[];
  const seen=new Set<string>();
  for(const entry of raw){
    const url=clean(entry?.url);
    const qty=Number(entry?.qty);
    const bargainRaw=Number(entry?.bargainPriceVnd||0);
    const bargainPriceVnd=Number.isFinite(bargainRaw)?Math.max(0,Math.min(100000,Math.round(bargainRaw))):0;
    const lineNote=clean(entry?.lineNote);
    const nameOverride=clean(entry?.nameOverride);
    const hasSellingOverride=Object.prototype.hasOwnProperty.call(entry||{},"sellingPriceVnd")&&entry?.sellingPriceVnd!==null&&entry?.sellingPriceVnd!=="";
    const sellingRaw=hasSellingOverride?Number(entry?.sellingPriceVnd):null;
    const sellingPriceVnd=hasSellingOverride&&Number.isFinite(sellingRaw)?Math.round(Number(sellingRaw)):null;
    const key=url.toLowerCase();
    if(!url||!Number.isInteger(qty)||qty<=0||qty>999)throw fail("Sản phẩm hoặc số lượng không hợp lệ");
    if(lineNote.length>160)throw fail("Ghi chú sản phẩm tối đa 160 ký tự");
    if(nameOverride.length>120)throw fail("Tên sản phẩm tối đa 120 ký tự");
    if(hasSellingOverride&&(sellingPriceVnd===null||sellingPriceVnd<0||sellingPriceVnd>1000000))throw fail("Giá bán phải từ 0 đến 1.000.000");
    if((nameOverride||hasSellingOverride)&&actor.kind!=="admin")throw fail("Chỉ Admin được sửa tên hoặc giá bán của dòng đơn",403);
    if(seen.has(key))throw fail("Sản phẩm bị trùng trong đơn");
    seen.add(key);
    requested.push({url,qty,bargainPriceVnd,lineNote,nameOverride,sellingPriceVnd});
  }
  const urls=requested.map(x=>x.url);
  const {data,error}=await db.from("getlink_supplier_products")
    .select("product_code,canonical_url,product_name,source_key,display_price_vnd,input_price_vnd,stock_status,is_active")
    .in("canonical_url",urls)
    .eq("is_active",true);
  if(error)throw error;
  const rows=data||[];
  const byUrl=new Map(rows.map((row:any)=>[clean(row.canonical_url).toLowerCase(),row]));
  if(byUrl.size!==urls.length)throw fail("Có sản phẩm không còn tồn tại");
  return requested.map(request=>{
    const row:any=byUrl.get(request.url.toLowerCase());
    const price=Math.max(0,Math.round(Number(row.display_price_vnd||0)));
    const cost=Math.max(0,Math.round(Number(row.input_price_vnd||0)));
    if(clean(row.stock_status)==="out_of_stock")throw fail("Có sản phẩm đang hết hàng");
    return {
      productCode:clean(row.product_code),
      productName:request.nameOverride||clean(row.product_name),
      productUrl:clean(row.canonical_url),
      quantity:request.qty,
      unitPriceVnd:request.sellingPriceVnd===null?price:request.sellingPriceVnd,
      bargainPriceVnd:request.bargainPriceVnd,
      lineNote:request.lineNote,
      unitCostVnd:Number.isFinite(cost)?cost:0,
      sourceKey:clean(row.source_key)
    };
  });
}

'''
s = replace_between(s, "async function resolveCreateItems(raw:unknown){", "async function readOrder", resolve, "resolveCreateItems")
s = s.replace('const items=await resolveCreateItems(body?.items);', 'const items=await resolveCreateItems(body?.items,actor);')

payment_anchor = '''async function recordPayment(req:Request,actor:Identity,customerId:string){
  const customer=await selectedCustomer(customerId);
  const body=await req.json().catch(()=>({}));
  const amountVnd=Math.round(Number(body?.amountVnd||0));
  if(!Number.isFinite(amountVnd)||amountVnd<=0)throw fail("Số tiền thanh toán không hợp lệ");
  const note=clean(body?.note);
  const {data,error}=await db.rpc("getlink_sales_record_payment",{
    p_customer_id:customer.id,p_amount_vnd:amountVnd,p_actor_id:actor.id,p_note:note
  });
  if(error)throw error;
  return {id:String(data||""),customerId:customer.id,amountVnd};
}
'''
adjustment = payment_anchor + '''
async function recordDebtAdjustment(req:Request,actor:Identity,customerId:string){
  if(actor.kind!=="admin")throw fail("forbidden",403);
  const customer=await selectedCustomer(customerId);
  const body=await req.json().catch(()=>({}));
  const amountVnd=Math.round(Number(body?.amountVnd||0));
  if(!Number.isFinite(amountVnd)||amountVnd<=0)throw fail("Số tiền ghi nợ không hợp lệ");
  const note=clean(body?.note);
  const {data,error}=await db.rpc("getlink_sales_record_debt_adjustment",{
    p_customer_id:customer.id,p_amount_vnd:amountVnd,p_actor_id:actor.id,p_note:note
  });
  if(error)throw error;
  return {id:String(data||""),customerId:customer.id,amountVnd};
}
'''
s = replace_once(s, payment_anchor, adjustment, "recordPayment")
payment_route = '''    const paymentMatch=path.match(/^\\/debts\\/([^/]+)\\/payments$/);
    if(req.method==="POST"&&paymentMatch){
      if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      const payment=await recordPayment(req,actor,decodeURIComponent(paymentMatch[1]));
      return json(req,{ok:true,payment},201);
    }
'''
adjustment_route = payment_route + '''    const adjustmentMatch=path.match(/^\\/debts\\/([^/]+)\\/adjustments$/);
    if(req.method==="POST"&&adjustmentMatch){
      if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      const adjustment=await recordDebtAdjustment(req,actor,decodeURIComponent(adjustmentMatch[1]));
      return json(req,{ok:true,adjustment},201);
    }
'''
s = replace_once(s, payment_route, adjustment_route, "payment route")
write(path, s)

# Database: additive manual debt increase. No existing debt rows are rewritten.
migration = Path("supabase/migrations/20260914050000_getlink_manual_debt_adjustment.sql")
migration.write_text('''begin;

create or replace function public.getlink_sales_record_debt_adjustment(
  p_customer_id uuid,
  p_amount_vnd bigint,
  p_actor_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_amount_vnd is null or p_amount_vnd<=0 then
    raise exception 'Debt adjustment must be positive';
  end if;
  if not exists(
    select 1 from public.v21_accounts
    where id=p_actor_id and role='admin' and deleted_at is null and locked_at is null
  ) then raise exception 'Admin required'; end if;
  if not exists(
    select 1 from public.v21_accounts
    where id=p_customer_id and role='user' and contact_group='customer'
      and deleted_at is null and locked_at is null
  ) then raise exception 'Invalid GETLINK customer'; end if;

  insert into public.getlink_debt_ledger(
    id,customer_account_id,event_type,amount_vnd,direction,note,occurred_at,created_by_account_id
  ) values (
    v_id,p_customer_id,'manual_adjustment',p_amount_vnd,'increase',coalesce(p_note,''),now(),p_actor_id
  );
  return v_id;
end;
$$;

revoke all on function public.getlink_sales_record_debt_adjustment(uuid,bigint,uuid,text)
  from public,anon,authenticated;
grant execute on function public.getlink_sales_record_debt_adjustment(uuid,bigint,uuid,text)
  to service_role;

commit;
''', encoding="utf-8")

# Desktop Sales: quantity stays +/-; selected admin rows additionally expose name and selling-price snapshot edits.
path = "taphoa-desktop-sales.js"
s = read(path)
s = replace_once(
    s,
    'const state={query:"",sourceKey:"",rows:[],visible:PAGE_SIZE,qty:new Map(),notes:new Map(),customers:[],selectedCustomerId:"",editingOrder:null,busy:false,status:""};',
    'const state={query:"",sourceKey:"",rows:[],visible:PAGE_SIZE,qty:new Map(),notes:new Map(),nameOverrides:new Map(),priceOverrides:new Map(),customers:[],selectedCustomerId:"",editingOrder:null,busy:false,status:""};',
    "sales state",
)
price_anchor = '  function price(row){try{if(typeof rowPriceLevels==="function"){const p=rowPriceLevels(row)||{};return Number(p.promoCartonPrice||p.cartonPrice||p.promoLeafPrice||p.leafPrice||0)}}catch{}return Number(row?.display_price_vnd||row?.supplier_display_price_vnd||row?.supplier_carton_price_vnd||row?.supplier_retail_price_vnd||row?.price_vnd||row?.current_price||0)}\n'
price_helpers = price_anchor + '  function lineName(row,k=key(row)){return state.nameOverrides.get(String(k||"").toLowerCase())||name(row)}\n  function linePrice(row,k=key(row)){const v=state.priceOverrides.get(String(k||"").toLowerCase());return Number.isFinite(v)?Number(v):price(row)}\n  function compactPriceValue(v){const n=Math.max(0,Number(v||0));return String(Math.round(n/500)*.5).replace(".5",",5")}\n  function parseCompactPrice(v){const text=String(v??"").trim().replace(/\\s+/g,"").replace(",",".");if(!/^\\d+(?:\\.\\d)?$/.test(text))return null;const compact=Number(text);if(!Number.isFinite(compact)||compact<0||compact>1000)return null;return Math.round(compact*2)/2*1000}\n'
s = replace_once(s, price_anchor, price_helpers, "price helpers")
hydrate = 'function hydrate(){state.qty.clear();state.notes.clear();state.nameOverrides.clear();state.priceOverrides.clear();for(const[k,v]of Object.entries(readObject(QTY_KEY))){const n=Math.max(0,Math.min(999,Math.round(Number(v)||0)));if(n)state.qty.set(String(k).toLowerCase(),n)}for(const[k,v]of Object.entries(readObject(NOTE_KEY))){const t=String(v||"").replace(/\\s+/g," ").trim().slice(0,160);if(t)state.notes.set(String(k).toLowerCase(),t)}state.selectedCustomerId=String(sessionStorage.getItem(CUSTOMER_KEY)||"")}'
s, count = re.subn(r'function hydrate\(\)\{.*?\}\n  function persist', hydrate + '\n  function persist', s, count=1, flags=re.S)
if count != 1:
    raise SystemExit("hydrate replacement failed")
row = '''function rowMarkup(row){const k=key(row),n=state.qty.get(k)||0,img=String(row?.image||"").trim(),admin=window.TaphoaDesktopData?.readAuth?.()?.account?.role==="admin",editable=admin&&n>0,currentName=lineName(row,k),currentPrice=linePrice(row,k);return '<article class="taphoa-sales-row '+(n?'is-selected':'')+'" data-sales-product="'+attr(k)+'"><div class="taphoa-sales-product"><span class="taphoa-sales-thumb">'+(img?'<img src="'+attr(img)+'" alt="" loading="lazy" decoding="async">':'<b>GL</b>')+'</span><span class="taphoa-sales-copy">'+(editable?'<input class="taphoa-sales-name-edit" data-sales-name-edit="'+attr(k)+'" maxlength="120" autocomplete="off" value="'+attr(currentName)+'" aria-label="Tên dòng hàng">':'<strong>'+esc(currentName)+'</strong>')+'<small>'+esc([qc(row),sourceName(row)].filter(Boolean).join(' · '))+'</small></span></div>'+(editable?'<label class="taphoa-sales-price-edit"><input data-sales-price-edit="'+attr(k)+'" inputmode="decimal" autocomplete="off" value="'+attr(compactPriceValue(currentPrice))+'" aria-label="Giá bán dòng hàng"><small>nghìn</small></label>':'<strong class="taphoa-sales-price">'+esc(money(currentPrice))+'</strong>')+'<div class="taphoa-sales-qty"><button type="button" data-sales-qty="-1">−</button><b>'+n+'</b><button type="button" data-sales-qty="1">+</button></div></article>'}
  '''
s = replace_between(s, "function rowMarkup(row)", "function manualAddMarkup", row, "sales row")
selected = '''function selectedItems(){const out=[];for(const[k,n]of state.qty){if(!n)continue;const row=window.TaphoaDesktopData?.findProduct?.(k);if(row)out.push({row,key:k,qty:n,note:state.notes.get(k)||"",name:lineName(row,k),price:linePrice(row,k)})}return out}
  '''
s = replace_between(s, "function selectedItems()", "function customerControl", selected, "selected items")
s = s.replace("<strong>'+esc(name(i.row))+'</strong>", "<strong>'+esc(i.name)+'</strong>", 1)
hot = '''function updateQtyRow(k,n){const row=slots?.master?.querySelector?.('[data-sales-product="'+css(k)+'"]'),product=window.TaphoaDesktopData?.findProduct?.(k);if(row&&product)row.outerHTML=rowMarkup(product);renderDetail()}
  function changeQty(k,d){const next=Math.max(0,Math.min(999,(state.qty.get(k)||0)+d));if(next)state.qty.set(k,next);else{state.qty.delete(k);state.notes.delete(k);state.nameOverrides.delete(k);state.priceOverrides.delete(k)}persist();updateQtyRow(k,next)}
  '''
s = replace_between(s, "function updateQtyRow", "function setNote", hot, "sales qty")
s, count = re.subn(
    r'function clearCart\(\)\{.*?\}',
    'function clearCart(){state.qty.clear();state.notes.clear();state.nameOverrides.clear();state.priceOverrides.clear();persist();renderMasterResults();renderDetail()}',
    s,
    count=1,
)
if count != 1:
    raise SystemExit("clearCart replacement failed")
payload = '''function payload(){const admin=window.TaphoaDesktopData?.readAuth?.()?.account?.role==="admin";return selectedItems().map(i=>{const out={url:String(i.row?.canonical_url||i.row?.url||""),qty:i.qty,bargainPriceVnd:0,lineNote:i.note};if(admin){const baseName=name(i.row),basePrice=price(i.row);if(i.name&&i.name!==baseName)out.nameOverride=i.name;if(Number.isFinite(i.price)&&i.price!==basePrice)out.sellingPriceVnd=Math.round(i.price)}return out})}
  '''
s, count = re.subn(r'const payload=\(\)=>selectedItems\(\)\.map\(.*?\);\n', payload, s, count=1)
if count != 1:
    raise SystemExit("payload replacement failed")
edit = '''function editOrder(order){if(!order)return false;state.editingOrder=order;state.query="";state.sourceKey="";state.visible=PAGE_SIZE;state.qty.clear();state.notes.clear();state.nameOverrides.clear();state.priceOverrides.clear();for(const i of Array.isArray(order.items)?order.items:[]){const k=String(i.url||"").trim().toLowerCase(),n=Math.max(0,Math.min(999,Math.round(Number(i.qty)||0)));if(k&&n)state.qty.set(k,n);const note=String(i.note||"").trim().slice(0,160);if(k&&note)state.notes.set(k,note);const itemName=String(i.name||"").trim().slice(0,120);if(k&&itemName)state.nameOverrides.set(k,itemName);const itemPrice=Math.max(0,Math.round(Number(i.price)||0));if(k&&Number.isFinite(itemPrice))state.priceOverrides.set(k,itemPrice)}state.selectedCustomerId=String(order.customerId||"");if(state.selectedCustomerId)sessionStorage.setItem(CUSTOMER_KEY,state.selectedCustomerId);persist();state.status="Đang sửa đơn #"+String(order.orderNo||order.id||"");window.TaphoaDesktopWorkspace?.setView?.("sales");return true}
  '''
s = replace_between(s, "function editOrder(order)", "function cancelEdit", edit, "edit order")
bind = '''function bind(){if(bound||!slots)return;bound=true;slots.left.addEventListener("click",e=>{const b=e.target.closest?.("[data-sales-source]");if(!b)return;state.sourceKey=String(b.dataset.salesSource||"");state.visible=PAGE_SIZE;renderCategories();renderMasterResults()});slots.left.addEventListener("change",e=>{const c=e.target.closest?.("[data-sales-customer]");if(!c)return;state.selectedCustomerId=String(c.value||"");if(state.selectedCustomerId)sessionStorage.setItem(CUSTOMER_KEY,state.selectedCustomerId);else sessionStorage.removeItem(CUSTOMER_KEY);renderDetail()});slots.master.addEventListener("input",e=>{if(e.target.id==="taphoaSalesSearch"){state.query=String(e.target.value||"");state.visible=PAGE_SIZE;renderMasterResults();return}const nameInput=e.target.closest?.("[data-sales-name-edit]");if(nameInput){const k=String(nameInput.dataset.salesNameEdit||"").toLowerCase(),v=String(nameInput.value||"").replace(/\\s+/g," ").trimStart().slice(0,120);if(v)state.nameOverrides.set(k,v);else state.nameOverrides.delete(k);renderDetail();return}const priceInput=e.target.closest?.("[data-sales-price-edit]");if(priceInput){const k=String(priceInput.dataset.salesPriceEdit||"").toLowerCase(),v=parseCompactPrice(priceInput.value);priceInput.setAttribute("aria-invalid",v===null?"true":"false");if(v!==null){state.priceOverrides.set(k,v);renderDetail()}return}});slots.master.addEventListener("click",e=>{const b=e.target.closest?.("[data-sales-qty]");if(!b)return;const row=b.closest("[data-sales-product]");if(row)changeQty(String(row.dataset.salesProduct||""),Number(b.dataset.salesQty)||0)});slots.master.addEventListener("scroll",()=>{if(slots.master.scrollHeight-slots.master.scrollTop-slots.master.clientHeight>260||state.visible>=state.rows.length)return;state.visible=Math.min(state.rows.length,state.visible+PAGE_SIZE);renderMasterResults({append:true})},{passive:true});slots.master.addEventListener("submit",e=>{const f=e.target.closest?.("[data-sales-manual-add]");if(f){e.preventDefault();void addProduct(f)}});slots.detail.addEventListener("input",e=>{const note=e.target.closest?.("[data-sales-cart-note]");if(note)setNote(String(note.dataset.salesCartNote||""),note.value,{render:false})});slots.detail.addEventListener("click",e=>{if(e.target.closest?.("[data-sales-clear]"))clearCart();else if(e.target.closest?.("[data-sales-submit]"))void submit("pending");else if(e.target.closest?.("[data-sales-quick]"))void submit("quick");else if(e.target.closest?.("[data-sales-update]"))void updateEditing();else if(e.target.closest?.("[data-sales-cancel-edit]"))cancelEdit()})}
  '''
s = replace_between(s, "function bind()", "function mount(s)", bind, "sales bind")
write(path, s)

# Desktop Debt: one quick-entry form with explicit Thu and Nợ actions.
path = "taphoa-desktop-debts.js"
s = read(path)
s = replace_once(s, 'manual_adjustment:"Điều chỉnh"', 'manual_adjustment:"Ghi nợ"', "debt label")
overview = '''function debtOverviewMarkup(){if(!isAdmin())return"";const totals=debtTotals(),customers=Array.isArray(state.summaries)?state.summaries:[];return '<section class="taphoa-debt-overview"><div class="taphoa-debt-overview-cards"><article class="taphoa-debt-overview-card"><small>TỔNG NỢ</small><strong>'+esc(money(totals.debt))+'</strong><span>'+totals.debtCount+' khách còn nợ</span></article><article class="taphoa-debt-overview-card credit"><small>TỔNG DƯ TIỀN</small><strong>'+esc(money(totals.credit))+'</strong><span>'+totals.creditCount+' khách dư</span></article></div><form class="taphoa-debt-quick-payment" data-td-debt-quick-entry><strong>Lập phiếu nhanh</strong><select name="customerId" required><option value="">Tìm khách hàng...</option>'+customers.map(r=>'<option value="'+attr(r.customerId)+'">'+esc(r.customerName||r.username||"Khách hàng")+(Number(r.balanceVnd||0)?' · '+esc(money(r.balanceVnd)):'')+'</option>').join('')+'</select><input name="amountVnd" inputmode="numeric" autocomplete="off" placeholder="Số tiền..." required><button type="submit" data-td-debt-quick-payment '+(!customers.length?'disabled':'')+'>Thu</button><button type="submit" class="debt" data-td-debt-quick-debt '+(!customers.length?'disabled':'')+'>Nợ</button></form><small class="taphoa-debt-quick-status">'+esc(state.statusText)+'</small></section>'}
  '''
s = replace_between(s, "function debtOverviewMarkup()", "function renderCustomers()", overview, "debt overview")
quick = '''async function quickEntry(form,action){if(state.busy||!isAdmin())return;const customerId=String(form.elements.customerId?.value||""),amount=Number(String(form.elements.amountVnd?.value||"").replace(/\\D/g,""));if(!customerId||!amount){state.statusText="Chọn khách và nhập số tiền.";renderCustomers();return}const debt=action==="debt",endpoint=debt?"adjustments":"payments";state.busy=true;state.statusText=debt?"Đang ghi nợ...":"Đang thu tiền...";renderCustomers();try{await window.TaphoaDesktopData.orderRequest("/debts/"+encodeURIComponent(customerId)+"/"+endpoint,{method:"POST",body:JSON.stringify({amountVnd:Math.round(amount),note:debt?"Ghi nợ nhanh":"Thu tiền nhanh"})});state.busy=false;state.customerId=customerId;state.statusText=debt?"Đã ghi nợ.":"Đã ghi nhận thanh toán.";await refresh();return}catch(e){state.statusText=String(e?.message||e);renderCustomers()}finally{state.busy=false}}

  '''
s = replace_between(s, "async function quickPayment(form)", "async function payment(form)", quick, "quick debt entry")
bind = '''function bind(){if(bound||!slots)return;bound=true;slots.left.addEventListener("click",e=>{const b=e.target.closest?.("[data-td-debt-customer]");if(b)void loadDetail(String(b.dataset.tdDebtCustomer||""))});slots.left.addEventListener("submit",e=>{const f=e.target.closest?.("[data-td-debt-quick-entry]");if(f){e.preventDefault();const action=e.submitter?.closest?.("[data-td-debt-quick-debt]")?"debt":"payment";void quickEntry(f,action)}});slots.master.addEventListener("click",e=>{const order=e.target.closest?.("[data-td-debt-order]");if(order){void loadLinkedOrder(String(order.dataset.tdDebtOrder||""));return}const b=e.target.closest?.("[data-td-debt-txn]");if(b)selectTxn(String(b.dataset.tdDebtTxn||""))});slots.detail.addEventListener("click",e=>{if(e.target.closest?.("[data-td-debt-order-back]")){state.linkedOrder=null;state.statusText="";renderDetail(state.selectedTxnId);return}const action=e.target.closest?.("[data-td-order-action]");if(action&&state.linkedOrder){void window.TaphoaDesktopOrders?.performAction?.(String(action.dataset.tdOrderAction||""),state.linkedOrder);return}});slots.detail.addEventListener("submit",e=>{const f=e.target.closest?.("[data-td-debt-payment]");if(f){e.preventDefault();void payment(f)}});document.addEventListener("taphoa-desktop-debts-changed",()=>{if(active)void refresh()});document.addEventListener("taphoa-desktop-orders-changed",()=>{if(active)void refresh()})}
  '''
s = replace_between(s, "function bind()", "function mount(s)", bind, "debt bind")
write(path, s)

# Desktop geometry: inline edits stay compact; quick debt becomes two explicit actions.
path = "taphoa-desktop-workspace.css"
s = read(path)
anchor = '  .taphoa-sales-copy small{font-size:11px;color:#7d8781;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n'
extra = '''  .taphoa-sales-name-edit{width:100%;min-width:0;height:28px;border:0;border-bottom:1px solid #b9d2c2;background:transparent;padding:0;font:inherit;font-size:13px;font-weight:700;color:#17211c;outline:none}\n  .taphoa-sales-name-edit:focus{border-bottom-color:#4f9468}\n  .taphoa-sales-price-edit{min-width:0;display:flex;align-items:center;justify-content:flex-end;gap:3px;padding:7px 8px}\n  .taphoa-sales-price-edit input{width:58px;min-width:0;height:30px;border:1px solid #cfdad4;border-radius:6px;background:#fff;padding:0 5px;text-align:right;font:inherit;font-size:12px;font-variant-numeric:tabular-nums;outline:none}\n  .taphoa-sales-price-edit input[aria-invalid="true"]{border-color:#c85b55;background:#fff7f6}\n  .taphoa-sales-price-edit small{font-size:9.5px;color:#7c8780}\n'''
s = replace_once(s, anchor, anchor + extra, "sales inline edit css")
s = replace_once(
    s,
    '  .taphoa-debt-quick-payment{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}\n  .taphoa-debt-quick-payment>strong,.taphoa-debt-quick-payment>select{grid-column:1/-1}\n',
    '  .taphoa-debt-quick-payment{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}\n  .taphoa-debt-quick-payment>strong,.taphoa-debt-quick-payment>select,.taphoa-debt-quick-payment>input{grid-column:1/-1}\n',
    "quick debt css",
)
s = replace_once(
    s,
    '  .taphoa-debt-quick-payment button{min-width:54px;background:#397b43;color:#fff;border-color:#397b43;font-weight:800;cursor:pointer}\n',
    '  .taphoa-debt-quick-payment button{min-width:0;background:#397b43;color:#fff;border-color:#397b43;font-weight:800;cursor:pointer}\n  .taphoa-debt-quick-payment button.debt{background:#b44d3d;border-color:#b44d3d}\n',
    "quick debt buttons",
)
write(path, s)

print("standard-actions implementation applied")
