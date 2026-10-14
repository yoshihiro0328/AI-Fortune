-- Review-stage only. Apply exactly once as a transaction AFTER approval.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Fail visibly on full OR partial application; never hide drift with IF NOT EXISTS.
do $$ begin
 if to_regclass('public.payment_environment') is not null or to_regclass('public.payment_legacy_owner_exceptions') is not null or exists(
  select 1 from information_schema.columns where table_schema='public' and
  ((table_name='payments' and column_name='price_version') or
   (table_name='billing_customers' and column_name='is_test') or
   (table_name='stripe_events' and column_name in ('is_test','payment_id')) or
   (table_name='price_versions' and column_name='stripe_product_id'))
 ) or exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('payment_is_test','protect_payment_environment','guard_payment_environment','guard_price_environment','apply_stripe_event_v2'))
 or exists(select 1 from pg_trigger where not tgisinternal and tgname in ('payments_environment','customers_environment','subscriptions_environment','invoices_environment','events_environment','price_environment'))
 then raise exception 'isolation already or partially applied: inspect before proceeding'; end if;
 if exists(select 1 from public.payments where not is_test) or exists(select 1 from public.price_versions where not is_test) or exists(select 1 from public.subscriptions where not is_test) or exists(select 1 from public.subscription_invoices where not is_test) then raise exception 'expected Sandbox baseline'; end if;
end $$;
-- One database belongs to exactly one Stripe environment. Existing data remains Sandbox.
create table public.payment_environment (
 id boolean primary key default true check(id),
 mode text not null check(mode in ('sandbox','live')),
 stripe_account_id text not null check(stripe_account_id like 'acct_%')
);
insert into public.payment_environment values(true,'sandbox','acct_1UNSvsIYwtQeIHKP');
alter table public.payment_environment enable row level security;
revoke all on public.payment_environment from public,anon,authenticated,service_role;
grant select on public.payment_environment to service_role;
create function public.payment_is_test() returns boolean language sql stable security invoker set search_path='' as $$
 select mode='sandbox' from public.payment_environment where id=true;
$$;
revoke all on function public.payment_is_test() from public,anon,authenticated;
grant execute on function public.payment_is_test() to service_role;
-- SQL owner may initialize a NEW, EMPTY project only. Existing users can never be relabelled Live.
create function public.protect_payment_environment() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'payment environment cannot be deleted'; end if;
 if (new.mode,new.stripe_account_id) is distinct from (old.mode,old.stripe_account_id) and
    (exists(select 1 from auth.users) or exists(select 1 from public.diagnoses) or exists(select 1 from public.payments) or exists(select 1 from public.stripe_events) or exists(select 1 from public.billing_customers)) then
   raise exception 'only an empty project may be initialized';
 end if;
 if exists(select 1 from public.price_versions where active and is_test is distinct from (new.mode='sandbox')) then raise exception 'deactivate opposite-environment catalog before initialization'; end if;
 return new;
end $$;
revoke all on function public.protect_payment_environment() from public,anon,authenticated;
create trigger protect_payment_environment before update or delete on public.payment_environment for each row execute function public.protect_payment_environment();

alter table public.billing_customers add column is_test boolean not null default true;
alter table public.stripe_events add column is_test boolean not null default true;
alter table public.stripe_events alter column is_test set default public.payment_is_test();
alter table public.price_versions drop constraint price_versions_is_test_check;
alter table public.subscriptions drop constraint subscriptions_is_test_check;
alter table public.subscription_invoices drop constraint subscription_invoices_is_test_check;
alter table public.price_versions add column stripe_product_id text;
update public.price_versions set stripe_product_id='yorisoi_report_202610' where id='report-2026-10-980';
update public.price_versions set stripe_product_id='yorisoi_plus_202610' where id='plus-2026-10-980';
drop index public.price_versions_current;
create unique index price_versions_current on public.price_versions(kind,is_test) where active;
insert into public.price_versions(id,kind,amount,stripe_price_id,stripe_product_id,active,is_test) values
 ('report-live-2026-10-980','report',980,'price_1UOcC9IGjFw40K11jgxP3dpg','prod_VPR4SfWQ7uFLnf',false,false),
 ('plus-live-2026-10-980','plus',980,'price_1UOc3HIGjFw40K1178ivu0ee','prod_VPQvCUb8oZ87Zy',false,false);
