begin;

-- These SECURITY DEFINER helpers are an internal persistence boundary for
-- getlink-orders. Browsers authenticate to the Edge Function; only the
-- service-role client inside that function may invoke the mutation RPCs.
revoke execute on function public.getlink_create_v21_order(jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.getlink_create_v21_order(jsonb,jsonb)
  to service_role;

revoke execute on function public.getlink_approve_v21_order(text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.getlink_approve_v21_order(text,timestamptz,text)
  to service_role;

revoke execute on function public.getlink_cancel_v21_order(text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.getlink_cancel_v21_order(text,boolean,text)
  to service_role;

-- Trigger-only helper: no API role should invoke it as an RPC.
revoke execute on function public.getlink_validate_debt_customer_identity()
  from public, anon, authenticated;

commit;
