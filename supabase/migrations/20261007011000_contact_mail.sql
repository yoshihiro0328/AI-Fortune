create table public.contact_mail (
 id uuid primary key default gen_random_uuid(),
 contact_id uuid not null references public.contact_messages(id) on delete cascade,
 kind text not null check(kind in ('receipt','notification','reply')),
 dedupe_key text not null unique,
 payload jsonb not null,
 status text not null default 'queued' check(status in ('queued','sending','accepted','failed','manual_review')),
 attempts integer not null default 0,
 first_attempt_at timestamptz,
 lease_until timestamptz,
 lease_token uuid,
 provider_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.contact_mail enable row level security;
revoke all on public.contact_mail from public, anon, authenticated;
grant all on public.contact_mail to service_role;
create index contact_mail_pending on public.contact_mail(status,created_at);
create index contact_mail_contact on public.contact_mail(contact_id);
create function public.submit_contact(p_id uuid,p_name text,p_email text,p_message text,p_user uuid,p_jobs jsonb) returns uuid language plpgsql security invoker set search_path=public as $$
declare j jsonb;
begin
 insert into public.contact_messages(id,name,email,message,user_id) values(p_id,p_name,p_email,p_message,p_user);
 for j in select * from jsonb_array_elements(p_jobs) loop
  insert into public.contact_mail(contact_id,kind,dedupe_key,payload) values(p_id,j->>'kind',j->>'dedupe_key',j->'payload');
 end loop;
 return p_id;
end $$;
revoke all on function public.submit_contact(uuid,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_contact(uuid,text,text,text,uuid,jsonb) to service_role;
create function public.claim_contact_mail(p_token uuid,p_contact uuid default null) returns setof public.contact_mail language plpgsql security invoker set search_path=public as $$
begin
 -- Resend idempotency is limited to 24h. Never automatically resend after that window.
 update public.contact_mail set status='manual_review',lease_until=null,updated_at=now() where status in ('queued','sending','failed') and first_attempt_at < now()-interval '23 hours';
 return query update public.contact_mail set status='sending',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),lease_token=p_token,lease_until=now()+interval '2 minutes',updated_at=now()
 where id in(select id from public.contact_mail where status in ('queued','failed','sending') and attempts<5 and (lease_until is null or lease_until<now()) and (p_contact is null or contact_id=p_contact) order by created_at for update skip locked limit 2) returning *;
end $$;
revoke all on function public.claim_contact_mail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_contact_mail(uuid,uuid) to service_role;