alter table public.payments add column price_version text references public.price_versions(id);
-- Snapshot ONLY pre-existing unbound Sandbox purchases. Never backfill a purchaser.
-- Block concurrent ownership/report changes while taking this one-time snapshot.
lock table public.diagnoses,public.paid_reports in share mode;
create table public.payment_legacy_owner_exceptions (
 payment_id uuid primary key references public.payments(id) on delete cascade,
 diagnosis_owner_id uuid not null,
 payment_snapshot jsonb not null
);
insert into public.payment_legacy_owner_exceptions(payment_id,diagnosis_owner_id,payment_snapshot)
 select p.id,d.user_id,to_jsonb(p)-'updated_at'
 from public.payments p join public.diagnoses d on d.id=p.diagnosis_id
 where p.user_id is null and d.user_id is not null and p.is_test and p.status='paid'
   and p.stripe_checkout_session_id is null and p.stripe_payment_intent_id is null
   and d.status='report_ready'
   and exists(select 1 from public.paid_reports r where r.payment_id=p.id and r.diagnosis_id=d.id);
alter table public.payment_legacy_owner_exceptions enable row level security;
revoke all on public.payment_legacy_owner_exceptions from public,anon,authenticated,service_role;
grant select on public.payment_legacy_owner_exceptions to service_role;
-- Null price_version remains valid ONLY for legacy Sandbox purchases.
create function public.guard_payment_environment() returns trigger language plpgsql security invoker set search_path='' as $$
declare expected boolean; begin
 expected:=public.payment_is_test();
 if expected is null or new.is_test is distinct from expected then raise exception 'payment environment mismatch'; end if;
 if tg_op='UPDATE' and new.is_test is distinct from old.is_test then raise exception 'payment environment immutable'; end if;
 if tg_table_name='billing_customers' and tg_op='UPDATE' then
  if (new.user_id,new.stripe_customer_id) is distinct from (old.user_id,old.stripe_customer_id) then raise exception 'customer ownership immutable'; end if;
 elsif tg_table_name='payments' then
  if tg_op='UPDATE' and (new.diagnosis_id<>old.diagnosis_id or (old.user_id is not null and new.user_id is distinct from old.user_id) or (old.status in ('paid','refunded') and (new.amount,new.currency,new.price_version) is distinct from (old.amount,old.currency,old.price_version))) then raise exception 'purchase ownership or settled price immutable'; end if;
  if not exists(select 1 from public.diagnoses d where d.id=new.diagnosis_id and d.user_id is not distinct from new.user_id) then
   -- Only no-op / updated_at changes may use the frozen legacy exception.
   -- INSERT, new mismatches, owner drift and financial/binding changes still fail.
   if tg_op<>'UPDATE' then raise exception 'diagnosis owner mismatch'; end if;
   if not exists(
    select 1 from public.payment_legacy_owner_exceptions e
    join public.diagnoses d on d.id=new.diagnosis_id and d.user_id=e.diagnosis_owner_id
    where e.payment_id=old.id and e.payment_snapshot=to_jsonb(old)-'updated_at'
      and e.payment_snapshot=to_jsonb(new)-'updated_at'
   ) then raise exception 'diagnosis owner mismatch'; end if;
  end if;
  if new.price_version is null and not new.is_test then raise exception 'Live price required'; end if;
  if new.price_version is not null and not exists(select 1 from public.price_versions v where v.id=new.price_version and v.is_test=new.is_test and v.kind='report' and v.amount=new.amount and v.currency=new.currency) then raise exception 'payment catalog mismatch'; end if;
 elsif tg_table_name='subscriptions' then
  if exists(select 1 from public.subscriptions s where s.id=new.id and (s.user_id,s.stripe_customer_id,s.price_version,s.amount) is distinct from (new.user_id,new.stripe_customer_id,new.price_version,new.amount)) then raise exception 'subscription identity mismatch'; end if;
  if tg_op='UPDATE' and (new.user_id,new.stripe_customer_id,new.price_version,new.amount) is distinct from (old.user_id,old.stripe_customer_id,old.price_version,old.amount) then raise exception 'subscription ownership immutable'; end if;
  if not exists(select 1 from public.price_versions v where v.id=new.price_version and v.is_test=new.is_test and v.kind='plus' and v.amount=new.amount) or
     not exists(select 1 from public.billing_customers c where c.user_id=new.user_id and c.stripe_customer_id=new.stripe_customer_id and c.is_test=new.is_test) then raise exception 'subscription binding mismatch'; end if;
 elsif tg_table_name='subscription_invoices' then
  if exists(select 1 from public.subscription_invoices i where i.id=new.id and (i.user_id,i.subscription_id) is distinct from (new.user_id,new.subscription_id)) then raise exception 'invoice identity mismatch'; end if;
  if tg_op='UPDATE' and (new.user_id,new.subscription_id) is distinct from (old.user_id,old.subscription_id) then raise exception 'invoice ownership immutable'; end if;
  if not exists(select 1 from public.subscriptions s where s.id=new.subscription_id and s.user_id=new.user_id and s.is_test=new.is_test) then raise exception 'invoice binding mismatch'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_payment_environment() from public,anon,authenticated;
