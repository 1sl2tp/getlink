begin;

-- Align the outbox uniqueness contract with the reply layer introduced after
-- the base AI-agent schema. The base migration has not been released yet, but
-- keeping this as a forward migration makes the sequence safe to replay.

alter table public.getlink_ai_reply_outbox
  drop constraint if exists getlink_ai_reply_outbox_reply_kind_check;

alter table public.getlink_ai_reply_outbox
  add constraint getlink_ai_reply_outbox_reply_kind_check
  check (reply_kind in (
    'draft_update',
    'clarification',
    'price',
    'price_list',
    'checkout',
    'round_suggestion',
    'fallback'
  ));

commit;
