-- Additive continuing consultations. Old report purchases and amounts remain intact.
alter table public.payments drop constraint payments_amount_check;
alter table public.payments add constraint payments_amount_check check(amount in (980,1980));
-- Keep the legacy default for the currently deployed checkout; new checkout sets 980 explicitly.
alter table public.payments add column is_test boolean not null default true;
create table public.service_settings (
 id boolean primary key default true check(id), free_limit int not null default 3 check(free_limit between 0 and 100),
 plus_limit int not null default 30 check(plus_limit between 1 and 1000), updated_at timestamptz not null default now()
);
insert into public.service_settings(id) values(true);
create table public.price_versions (
 id text primary key, kind text not null check(kind in ('report','plus')), amount int not null check(amount>0),
 currency text not null default 'jpy' check(currency='jpy'), stripe_price_id text unique,
 active boolean not null default false, is_test boolean not null default true check(is_test), created_at timestamptz not null default now()
);
create unique index price_versions_current on public.price_versions(kind) where active;
insert into public.price_versions(id,kind,amount) values('report-2026-10-980','report',980),('plus-2026-10-980','plus',980);
create table public.billing_customers (
 user_id uuid primary key references auth.users(id), stripe_customer_id text not null unique,
 checkout_session_id text, created_at timestamptz not null default now()
);
create table public.subscriptions (
 id text primary key, user_id uuid not null references auth.users(id), stripe_customer_id text not null,
 price_version text not null references public.price_versions(id), amount int not null,
 status text not null, period_start timestamptz not null, period_end timestamptz not null,
 paid_through timestamptz, cancel_at_period_end boolean not null default false, cancel_at timestamptz,
 is_test boolean not null default true check(is_test), created_at timestamptz not null, updated_at timestamptz not null default now()
);
create index subscriptions_user_period on public.subscriptions(user_id,period_end);
create table public.subscription_invoices (
 id text primary key, subscription_id text not null references public.subscriptions(id), user_id uuid not null references auth.users(id),
 amount int not null, status text not null, currency text not null, paid_at timestamptz,
 period_start timestamptz not null, period_end timestamptz not null, fee int, refunded_amount int,
 is_test boolean not null default true check(is_test), created_at timestamptz not null
);
create index subscription_invoices_user on public.subscription_invoices(user_id);
create index subscription_invoices_subscription on public.subscription_invoices(subscription_id);
create table public.consultation_subjects (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 nickname text not null check(length(nickname) between 1 and 40), memory jsonb not null default '[]',
 memory_version int not null default 0, memory_reset_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create index consultation_subjects_user on public.consultation_subjects(user_id,updated_at desc);
create table public.consultation_threads (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 subject_id uuid not null, title text not null default '相談の続き' check(length(title) between 1 and 80),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id),
 foreign key(subject_id,user_id) references public.consultation_subjects(id,user_id) on delete cascade
);
create index consultation_threads_subject on public.consultation_threads(subject_id,user_id,updated_at desc);
create index consultation_threads_user on public.consultation_threads(user_id);
create table public.consultation_turns (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, thread_id uuid not null,
 user_text text not null check(length(user_text) between 1 and 4000), assistant_text text,
 status text not null check(status in ('pending','ready','failed')), safety boolean not null default false,
 charged boolean not null default false, plan text not null check(plan in ('free','plus')),
 period_start timestamptz not null, period_end timestamptz not null,
 lease_token uuid, lease_until timestamptz, generation int not null default 0 check(generation between 0 and 3),
 regeneration_key uuid, facts jsonb not null default '[]', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(thread_id,user_id) references public.consultation_threads(id,user_id) on delete cascade
);
create index consultation_turns_thread on public.consultation_turns(thread_id,user_id,created_at);
create index consultation_turns_quota on public.consultation_turns(user_id,created_at) where charged or status='pending';
create table public.subject_diagnoses (
 diagnosis_id uuid primary key references public.diagnoses(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 subject_id uuid not null, linked_at timestamptz not null default now(),
 foreign key(subject_id,user_id) references public.consultation_subjects(id,user_id) on delete cascade
);
create index subject_diagnoses_subject on public.subject_diagnoses(subject_id,user_id);
create index subject_diagnoses_user on public.subject_diagnoses(user_id);
create table public.consultation_ai_calls (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
 turn_id uuid references public.consultation_turns(id) on delete set null, stage text not null, model text not null,
 plan text not null, input_tokens int, cached_tokens int, cache_write_tokens int, output_tokens int,
 estimated_usd numeric, pricing_source text, execution_ms int, success boolean not null default false,
 is_test boolean not null default false, created_at timestamptz not null default now()
);
create index consultation_ai_calls_user on public.consultation_ai_calls(user_id,created_at);
create index consultation_ai_calls_turn on public.consultation_ai_calls(turn_id);
alter table public.analytics_events add column is_test boolean not null default false;
alter table public.ai_calls add column cached_tokens int;
alter table public.ai_calls add column cache_write_tokens int;
alter table public.ai_calls add column pricing_source text;
alter table public.ai_calls add column is_test boolean not null default false;
-- No direct writes or execution with a browser token. Ownership enforced by both RLS and APIs.
do $$ declare t text; begin
 foreach t in array array['service_settings','price_versions','billing_customers','subscriptions','subscription_invoices','consultation_subjects','consultation_threads','consultation_turns','subject_diagnoses','consultation_ai_calls'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['subscriptions','subscription_invoices','consultation_subjects','consultation_threads','consultation_turns','subject_diagnoses'] loop
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy owner_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);
 end loop;
end $$;
create function public.consultation_entitlement(p_user uuid) returns jsonb language plpgsql set search_path='' as $$
declare s public.subscriptions; settings public.service_settings; a timestamptz; b timestamptz; lim int; used int; held int; plan text:='free'; begin
 select * into settings from public.service_settings where id;
 select * into s from public.subscriptions where user_id=p_user and status in ('active','past_due') and paid_through>now() and period_start<=now() and period_end>now() and (cancel_at is null or cancel_at>now()) order by paid_through desc limit 1;
 if s.id is not null then plan:='plus';a:=s.period_start;b:=least(s.period_end,s.paid_through);lim:=settings.plus_limit;
 else a:=date_trunc('month',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';b:=((a at time zone 'Asia/Tokyo')+interval '1 month') at time zone 'Asia/Tokyo';lim:=settings.free_limit;end if;
 select count(*) filter(where charged),count(*) filter(where not charged and status='pending' and lease_until>now()) into used,held from public.consultation_turns where user_id=p_user and created_at>=a and created_at<b;
 return jsonb_build_object('plan',plan,'limit',lim,'used',used,'reserved',held,'remaining',greatest(0,lim-used-held),'period_start',a,'period_end',b);
end $$;
-- A per-user transaction lock makes simultaneous devices and retries share one quota.
-- Short leases and fencing tokens prevent late workers from committing an expired generation.
create function public.reserve_consultation(p_user uuid,p_thread uuid,p_id uuid,p_text text,p_token uuid,p_regenerate boolean,p_safety boolean,p_regeneration_key uuid) returns jsonb language plpgsql set search_path='' as $$
declare t public.consultation_turns; ent jsonb; subject uuid; begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,27));
 select subject_id into subject from public.consultation_threads where id=p_thread and user_id=p_user for update;
 if subject is null then return jsonb_build_object('error','not_found');end if;
 select * into t from public.consultation_turns where id=p_id for update;
 if t.id is not null and (t.user_id<>p_user or t.thread_id<>p_thread or t.user_text<>p_text) then return jsonb_build_object('error','conflict');end if;
 if t.status='pending' and t.lease_until>now() then return jsonb_build_object('error','busy');end if;
 if t.status='ready' and (not p_regenerate or (p_regeneration_key is not null and t.regeneration_key=p_regeneration_key)) then return jsonb_build_object('turn',to_jsonb(t),'cached',true);end if;
 if p_regenerate and (p_regeneration_key is null or t.id is null or t.assistant_text is null or t.generation>=3 or t.safety) then return jsonb_build_object('error','regeneration');end if;
 if exists(select 1 from public.consultation_turns where user_id=p_user and status='pending' and lease_until>now()) then return jsonb_build_object('error','busy');end if;
 ent:=public.consultation_entitlement(p_user);
 if not p_safety and not coalesce(t.charged,false) and (ent->>'remaining')::int<=0 then return jsonb_build_object('error','quota','usage',ent);end if;
 if t.id is null then
 insert into public.consultation_turns(id,user_id,thread_id,user_text,status,plan,period_start,period_end,lease_token,lease_until,safety)
 values(p_id,p_user,p_thread,p_text,'pending',ent->>'plan',(ent->>'period_start')::timestamptz,(ent->>'period_end')::timestamptz,p_token,now()+interval '3 minutes',p_safety) returning * into t;
 else
 update public.consultation_turns set status='pending',lease_token=p_token,lease_until=now()+interval '3 minutes',generation=generation+case when p_regenerate and t.regeneration_key is distinct from p_regeneration_key then 1 else 0 end,regeneration_key=coalesce(p_regeneration_key,regeneration_key),created_at=case when charged then created_at else now() end,period_start=case when charged then period_start else (ent->>'period_start')::timestamptz end,period_end=case when charged then period_end else (ent->>'period_end')::timestamptz end,updated_at=now() where id=p_id returning * into t;
 end if;
 return jsonb_build_object('turn',to_jsonb(t),'usage',ent,'cached',false);