create trigger payments_environment before insert or update on public.payments for each row execute function public.guard_payment_environment();
create trigger customers_environment before insert or update on public.billing_customers for each row execute function public.guard_payment_environment();
create trigger subscriptions_environment before insert or update on public.subscriptions for each row execute function public.guard_payment_environment();
create trigger invoices_environment before insert or update on public.subscription_invoices for each row execute function public.guard_payment_environment();
create trigger events_environment before insert or update on public.stripe_events for each row execute function public.guard_payment_environment();

-- This entry point is called ONLY after signature + Stripe API verification in the server.
-- Receipt and state transitions commit atomically. A failed attempt never pins its intent.
alter table public.stripe_events add column payment_id uuid references public.payments(id);
create function public.apply_stripe_event_v2(p_event text,p_type text,p_hash text,p_session text,p_intent text,p_payment uuid,p_amount int,p_currency text,p_state text,p_is_test boolean,p_customer text) returns boolean language plpgsql security invoker set search_path='' as $$
declare p public.payments; receipt public.stripe_events; n int; begin
 if p_is_test is distinct from public.payment_is_test() or p_event is null or p_event!~'^evt_[A-Za-z0-9_]+$' or nullif(p_hash,'') is null then raise exception 'invalid event environment or identity'; end if;
 if ((p_state='paid' and p_type in ('checkout.session.completed','checkout.session.async_payment_succeeded')) or (p_state='failed' and p_type='payment_intent.payment_failed') or (p_state='refunded' and p_type='charge.refunded')) is not true then raise exception 'invalid event transition'; end if;
 select * into p from public.payments where id=p_payment for update;
 if p.id is null or p.is_test is distinct from p_is_test or p.amount is distinct from p_amount or p.currency is distinct from p_currency then raise exception 'purchase mismatch'; end if;
 select * into receipt from public.stripe_events where stripe_event_id=p_event;
 if found then
  if receipt.is_test is distinct from p_is_test or receipt.event_type is distinct from p_type or (receipt.payment_id is not null and receipt.payment_id<>p.id) then raise exception 'event identity collision'; end if;
  return false;
 end if;
 -- Late failures cannot revoke a settled purchase. Late success cannot undo a refund.
 if not (p_state='failed' and p.status in ('paid','refunded')) then
  if p_intent is null or p_intent!~'^pi_' or (p_state<>'failed' and (p_session is null or p_session!~'^cs_')) or
   (p.stripe_checkout_session_id is not null and p_session is not null and p.stripe_checkout_session_id<>p_session) or
   (p.stripe_payment_intent_id is not null and p.stripe_payment_intent_id<>p_intent) or
   (p.stripe_customer_id is not null and p.stripe_customer_id is distinct from p_customer) then raise exception 'Stripe purchase binding mismatch'; end if;
 end if;
 insert into public.stripe_events(stripe_event_id,event_type,payload_hash,is_test,payment_id) values(p_event,p_type,p_hash,p_is_test,p.id) on conflict(stripe_event_id) do nothing;
 get diagnostics n=row_count;
 if n=0 then raise exception 'concurrent event identity conflict; retry'; end if;
 if p_state='paid' and p.status not in ('paid','refunded') then
  update public.payments set status='paid',stripe_checkout_session_id=p_session,stripe_payment_intent_id=p_intent,stripe_customer_id=p_customer,paid_at=coalesce(paid_at,now()),updated_at=now() where id=p.id;
  insert into public.paid_reports(diagnosis_id,payment_id) values(p.diagnosis_id,p.id) on conflict(diagnosis_id) do nothing;
  update public.diagnoses set status='paid',updated_at=now() where id=p.diagnosis_id and status<>'report_ready';
  insert into public.analytics_events(event_name,metadata,is_test) values('payment_completed',jsonb_build_object('diagnosis_id',p.diagnosis_id),p_is_test);
 elsif p_state='refunded' then
  update public.payments set status='refunded',stripe_checkout_session_id=p_session,stripe_payment_intent_id=p_intent,stripe_customer_id=p_customer,refunded_at=coalesce(refunded_at,now()),updated_at=now() where id=p.id;
  update public.paid_reports set status='revoked',report_json=null,updated_at=now() where payment_id=p.id;
 elsif p_state='failed' and p.status='pending' then
  update public.payments set status='failed',updated_at=now() where id=p.id;
 end if;
 return true;
