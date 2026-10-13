-- READ ONLY; run only after approval to access the external DB.
select version,name from supabase_migrations.schema_migrations where name='stripe_environment_isolation';
select table_name,column_name from information_schema.columns where table_schema='public' and
 ((table_name='payment_environment') or
 (table_name='payments' and column_name='price_version') or
 (table_name in ('billing_customers','stripe_events') and column_name='is_test') or
 (table_name='price_versions' and column_name='stripe_product_id')) order by table_name,column_name;
select proname,pg_get_function_identity_arguments(oid) arguments from pg_proc where pronamespace='public'::regnamespace and proname in ('payment_is_test','protect_payment_environment','guard_payment_environment','guard_price_environment','apply_stripe_event_v2');
select tgname,relname from pg_trigger join pg_class on pg_class.oid=tgrelid where not tgisinternal and tgname in ('protect_payment_environment','payments_environment','customers_environment','subscriptions_environment','invoices_environment','events_environment','price_environment');
select count(*) total,count(*) filter(where not is_test) live from public.payments;
select count(*) total,count(*) filter(where not is_test) live from public.subscriptions;
select count(*) total,count(*) filter(where not is_test) live from public.subscription_invoices;
select id,kind,amount,currency,stripe_price_id,active,is_test from public.price_versions;
-- Record these results before/after. Only the explicit price-version metadata additions may differ.
select 'payments' name,md5(coalesce(string_agg((to_jsonb(t)-'price_version')::text,'|' order by id),'')) digest from public.payments t
union all select 'paid_reports',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.paid_reports t
union all select 'subscriptions',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.subscriptions t
union all select 'invoices',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.subscription_invoices t;
