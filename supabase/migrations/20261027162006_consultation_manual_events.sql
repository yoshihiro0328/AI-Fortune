-- Pending external application. No existing consultation content or entitlement is rewritten.
create table public.consultation_events (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 subject_id uuid not null, event_date date not null, text text not null check(length(btrim(text)) between 1 and 1000),
 source_type text not null default 'manual' check(source_type='manual'),
 revision integer not null default 1 check(revision > 0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(subject_id,user_id) references public.consultation_subjects(id,user_id) on delete cascade
);
create index consultation_events_owner_date on public.consultation_events(user_id,subject_id,event_date desc,id desc);
alter table public.consultation_events enable row level security;
revoke all on public.consultation_events from public,anon,authenticated;
grant select on public.consultation_events to authenticated;
grant all on public.consultation_events to service_role;
create policy consultation_events_owner on public.consultation_events for select to authenticated
using ((select auth.uid())=user_id);
-- All mutations are server-only, serialized against subject deletion. Editing requires the observed revision.
create function public.manage_consultation_event(p_user uuid,p_action text,p_id uuid,p_subject uuid,p_date date,p_text text,p_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.consultation_events; s uuid;
begin
 if p_action not in ('create','update','delete') then return jsonb_build_object('error','invalid'); end if;
 if p_action='create' then s:=p_subject;
 else select subject_id into s from public.consultation_events where id=p_id and user_id=p_user; end if;
 if s is null then return jsonb_build_object('error','not_found'); end if;
 perform 1 from public.consultation_subjects where id=s and user_id=p_user and nickname<>'[削除済み]' for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if p_action='create' then
   select * into e from public.consultation_events where id=p_id;
   if found then
     if e.user_id=p_user and e.subject_id=s and e.event_date=p_date and e.text=btrim(p_text) then return to_jsonb(e); end if;
     return jsonb_build_object('error','conflict');
   end if;
   if (select count(*) from public.consultation_events where user_id=p_user and subject_id=s)>=200 then return jsonb_build_object('error','limit'); end if;
   insert into public.consultation_events(id,user_id,subject_id,event_date,text) values(p_id,p_user,s,p_date,btrim(p_text)) returning * into e;
   return to_jsonb(e);
 end if;
 select * into e from public.consultation_events where id=p_id and user_id=p_user for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if e.revision<>p_revision then return jsonb_build_object('error','conflict'); end if;
 if p_action='delete' then delete from public.consultation_events where id=p_id and user_id=p_user; return jsonb_build_object('id',p_id,'deleted',true); end if;
 update public.consultation_events set event_date=p_date,text=btrim(p_text),revision=revision+1,updated_at=now() where id=p_id and user_id=p_user returning * into e;
 return to_jsonb(e);
end $$;
revoke all on function public.manage_consultation_event(uuid,text,uuid,uuid,date,text,integer) from public,anon,authenticated;
grant execute on function public.manage_consultation_event(uuid,text,uuid,uuid,date,text,integer) to service_role;
-- Existing soft deletion must remove the independent manual notes too.
create function public.clear_deleted_subject_events() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.nickname='[削除済み]' then delete from public.consultation_events where subject_id=new.id and user_id=new.user_id; end if;
 return new;
end $$;
revoke all on function public.clear_deleted_subject_events() from public,anon,authenticated;
grant execute on function public.clear_deleted_subject_events() to service_role;
create trigger clear_deleted_subject_events after update of nickname on public.consultation_subjects
for each row execute function public.clear_deleted_subject_events();
