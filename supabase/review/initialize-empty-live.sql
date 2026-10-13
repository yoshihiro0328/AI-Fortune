-- NOT a migration; NEVER run against the existing Sandbox project.
-- Owner-only bootstrap AFTER all migrations in a newly created, empty Live project.
-- Stop if any user or transaction exists. No project is created by this script.
begin;
lock table public.payment_environment,public.payments,public.billing_customers,public.subscriptions,public.stripe_events in access exclusive mode;
do $$ begin
 if exists(select 1 from auth.users) or exists(select 1 from public.diagnoses) or exists(select 1 from public.payments) or exists(select 1 from public.subscriptions) or exists(select 1 from public.stripe_events) or exists(select 1 from public.billing_customers) then raise exception 'Live bootstrap requires a NEW EMPTY project'; end if;
end $$;
update public.price_versions set active=false where active;
update public.payment_environment set mode='live',stripe_account_id='acct_1JGOwIIGjFw40K11' where id=true;
update public.price_versions set active=true where id in ('report-live-2026-10-980','plus-live-2026-10-980') and not is_test;
-- Portal configuration IDs cannot cross Stripe environments. Provision a Live configuration later.
update public.service_settings set portal_configuration_id=null;
commit;
