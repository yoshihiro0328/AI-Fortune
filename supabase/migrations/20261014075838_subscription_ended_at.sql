-- Add the actual Stripe end timestamp without guessing or backfilling existing data.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.subscriptions add column ended_at timestamptz;
comment on column public.subscriptions.ended_at is 'Stripe Subscription.ended_at: actual end; NULL means unknown. Never infer from canceled_at or period_end.';
-- Preserve a known end if a previous application version omits this new field.
create or replace function public.apply_subscription_snapshot(p_snapshot jsonb,p_invoices jsonb,p_event text,p_type text,p_hash text) returns void language plpgsql security invoker set search_path='' as $$
declare s public.subscriptions; i public.subscription_invoices; begin
 s:=jsonb_populate_record(null::public.subscriptions,p_snapshot);
 if not exists(select 1 from public.billing_customers where user_id=s.user_id and stripe_customer_id=s.stripe_customer_id) then raise exception 'customer mismatch';end if;
 insert into public.subscriptions select s.* on conflict(id) do update set status=excluded.status,period_start=excluded.period_start,period_end=excluded.period_end,paid_through=excluded.paid_through,cancel_at_period_end=excluded.cancel_at_period_end,cancel_at=excluded.cancel_at,cancellation_reason=excluded.cancellation_reason,canceled_at=excluded.canceled_at,ended_at=case when p_snapshot ? 'ended_at' then excluded.ended_at else public.subscriptions.ended_at end,updated_at=excluded.updated_at;
 for i in select * from jsonb_populate_recordset(null::public.subscription_invoices,p_invoices) loop
 if i.user_id<>s.user_id or i.subscription_id<>s.id then raise exception 'invoice mismatch';end if;
 insert into public.subscription_invoices select i.* on conflict(id) do update set amount=excluded.amount,status=excluded.status,paid_at=excluded.paid_at,period_start=excluded.period_start,period_end=excluded.period_end;
 end loop;
 if p_event is not null then insert into public.stripe_events(stripe_event_id,event_type,payload_hash) values(p_event,p_type,p_hash) on conflict(stripe_event_id) do nothing;end if;
end $$;
revoke all on function public.apply_subscription_snapshot(jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_subscription_snapshot(jsonb,jsonb,text,text,text) to service_role;

commit;