end $$;
create function public.finish_consultation(p_user uuid,p_id uuid,p_token uuid,p_answer text,p_facts jsonb,p_memory jsonb,p_safety boolean,p_success boolean) returns boolean language plpgsql set search_path='' as $$
declare t public.consultation_turns; subject uuid; begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,27));
 select * into t from public.consultation_turns where id=p_id and user_id=p_user and status='pending' and lease_token=p_token and lease_until>now() for update;
 if t.id is null then return false;end if;
 if not p_success then
 update public.consultation_turns set status=case when assistant_text is null then 'failed' else 'ready' end,lease_until=null,lease_token=null,updated_at=now() where id=p_id;return true;end if;
 if p_answer is null or length(p_answer)<1 then raise exception 'empty answer';end if;
 update public.consultation_turns set status='ready',assistant_text=p_answer,facts=p_facts,safety=p_safety,charged=(charged or not p_safety),lease_until=null,lease_token=null,updated_at=now() where id=p_id;
 update public.consultation_threads set updated_at=now() where id=t.thread_id returning subject_id into subject;
 update public.consultation_subjects set memory=p_memory,memory_version=memory_version+1,updated_at=now() where id=subject and user_id=p_user;
 insert into public.analytics_events(user_id,event_name,metadata) values(p_user,case when p_safety then 'consultation_safety' else 'consultation_completed' end,jsonb_build_object('plan',t.plan,'regeneration',t.charged));
 return true;
