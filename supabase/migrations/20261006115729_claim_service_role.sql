create or replace function public.claim_anonymous_diagnoses(p_user uuid,p_session text) returns integer language plpgsql set search_path='' as $$
declare claimed integer;
begin
 -- Server-only RPC: the route authenticates with getUser and requires email_confirmed_at.
 -- Keep SECURITY INVOKER; service_role must not receive access to auth.users.
 if p_user is null then raise exception 'User required';end if;
 insert into public.profiles(user_id) values(p_user) on conflict(user_id) do nothing;
 update public.diagnoses set user_id=p_user,updated_at=now() where user_id is null and anonymous_session_id=p_session;
 get diagnostics claimed=row_count;
 update public.payments p set user_id=p_user,updated_at=now() from public.diagnoses d where p.diagnosis_id=d.id and d.user_id=p_user and p.user_id is null;
 return claimed;
end $$;
revoke all on function public.claim_anonymous_diagnoses(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_anonymous_diagnoses(uuid,text) to service_role;
