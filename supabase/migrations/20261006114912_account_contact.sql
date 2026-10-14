create table public.contact_messages (
 id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete set null,
 name text not null check(length(name) between 1 and 80),email text not null check(length(email)<=254),message text not null check(length(message) between 10 and 5000),
 status text not null default 'open' check(status in ('open','in_progress','resolved','spam')),admin_note text,created_at timestamptz not null default now(),resolved_at timestamptz
);
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon,authenticated;
grant select,insert,update,delete on public.contact_messages to service_role;
create index contact_messages_status_created_idx on public.contact_messages(status,created_at);
create index contact_messages_user_idx on public.contact_messages(user_id);
create function public.claim_anonymous_diagnoses(p_user uuid,p_session text) returns integer language plpgsql set search_path='' as $$
declare claimed integer;
begin
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise exception 'Verified user required';end if;
 insert into public.profiles(user_id) values(p_user) on conflict(user_id) do nothing;
 update public.diagnoses set user_id=p_user,updated_at=now() where user_id is null and anonymous_session_id=p_session;
 get diagnostics claimed=row_count;
 update public.payments p set user_id=p_user,updated_at=now() from public.diagnoses d where p.diagnosis_id=d.id and d.user_id=p_user and p.user_id is null;
 return claimed;
end $$;
revoke all on function public.claim_anonymous_diagnoses(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_anonymous_diagnoses(uuid,text) to service_role;