end $$;
-- Deletes content only; accounting records and their immutable amounts remain separate.
create function public.manage_consultation(p_user uuid,p_action text,p_id uuid,p_target uuid,p_value text,p_memory jsonb) returns boolean language plpgsql set search_path='' as $$
declare old_subject uuid; begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,27));
 if exists(select 1 from public.consultation_turns where user_id=p_user and status='pending' and lease_until>now()) then raise exception 'generation in progress';end if;
 if p_action in ('rename_subject','memory','delete_subject') then
 perform 1 from public.consultation_subjects where id=p_id and user_id=p_user for update;if not found then return false;end if;
 if p_action='rename_subject' then update public.consultation_subjects set nickname=p_value,updated_at=now() where id=p_id;
 elsif p_action='memory' then update public.consultation_subjects set memory=p_memory,memory_version=memory_version+1,memory_reset_at=now(),updated_at=now() where id=p_id;
 else
 -- Retain a content-free quota ledger so deletion cannot reset monthly usage.
 update public.consultation_turns set user_text='[削除済み]',assistant_text=null,facts='[]' where user_id=p_user and thread_id in(select id from public.consultation_threads where subject_id=p_id);
 update public.consultation_subjects set nickname='[削除済み]',memory='[]',memory_reset_at=now(),updated_at=now() where id=p_id;
 delete from public.subject_diagnoses where subject_id=p_id;
 end if;
 elsif p_action in ('move_thread','rename_thread','delete_thread') then
 select subject_id into old_subject from public.consultation_threads where id=p_id and user_id=p_user for update;if old_subject is null then return false;end if;
 if p_action='rename_thread' then update public.consultation_threads set title=p_value where id=p_id;
 elsif p_action='move_thread' then
 perform 1 from public.consultation_subjects where id=p_target and user_id=p_user and nickname<>'[削除済み]';if not found then return false;end if;
 update public.consultation_threads set subject_id=p_target,updated_at=now() where id=p_id;
 update public.consultation_subjects set memory='[]',memory_version=memory_version+1,updated_at=now() where id in(old_subject,p_target);
 else
 update public.consultation_turns set user_text='[削除済み]',assistant_text=null,facts='[]' where thread_id=p_id;
 update public.consultation_threads set title='[削除済み]' where id=p_id;
 update public.consultation_subjects set memory='[]',memory_version=memory_version+1,updated_at=now() where id=old_subject;
 end if;
 elsif p_action='link_diagnosis' then
 perform 1 from public.diagnoses where id=p_id and user_id=p_user;if not found then return false;end if;
 perform 1 from public.consultation_subjects where id=p_target and user_id=p_user and nickname<>'[削除済み]';if not found then return false;end if;
 select subject_id into old_subject from public.subject_diagnoses where diagnosis_id=p_id;
 insert into public.subject_diagnoses(diagnosis_id,user_id,subject_id) values(p_id,p_user,p_target) on conflict(diagnosis_id) do update set subject_id=excluded.subject_id,linked_at=now();
 update public.consultation_subjects set memory='[]',memory_version=memory_version+1,updated_at=now() where id in(old_subject,p_target);
 else return false;end if;
 return true;
