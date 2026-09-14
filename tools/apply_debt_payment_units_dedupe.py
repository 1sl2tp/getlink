from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str):
    text = path.read_text('utf-8')
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {text.count(old)}')
    path.write_text(text.replace(old, new, 1), 'utf-8')


order = ROOT / 'order-management.js'
desktop = ROOT / 'taphoa-desktop-debts.js'

replace_once(
    order,
    '  function dateTime(value){\n',
    '  function parseCompactVnd(value){const text=String(value??"").trim().replace(/\\s+/g,"").replace(",",".");if(!/^\\d+(?:\\.\\d)?$/.test(text))return null;const compact=Number(text);if(!Number.isFinite(compact)||compact<=0)return null;return Math.round(compact*2)/2*1000;}\n  function dateTime(value){\n'
)
replace_once(
    order,
    '  function paymentForm(customerId){\n    if(currentRole()!=="admin")return "";\n    return `<form class="debt-payment-form" data-debt-payment-form data-customer-id="${escapeHtml(customerId)}">\n      <input name="amountVnd" inputmode="numeric" autocomplete="off" placeholder="Số tiền khách trả" aria-label="Số tiền khách trả">',
    '  function paymentForm(customerId){\n    if(currentRole()!=="admin"||Number(debtDetail?.balanceVnd||0)<=0)return "";\n    return `<form class="debt-payment-form" data-debt-payment-form data-customer-id="${escapeHtml(customerId)}">\n      <input name="amountVnd" inputmode="decimal" autocomplete="off" placeholder="Số tiền khách trả (nghìn)" aria-label="Số tiền khách trả, đơn vị nghìn">'
)
replace_once(
    order,
    '    const amountText=String(form.elements.amountVnd?.value||"").replace(/[^0-9]/g,"");\n    const amountVnd=Number(amountText||0);',
    '    const amountVnd=parseCompactVnd(form.elements.amountVnd?.value);'
)

replace_once(
    desktop,
    '  function dateTime(v){',
    '  function parseCompactVnd(v){const text=String(v??"").trim().replace(/\\s+/g,"").replace(",",".");if(!/^\\d+(?:\\.\\d)?$/.test(text))return null;const compact=Number(text);if(!Number.isFinite(compact)||compact<=0)return null;return Math.round(compact*2)/2*1000;}\n  function dateTime(v){'
)
replace_once(desktop, 'placeholder="Số tiền..." required', 'placeholder="Số tiền (nghìn)..." required')
replace_once(desktop, 'placeholder="Số tiền khách trả" required', 'placeholder="Số tiền khách trả (nghìn)" required')
replace_once(
    desktop,
    'const customerId=String(form.elements.customerId?.value||""),amount=Number(String(form.elements.amountVnd?.value||"").replace(/\\D/g,""));',
    'const customerId=String(form.elements.customerId?.value||""),amount=parseCompactVnd(form.elements.amountVnd?.value);'
)
replace_once(
    desktop,
    'const amount=Number(String(form.elements.amountVnd?.value||"").replace(/\\D/g,"")),note=String(form.elements.note?.value||"").trim();',
    'const amount=parseCompactVnd(form.elements.amountVnd?.value),note=String(form.elements.note?.value||"").trim();'
)

migration = ROOT / 'supabase' / 'migrations' / '20260914183000_getlink_payment_dedupe_guard.sql'
migration.write_text("""begin;

-- Payment input is entered in compact thousand-unit UI, but this RPC always receives full VND.
-- Serialize same-customer/admin receipts and return the existing row for an accidental retry.
create or replace function public.getlink_sales_record_payment(
  p_customer_id uuid,p_amount_vnd bigint,p_actor_id uuid,p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_existing uuid;
begin
  if p_amount_vnd is null or p_amount_vnd<=0 then raise exception 'Payment must be positive'; end if;
  if not exists(
    select 1 from public.v21_accounts
    where id=p_actor_id and role='admin' and deleted_at is null and locked_at is null
  ) then raise exception 'Admin required'; end if;
  if not exists(
    select 1 from public.v21_accounts
    where id=p_customer_id and role='user' and deleted_at is null and locked_at is null
  ) then raise exception 'Invalid GETLINK customer'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text||':'||p_actor_id::text,0));

  select id into v_existing
  from public.getlink_debt_ledger
  where customer_account_id=p_customer_id
    and event_type='payment'
    and direction='decrease'
    and amount_vnd=p_amount_vnd
    and created_by_account_id=p_actor_id
    and note=coalesce(p_note,'')
    and occurred_at>=now()-interval '30 seconds'
  order by occurred_at desc,id desc
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.getlink_debt_ledger(
    id,customer_account_id,event_type,amount_vnd,direction,note,occurred_at,created_by_account_id
  ) values (
    v_id,p_customer_id,'payment',p_amount_vnd,'decrease',coalesce(p_note,''),now(),p_actor_id
  );
  return v_id;
end;
$$;

revoke all on function public.getlink_sales_record_payment(uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.getlink_sales_record_payment(uuid,bigint,uuid,text) to service_role;

commit;
""", 'utf-8')

print('Applied compact debt payment units + duplicate receipt guard')
