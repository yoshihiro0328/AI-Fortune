-- This deployment is test-only. Mark existing test data explicitly instead of reporting it as growth/revenue.
update public.analytics_events set is_test=true;
alter table public.analytics_events alter column is_test set default true;
update public.ai_calls set is_test=true;
alter table public.ai_calls alter column is_test set default true;
alter table public.diagnoses add column is_test boolean not null default true;
alter table public.consultation_turns add column is_test boolean not null default true;
alter table public.subscriptions add column cancellation_reason text;
alter table public.subscriptions add column canceled_at timestamptz;
create index analytics_events_time_identity on public.analytics_events(created_at,user_id,anonymous_session_id);
create function public.growth_metrics(p_start timestamptz,p_end timestamptz,p_test boolean) returns jsonb language sql set search_path='' as $$
with ev as (select *,coalesce(user_id::text,anonymous_session_id) identity_key from public.analytics_events where created_at>=p_start and created_at<p_end and (p_test or not is_test)),
d as (select * from public.diagnoses where created_at>=p_start and created_at<p_end and (p_test or not is_test)),
t as (select * from public.consultation_turns where created_at>=p_start and created_at<p_end and charged and (p_test or not is_test)),
s as (select * from public.subscriptions where p_test or not is_test),
pay as (select * from public.payments where paid_at>=p_start and paid_at<p_end),
inv as (select * from public.subscription_invoices where paid_at>=p_start and paid_at<p_end),
ai as (select c.user_id,c.model,c.plan,c.input_tokens,c.output_tokens,c.cached_tokens,c.estimated_usd,c.execution_ms,c.success,c.created_at from public.consultation_ai_calls c where c.created_at>=p_start and c.created_at<p_end and (p_test or not c.is_test)
union all select d.user_id,a.model,case when a.stage like '%paid%' then 'report' else 'diagnosis' end,a.input_tokens,a.output_tokens,a.cached_tokens,a.estimated_cost,a.execution_time,a.success,a.created_at from public.ai_calls a join public.diagnoses d on d.id=a.diagnosis_id where a.created_at>=p_start and a.created_at<p_end and (p_test or not a.is_test)),
first_visit as (select coalesce(user_id::text,anonymous_session_id) k,min(created_at) first_at from public.analytics_events where event_name='page_view' and (p_test or not is_test) and coalesce(user_id::text,anonymous_session_id) is not null group by 1),
cohort as (select * from first_visit where first_at>=p_start and first_at<p_end),
real_revenue as (select user_id,amount from pay where not is_test and status='paid' union all select user_id,amount from inv where not is_test and status='paid')
select jsonb_build_object(
 'visitors',(select count(distinct identity_key) from ev where event_name='page_view'),
 'starts',(select count(*) from d),
 'completions',(select count(*) from d join public.free_reports f on f.diagnosis_id=d.id where f.created_at<p_end),
 'registered',case when p_test then (select count(*) from auth.users where created_at>=p_start and created_at<p_end and email_confirmed_at is not null) else 0 end,
 'consulting_users',(select count(distinct user_id) from t),'exchanges',(select count(*) from t),
 'return7_denominator',(select count(*) from cohort where first_at<=least(now(),p_end)-interval '7 days'),
 'return7_numerator',(select count(*) from cohort c where first_at<=least(now(),p_end)-interval '7 days' and exists(select 1 from public.analytics_events e where e.event_name='page_view' and coalesce(e.user_id::text,e.anonymous_session_id)=c.k and e.created_at>c.first_at+interval '24 hours' and e.created_at<=c.first_at+interval '7 days' and (p_test or not e.is_test))),
 'return30_denominator',(select count(*) from cohort where first_at<=least(now(),p_end)-interval '30 days'),
 'return30_numerator',(select count(*) from cohort c where first_at<=least(now(),p_end)-interval '30 days' and exists(select 1 from public.analytics_events e where e.event_name='page_view' and coalesce(e.user_id::text,e.anonymous_session_id)=c.k and e.created_at>c.first_at+interval '24 hours' and e.created_at<=c.first_at+interval '30 days' and (p_test or not e.is_test))),
 'active_users',(select count(distinct identity_key) from ev),
 'plus_new',(select count(*) from s where created_at>=p_start and created_at<p_end and paid_through is not null),
 'plus_users',(select count(distinct user_id) from s where created_at>=p_start and created_at<p_end and paid_through is not null),
 'plus_active',(select count(*) from s where status in ('active','past_due') and paid_through>now() and period_end>now() and (cancel_at is null or cancel_at>now())),
 'plus_canceled',(select count(*) from s where status='canceled' and canceled_at>=p_start and canceled_at<p_end),
 'renewal_due',(select count(distinct subscription_id) from public.subscription_invoices where period_end>=p_start and period_end<p_end and status='paid' and (p_test or not is_test)),
 'renewal_paid',(select count(distinct i.subscription_id) from public.subscription_invoices i where i.period_end>=p_start and i.period_end<p_end and i.status='paid' and (p_test or not i.is_test) and exists(select 1 from public.subscription_invoices n where n.subscription_id=i.subscription_id and n.period_start>=i.period_end and n.status='paid' and n.paid_at<p_end)),
 'mrr',(select coalesce(sum(amount),0) from public.subscriptions where not is_test and status in ('active','past_due') and paid_through>now() and period_end>now()),
 'report_sales',(select coalesce(sum(amount),0) from pay where not is_test and status='paid'),
 'monthly_revenue',(select coalesce(sum(amount),0) from real_revenue),'paying_users',(select count(distinct user_id) from real_revenue),
 'test_report_volume',(select coalesce(sum(amount),0) from pay where is_test and status='paid'),
 'test_plus_volume',(select coalesce(sum(amount),0) from inv where is_test and status='paid'),
 'report_buyers',(select count(distinct diagnosis_id) from pay where status='paid' and (p_test or not is_test)),
 'checkout_starts',(select count(*) from ev where event_name in ('checkout_started','plus_checkout_started')),
 'checkouts_completed',(select count(*) from pay where status='paid' and (p_test or not is_test))+(select count(*) from s where created_at>=p_start and created_at<p_end and paid_through is not null),
 'cta_views',(select count(*) from ev where event_name in ('free_report_viewed','plans_viewed')),
 'ai_calls',(select count(*) from ai),
 'ai_failed',(select count(*) from ai where not success),
 'models',(select coalesce(jsonb_agg(x),'[]') from (select model,count(*) calls,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,sum(cached_tokens) cached_tokens,case when count(*)=count(estimated_usd) then sum(estimated_usd) end estimated_usd,round(avg(execution_ms)) latency_ms,count(*) filter(where not success) failed from ai group by model) x),
 'ai_by_plan',(select coalesce(jsonb_agg(x),'[]') from (select plan,count(*) calls,case when count(*)=count(estimated_usd) then sum(estimated_usd) end estimated_usd from ai group by plan) x),
 'ai_by_user',(select coalesce(jsonb_agg(x),'[]') from (select user_id,count(*) calls,case when count(*)=count(estimated_usd) then sum(estimated_usd) end estimated_usd,count(*)>100 abuse_flag from ai where user_id is not null group by user_id order by count(*) desc limit 100) x),
 'stripe_fee',null,'refunds',case when not exists(select 1 from public.payments where status='refunded' and refunded_at>=p_start and refunded_at<p_end and not is_test) and not exists(select 1 from inv where not is_test) then 0 else null end,
 'gross_profit',null,
 'sources',(select coalesce(jsonb_agg(x),'[]') from (select coalesce(metadata->>'source','unknown') source,metadata->>'variant' variant,count(distinct identity_key) visitors from ev where event_name='page_view' group by 1,2) x),
 'cancel_reasons',(select coalesce(jsonb_agg(x),'[]') from (select coalesce(cancellation_reason,'未回答') reason,count(*) count from s where cancel_at_period_end group by 1) x)
);
$$;
revoke all on function public.growth_metrics(timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.growth_metrics(timestamptz,timestamptz,boolean) to service_role;

create or replace function public.apply_subscription_snapshot(p_snapshot jsonb,p_invoices jsonb,p_event text,p_type text,p_hash text) returns void language plpgsql set search_path='' as $$
declare s public.subscriptions; i public.subscription_invoices; begin
 s:=jsonb_populate_record(null::public.subscriptions,p_snapshot);
 if not exists(select 1 from public.billing_customers where user_id=s.user_id and stripe_customer_id=s.stripe_customer_id) then raise exception 'customer mismatch';end if;
 insert into public.subscriptions select s.* on conflict(id) do update set status=excluded.status,period_start=excluded.period_start,period_end=excluded.period_end,paid_through=excluded.paid_through,cancel_at_period_end=excluded.cancel_at_period_end,cancel_at=excluded.cancel_at,cancellation_reason=excluded.cancellation_reason,canceled_at=excluded.canceled_at,updated_at=excluded.updated_at;
 for i in select * from jsonb_populate_recordset(null::public.subscription_invoices,p_invoices) loop
 if i.user_id<>s.user_id or i.subscription_id<>s.id then raise exception 'invoice mismatch';end if;
 insert into public.subscription_invoices select i.* on conflict(id) do update set amount=excluded.amount,status=excluded.status,paid_at=excluded.paid_at,period_start=excluded.period_start,period_end=excluded.period_end;
 end loop;
 if p_event is not null then insert into public.stripe_events(stripe_event_id,event_type,payload_hash) values(p_event,p_type,p_hash) on conflict(stripe_event_id) do nothing;end if;
end $$;
revoke all on function public.apply_subscription_snapshot(jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_subscription_snapshot(jsonb,jsonb,text,text,text) to service_role;