end $$;
revoke all on function public.apply_stripe_event_v2(text,text,text,text,text,uuid,int,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.apply_stripe_event_v2(text,text,text,text,text,uuid,int,text,text,boolean,text) to service_role;
create function public.guard_price_environment() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.active and (new.is_test is distinct from public.payment_is_test() or new.stripe_price_id is null or new.stripe_product_id is null) then raise exception 'active catalog environment mismatch'; end if;
 if tg_op='UPDATE' and (new.is_test,new.stripe_price_id,new.stripe_product_id,new.amount,new.currency,new.kind) is distinct from (old.is_test,old.stripe_price_id,old.stripe_product_id,old.amount,old.currency,old.kind) then raise exception 'create a new price version instead of rewriting history'; end if;
 return new;
end $$;
revoke all on function public.guard_price_environment() from public,anon,authenticated;
create trigger price_environment before insert or update on public.price_versions for each row execute function public.guard_price_environment();

-- Preserve the nine-argument Sandbox API, but never allow it to fulfill Live purchases.
create or replace function public.apply_stripe_event(p_event text,p_type text,p_hash text,p_session text,p_intent text,p_payment uuid,p_amount int,p_currency text,p_state text) returns boolean language plpgsql security invoker set search_path='' as $$
declare p public.payments; n int;begin
 if public.payment_is_test() is distinct from true then raise exception 'legacy Stripe RPC is Sandbox only';end if;
 insert into public.stripe_events(stripe_event_id,event_type,payload_hash) values(p_event,p_type,p_hash) on conflict(stripe_event_id) do nothing;
 get diagnostics n=row_count;if n=0 then return false;end if;
 select * into p from public.payments where (p_payment is not null and id=p_payment) or (p_intent is not null and stripe_payment_intent_id=p_intent) for update;
 if p.id is null then raise exception 'payment not found';end if;
 if p_state='paid' then
  if p_amount<>p.amount or p_currency<>p.currency or p_session is null or p_intent is null or (p.stripe_checkout_session_id is not null and p.stripe_checkout_session_id<>p_session) then raise exception 'payment mismatch';end if;
  if p.status='refunded' then return true;end if;
  update public.payments set status='paid',stripe_checkout_session_id=p_session,stripe_payment_intent_id=p_intent,paid_at=coalesce(paid_at,now()),updated_at=now() where id=p.id;
  insert into public.paid_reports(diagnosis_id,payment_id) values(p.diagnosis_id,p.id) on conflict(diagnosis_id) do nothing;
  update public.diagnoses set status='paid',updated_at=now() where id=p.diagnosis_id and status<>'report_ready';
  if p.status<>'paid' then insert into public.analytics_events(event_name,metadata) values('payment_completed',jsonb_build_object('diagnosis_id',p.diagnosis_id));end if;
 elsif p_state='refunded' then
  update public.payments set status='refunded',refunded_at=now(),updated_at=now() where id=p.id;
  update public.paid_reports set status='revoked',report_json=null,updated_at=now() where payment_id=p.id;
 elsif p_state='failed' then
  update public.payments set status='failed',updated_at=now() where id=p.id and status='pending';
 end if;return true;
end $$;

commit;
