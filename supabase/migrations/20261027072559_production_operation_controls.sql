-- Local preparation only. No production binding, budget or enablement is seeded.
create table public.production_controls (
  singleton boolean primary key default true check (singleton),
  environment_id text not null check (environment_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
  sales_enabled boolean not null default false,
  generation_enabled boolean not null default false,
  daily_limit_nusd bigint not null default 0 check (daily_limit_nusd between 0 and 1000000000000),
  monthly_limit_nusd bigint not null default 0 check (monthly_limit_nusd between 0 and 1000000000000),
  pricing_valid_until timestamptz not null default '-infinity',
  updated_at timestamptz not null default now()
);
create table public.production_ai_reservations (
  id uuid primary key,
  environment_id text not null,
  reserved_at timestamptz not null default now(),
  max_output_tokens integer not null check (max_output_tokens between 1 and 8500),
  reserved_nusd bigint not null check (reserved_nusd > 0),
  state text not null default 'reserved' check (state in ('reserved','dispatched','unknown','settled')),
  settled_at timestamptz,
  settled_nusd bigint check (settled_nusd between 0 and reserved_nusd),
  input_tokens integer,
  output_tokens integer,
  check ((state = 'settled') = (settled_nusd is not null)),
  check ((state = 'settled') = (settled_at is not null))
);
create index production_ai_unsettled on public.production_ai_reservations(environment_id) where state <> 'settled';
create index production_ai_period on public.production_ai_reservations(environment_id,settled_at) where state = 'settled';
alter table public.production_controls enable row level security;
alter table public.production_ai_reservations enable row level security;
revoke all on public.production_controls, public.production_ai_reservations from public, anon, authenticated;
grant select,insert,update on public.production_controls, public.production_ai_reservations to service_role;

create function public.production_sales_allowed(p_environment text) returns boolean
language sql security invoker set search_path = '' as $$
 select exists(select 1 from public.production_controls where singleton
 and environment_id=p_environment and sales_enabled and generation_enabled
 and daily_limit_nusd>0 and monthly_limit_nusd>0 and pricing_valid_until>now()
 and daily_limit_nusd >= 584512500 + coalesce((select sum(case when r.state<>'settled' then r.reserved_nusd else r.settled_nusd end) from public.production_ai_reservations r where r.environment_id=p_environment and (r.state<>'settled' or greatest(r.reserved_at,r.settled_at) >= (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))),0)
 and monthly_limit_nusd >= 584512500 + coalesce((select sum(case when r.state<>'settled' then r.reserved_nusd else r.settled_nusd end) from public.production_ai_reservations r where r.environment_id=p_environment and (r.state<>'settled' or greatest(r.reserved_at,r.settled_at) >= (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'))),0));
$$;

create function public.reserve_production_ai(p_id uuid,p_environment text,p_max_output integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare c public.production_controls%rowtype; held bigint; daily bigint; monthly bigint;
 amount bigint; today timestamptz; month_start timestamptz;
begin
 select * into c from public.production_controls where singleton for update;
 if not found or c.environment_id<>p_environment or not c.generation_enabled
 or c.pricing_valid_until<=now() or p_id is null or p_max_output is null
 or p_max_output not between 1 and 8500 then return false; end if;
 -- One DB lock serializes all workers and both UTC accounting periods.
 if exists(select 1 from public.production_ai_reservations where id=p_id) then return false; end if;
 amount := 1050000::bigint*550 + p_max_output::bigint*825;
 today := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 month_start := date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(reserved_nusd) filter(where state<>'settled'),0),
 coalesce(sum(settled_nusd) filter(where state='settled' and greatest(reserved_at,settled_at)>=today),0),
 coalesce(sum(settled_nusd) filter(where state='settled' and greatest(reserved_at,settled_at)>=month_start),0)
 into held,daily,monthly from public.production_ai_reservations where environment_id=p_environment;
 -- Unknown reservations carry across day/month boundaries; never auto-release.
 if held+daily+amount>c.daily_limit_nusd or held+monthly+amount>c.monthly_limit_nusd then return false; end if;
 insert into public.production_ai_reservations(id,environment_id,max_output_tokens,reserved_nusd)
 values(p_id,p_environment,p_max_output,amount);
 return true;
end $$;

create function public.dispatch_production_ai(p_id uuid,p_environment text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare c public.production_controls%rowtype; changed integer;
begin
 select * into c from public.production_controls where singleton for update;
 if not found or c.environment_id<>p_environment or not c.generation_enabled or c.pricing_valid_until<=now() then return false; end if;
 update public.production_ai_reservations set state='dispatched'
 where id=p_id and environment_id=p_environment and state='reserved';
 get diagnostics changed = row_count;
 return changed=1;
end $$;

create function public.finish_production_ai(p_id uuid,p_environment text,p_input integer,p_output integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare r public.production_ai_reservations%rowtype; amount bigint;
begin
 perform 1 from public.production_controls where singleton for update;
 select * into r from public.production_ai_reservations where id=p_id and environment_id=p_environment for update;
 if not found or r.state<>'dispatched' or p_input is null or p_output is null
 or p_input not between 0 and 1050000 or p_output not between 0 and r.max_output_tokens then return false; end if;
 amount := p_input::bigint*(case when p_input>272000 then 550 else 275 end)
 + p_output::bigint*(case when p_input>272000 then 825 else 550 end);
 if amount>r.reserved_nusd then return false; end if;
 update public.production_ai_reservations set state='settled',settled_at=now(),settled_nusd=amount,input_tokens=p_input,output_tokens=p_output where id=p_id;
 return true;
end $$;

create function public.stop_unknown_production_ai(p_id uuid,p_environment text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
 perform 1 from public.production_controls where singleton for update;
 update public.production_ai_reservations set state='unknown' where id=p_id and environment_id=p_environment and state='dispatched';
 if exists(select 1 from public.production_ai_reservations where id=p_id and environment_id=p_environment) then
 update public.production_controls set generation_enabled=false,updated_at=now() where singleton and environment_id=p_environment;
 end if;
end $$;
revoke all on function public.production_sales_allowed(text),public.reserve_production_ai(uuid,text,integer),public.dispatch_production_ai(uuid,text),public.finish_production_ai(uuid,text,integer,integer),public.stop_unknown_production_ai(uuid,text) from public,anon,authenticated;
grant execute on function public.production_sales_allowed(text),public.reserve_production_ai(uuid,text,integer),public.dispatch_production_ai(uuid,text),public.finish_production_ai(uuid,text,integer,integer),public.stop_unknown_production_ai(uuid,text) to service_role;