end $$;
revoke all on function public.consultation_entitlement(uuid),public.reserve_consultation(uuid,uuid,uuid,text,uuid,boolean,boolean,uuid),public.finish_consultation(uuid,uuid,uuid,text,jsonb,jsonb,boolean,boolean),public.manage_consultation(uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.consultation_entitlement(uuid),public.reserve_consultation(uuid,uuid,uuid,text,uuid,boolean,boolean,uuid),public.finish_consultation(uuid,uuid,uuid,text,jsonb,jsonb,boolean,boolean),public.manage_consultation(uuid,text,uuid,uuid,text,jsonb) to service_role;
alter table public.service_settings add column portal_configuration_id text;
-- Webhook receipt and authoritative Stripe snapshot commit together. Remote fetch is serialized per subscription.
create function public.apply_subscription_snapshot(p_snapshot jsonb,p_invoices jsonb,p_event text,p_type text,p_hash text) returns void language plpgsql set search_path='' as $$
declare s public.subscriptions; i public.subscription_invoices; begin
 s:=jsonb_populate_record(null::public.subscriptions,p_snapshot);
 if not exists(select 1 from public.billing_customers where user_id=s.user_id and stripe_customer_id=s.stripe_customer_id) then raise exception 'customer mismatch';end if;
 insert into public.subscriptions select s.* on conflict(id) do update set status=excluded.status,period_start=excluded.period_start,period_end=excluded.period_end,paid_through=excluded.paid_through,cancel_at_period_end=excluded.cancel_at_period_end,cancel_at=excluded.cancel_at,updated_at=excluded.updated_at;
 for i in select * from jsonb_populate_recordset(null::public.subscription_invoices,p_invoices) loop
 if i.user_id<>s.user_id or i.subscription_id<>s.id then raise exception 'invoice mismatch';end if;
 insert into public.subscription_invoices select i.* on conflict(id) do update set amount=excluded.amount,status=excluded.status,paid_at=excluded.paid_at,period_start=excluded.period_start,period_end=excluded.period_end;
 end loop;
 if p_event is not null then insert into public.stripe_events(stripe_event_id,event_type,payload_hash) values(p_event,p_type,p_hash) on conflict(stripe_event_id) do nothing;end if;
end $$;
revoke all on function public.apply_subscription_snapshot(jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_subscription_snapshot(jsonb,jsonb,text,text,text) to service_role;
