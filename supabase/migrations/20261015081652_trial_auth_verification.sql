-- Forward-only Auth boundary fix; no hosted application without explicit approval.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Pin the trusted migration owner. Do not silently install under an API role.
do $$ begin
 if current_user <> 'postgres' or not exists(select 1 from pg_roles where rolname='postgres' and rolbypassrls)
    or not has_column_privilege('postgres','auth.users','id','SELECT')
    or not has_column_privilege('postgres','auth.users','email_confirmed_at','SELECT') then
  raise exception 'expected trusted postgres owner with Auth verification access';
 end if;
end $$;
-- Deliberately narrow elevation: static read, schema-qualified identifiers, boolean only.
-- The API obtains p_user from auth.getUser(), not request fields; browser roles cannot call it.
create function trial_private.email_verified(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_user is not null and exists(
  select 1 from auth.users where id=p_user and email_confirmed_at is not null
 );
$$;
alter function trial_private.email_verified(uuid) owner to postgres;
revoke all on function trial_private.email_verified(uuid) from public,anon,authenticated,service_role;
grant execute on function trial_private.email_verified(uuid) to service_role;
revoke create on schema trial_private from public,anon,authenticated,service_role;

create or replace function public.trial_claim(p_hash text,p_user uuid,p_turn uuid,p_text text,p_answer text,p_topic text,p_fields jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s trial_private.sessions; t trial_private.turns; subject uuid:=gen_random_uuid(); thread uuid:=gen_random_uuid(); ent jsonb;
begin
 perform 1 from trial_private.settings where id for update;
 -- Auth truth is checked again inside the transaction, never from client metadata.
 if trial_private.email_verified(p_user) is not true then return jsonb_build_object('error','auth');end if;
 if not exists(select 1 from public.payment_environment where mode='sandbox') then return jsonb_build_object('error','paused');end if;
 select * into s from trial_private.sessions where token_hash=p_hash for update;
 if s.id is null or s.expires_at<=now() then return jsonb_build_object('error','expired');end if;
 if s.claimed_by is not null then
  if s.claimed_by=p_user then return jsonb_build_object('threadId',s.claimed_thread);end if;
  return jsonb_build_object('error','ownership');
 end if;
 select * into t from trial_private.turns where id=p_turn and session_id=s.id and status='ready';
 if t.id is null or s.content_deleted or t.payload is null or t.answer is null or t.topic<>p_topic then return jsonb_build_object('error','conflict');end if;
 if p_text is null or p_answer is null or p_fields is null or length(p_text) not between 1 and 1400 or length(p_answer) not between 1 and 500 or jsonb_typeof(p_fields)<>'object' or octet_length(p_fields::text)>3000 then return jsonb_build_object('error','invalid');end if;
 -- One unassigned subject per trial, so different people never share memory automatically.
 insert into public.consultation_subjects(id,user_id,nickname) values(subject,p_user,'あとで整理');
 insert into public.consultation_threads(id,user_id,subject_id,title) values(thread,p_user,subject,left(p_text,40));
 insert into public.trial_thread_context(thread_id,user_id,topic_id,topic_version,intake_data) values(thread,p_user,p_topic,1,p_fields);
 ent:=public.consultation_entitlement(p_user);
 insert into public.consultation_turns(id,user_id,thread_id,user_text,assistant_text,status,safety,charged,plan,period_start,period_end,is_test)
 values(gen_random_uuid(),p_user,thread,p_text,p_answer,'ready',t.safety,false,ent->>'plan',(ent->>'period_start')::timestamptz,(ent->>'period_end')::timestamptz,true);
 update trial_private.sessions set claimed_by=p_user,claimed_thread=thread,content_deleted=true where id=s.id;
 update trial_private.turns set payload=null,answer=null where session_id=s.id;
 return jsonb_build_object('threadId',thread);
end $$;

-- CREATE OR REPLACE preserves the existing claim ACL and owner; explicitly keep its boundary.
revoke all on function public.trial_claim(text,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.trial_claim(text,uuid,uuid,text,text,text,jsonb) to service_role;
commit;
