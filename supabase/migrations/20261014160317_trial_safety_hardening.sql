-- Additive safety review. Apply only after trial_foundation and explicit approval.
begin;
-- Delayed settlement remains in the anonymous ledger after content expiry/purge.
create or replace function public.trial_reserve(p_hash text,p_request uuid,p_body_hash text,p_topic text,p_payload text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg trial_private.settings; s trial_private.sessions; t trial_private.turns; price trial_private.prices; c trial_private.calls;
 cost bigint; daily bigint; rolling bigint; recent bigint; held int; used_ip int; token uuid:=gen_random_uuid();
begin
 -- A single settings row orders all budget/session mutations, including settlement and purge.
 select * into cfg from trial_private.settings where id for update;
 select * into s from trial_private.sessions where token_hash=p_hash for update;
 if s.id is null or s.expires_at<=now() then return jsonb_build_object('error','expired');end if;
 if s.claimed_by is not null or s.content_deleted then return jsonb_build_object('error','claimed');end if;
 select * into t from trial_private.turns where session_id=s.id and request_id=p_request;
 if t.id is not null and t.body_hash<>p_body_hash then return jsonb_build_object('error','conflict');end if;
 if t.status='ready' then return jsonb_build_object('cached',true,'turn',to_jsonb(t)-'session_id'-'body_hash'-'lease_token');end if;
 if not cfg.enabled or cfg.cleaned_at is null or cfg.cleaned_at<now()-interval '10 minutes' or cfg.cleaned_at>now() or not exists(select 1 from public.payment_environment where mode='sandbox') then return jsonb_build_object('error','paused');end if;
 if exists(select 1 from trial_private.turns where session_id=s.id and status='pending' and lease_until>now()) then return jsonb_build_object('error','busy');end if;
 if s.successes>=cfg.success_limit or s.attempts>=cfg.attempt_limit then return jsonb_build_object('error','quota');end if;
 select coalesce(hits,0) into used_ip from trial_private.counters where key='answer:'||s.ip_hash and expires_at>now();
 select count(*) into held from trial_private.turns tt join trial_private.sessions ss on ss.id=tt.session_id where ss.ip_hash=s.ip_hash and tt.status='pending' and tt.lease_until>now();
 if coalesce(used_ip,0)+held>=cfg.ip_success_limit then return jsonb_build_object('error','rate');end if;
 select * into price from trial_private.prices where model=cfg.model and valid_until>now();
 if not found then return jsonb_build_object('error','pricing');end if;
 cost:=2*(cfg.input_limit::bigint*price.input_nusd+cfg.output_limit::bigint*price.output_nusd);
 select coalesce(sum(coalesce(settled_nusd,reserved_nusd)) filter(where budget_day=(now() at time zone 'Asia/Tokyo')::date),0),
 coalesce(sum(coalesce(settled_nusd,reserved_nusd)) filter(where created_at>=now()-interval '30 days'),0) into daily,rolling from trial_private.calls;
 select coalesce(sum(coalesce(settled_nusd,reserved_nusd)),0) into recent from trial_private.calls where created_at>=now()-interval '24 hours' or settled_nusd is null;
 if daily+cost>cfg.daily_nusd or recent+cost>cfg.daily_nusd or rolling+cost>cfg.rolling_nusd then return jsonb_build_object('error','budget');end if;
 -- Expired jobs cannot later overwrite a new attempt. Their cost remains reserved.
 update trial_private.calls set status='uncertain' where status='reserved' and turn_id in (select id from trial_private.turns where session_id=s.id and status='pending');
 update trial_private.turns set status='failed' where session_id=s.id and status='pending';
 if t.id is null then
  insert into trial_private.turns(session_id,request_id,body_hash,topic,payload,status,lease_token,lease_until)
  values(s.id,p_request,p_body_hash,p_topic,p_payload,'pending',token,least(s.expires_at,now()+interval '90 seconds')) returning * into t;
 else
  update trial_private.turns set status='pending',payload=p_payload,lease_token=token,lease_until=least(s.expires_at,now()+interval '90 seconds') where id=t.id returning * into t;
 end if;
 update trial_private.sessions set attempts=attempts+1 where id=s.id;
 insert into trial_private.calls(turn_id,lease_token,environment,brand,model,pricing_version,input_nusd,output_nusd,input_limit,output_limit,reserved_nusd,status)
 values(t.id,token,cfg.environment,cfg.brand,price.model,price.version,price.input_nusd,price.output_nusd,cfg.input_limit,cfg.output_limit,cost,'reserved') returning * into c;
 return jsonb_build_object('call',to_jsonb(c),'turnId',t.id,'lease',token);
end $$;

create or replace function public.trial_finish(p_call uuid,p_lease uuid,p_answer text,p_safety boolean,p_input int,p_output int,p_provider text,p_not_sent boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg trial_private.settings; c trial_private.calls; t trial_private.turns; s trial_private.sessions; actual bigint; valid boolean; release_cost boolean;
begin
 select * into cfg from trial_private.settings where id for update;
 select * into c from trial_private.calls where id=p_call and lease_token=p_lease for update;
 if not found then return jsonb_build_object('error','conflict');end if;
 if c.status in ('settled','released') then return jsonb_build_object('settled',true);end if;
 select * into t from trial_private.turns where id=c.turn_id for update;
 select * into s from trial_private.sessions where id=t.session_id for update;
 valid:=p_input is not null and p_output is not null and p_input>=0 and p_output>=0;
 release_cost:=p_not_sent is true and p_input is null and p_output is null and p_provider is null and c.status='reserved';
 if (p_input is not null or p_output is not null) and not valid then update trial_private.settings set enabled=false where id;end if;
 actual:=case when valid then p_input::bigint*c.input_nusd+p_output::bigint*c.output_nusd else null end;
 if valid and (p_input>c.input_limit or p_output>c.output_limit or actual>c.reserved_nusd) then
  update trial_private.settings set enabled=false where id;
 end if;
 update trial_private.calls set status=case when release_cost then 'released' when valid then 'settled' else 'uncertain' end,
 settled_nusd=case when release_cost then 0 else actual end,input_tokens=p_input,output_tokens=p_output,provider_id=left(p_provider,200)
 where id=c.id;
 if t.id is null or t.lease_token<>p_lease or t.status<>'pending' or t.lease_until<=now() or s.expires_at<=now() or s.content_deleted or s.claimed_by is not null then return jsonb_build_object('error','expired');end if;
 if p_answer is not null and valid and p_input<=c.input_limit and p_output<=c.output_limit and actual<=c.reserved_nusd and p_not_sent is false then
  update trial_private.turns set status='ready',answer=p_answer,safety=p_safety where id=t.id;
  update trial_private.sessions set successes=successes+1 where id=s.id;
  update trial_private.calls set success=true where id=c.id;
  insert into trial_private.counters as k(key,hits,expires_at) values('answer:'||s.ip_hash,1,now()+interval '24 hours')
  on conflict(key) do update set hits=case when k.expires_at<=now() then 1 else k.hits+1 end,expires_at=case when k.expires_at<=now() then excluded.expires_at else k.expires_at end;
  return jsonb_build_object('ok',true);
 end if;
 update trial_private.turns set status='failed' where id=t.id;
 return jsonb_build_object('error','provider');
end $$;

create or replace function public.trial_cleanup() returns jsonb language plpgsql security invoker set search_path='' as $$
declare deleted int; last_clean timestamptz;
begin
 select cleaned_at into last_clean from trial_private.settings where id for update;
 if last_clean<now()-interval '10 minutes' then update trial_private.settings set enabled=false where id;end if;
 update trial_private.calls set status='uncertain' where status='reserved' and turn_id in (select id from trial_private.turns where lease_until<=now());
 update trial_private.turns set status='failed' where status='pending' and lease_until<=now();
 delete from trial_private.sessions where expires_at<=now();get diagnostics deleted=row_count;
 delete from trial_private.challenges where expires_at<=now();
 delete from trial_private.counters where expires_at<=now();
 delete from public.rate_limits where key like 'auth-signup:ip:%' and expires_at<=now();
 -- No text, IP, user ID or cookie in cost records. 35 days supports the rolling 30-day budget.
 if exists(select 1 from trial_private.calls where created_at<now()-interval '35 days' and settled_nusd is null) then update trial_private.settings set enabled=false where id;end if;
 delete from trial_private.calls where created_at<now()-interval '35 days';
 update trial_private.settings set cleaned_at=now() where id;
 return jsonb_build_object('deletedSessions',deleted);
end $$;

create or replace function public.trial_claim(p_hash text,p_user uuid,p_turn uuid,p_text text,p_answer text,p_topic text,p_fields jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s trial_private.sessions; t trial_private.turns; subject uuid:=gen_random_uuid(); thread uuid:=gen_random_uuid(); ent jsonb;
begin
 perform 1 from trial_private.settings where id for update;
 -- Auth truth is checked again inside the transaction, never from client metadata.
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then return jsonb_build_object('error','auth');end if;
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

create or replace function public.trial_create(p_hash text,p_ip text,p_challenge text,p_consent text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg trial_private.settings; s trial_private.sessions; k text; lim int; hits int; hour_key text; day_key text;
begin
 select * into cfg from trial_private.settings where id for update;
 if not cfg.enabled or cfg.cleaned_at is null or cfg.cleaned_at<now()-interval '10 minutes' or cfg.cleaned_at>now() or not exists(select 1 from public.payment_environment where mode='sandbox') then return jsonb_build_object('error','paused');end if;
 if p_consent<>'trial-2026-10-15' or p_hash !~ '^[a-f0-9]{64}$' or p_ip !~ '^[a-f0-9]{64}$' or p_challenge !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','invalid');end if;
 select * into s from trial_private.sessions where token_hash=p_hash and expires_at>now();
 if found then return jsonb_build_object('expiresAt',s.expires_at);end if;
 if exists(select 1 from trial_private.challenges where hash=p_challenge) then return jsonb_build_object('error','challenge');end if;
 hour_key:='issue:hour:'||p_ip;day_key:='issue:day:'||p_ip;
 foreach k in array array[hour_key,day_key,'issue:global'] loop
  lim:=case k when hour_key then cfg.ip_hour_limit when day_key then cfg.ip_day_limit else cfg.session_daily_limit end;
  select c.hits into hits from trial_private.counters c where key=k and expires_at>now();
  if coalesce(hits,0)>=lim then return jsonb_build_object('error','rate');end if;
 end loop;
 foreach k in array array[hour_key,day_key,'issue:global'] loop
  insert into trial_private.counters as c(key,hits,expires_at) values(k,1,now()+case when k=hour_key then interval '1 hour' else interval '24 hours' end)
  on conflict(key) do update set hits=case when c.expires_at<=now() then 1 else c.hits+1 end,
  expires_at=case when c.expires_at<=now() then excluded.expires_at else c.expires_at end;
 end loop;
 insert into trial_private.challenges values(p_challenge,now()+interval '7 days');
 insert into trial_private.sessions(token_hash,ip_hash,expires_at,consent_version) values(p_hash,p_ip,now()+make_interval(secs=>cfg.retention_seconds),p_consent) returning * into s;
 return jsonb_build_object('expiresAt',s.expires_at);
end $$;

-- One source of truth for public availability; no identities, input or cost rows exposed.
create function public.trial_availability() returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg trial_private.settings; price trial_private.prices; daily bigint; rolling bigint; recent bigint; cost bigint; available boolean;
begin
 select * into cfg from trial_private.settings where id;
 select * into price from trial_private.prices where model=cfg.model and valid_until>now();
 cost:=2*(cfg.input_limit::bigint*price.input_nusd+cfg.output_limit::bigint*price.output_nusd);
 select coalesce(sum(coalesce(settled_nusd,reserved_nusd)) filter(where budget_day=(now() at time zone 'Asia/Tokyo')::date),0),
 coalesce(sum(coalesce(settled_nusd,reserved_nusd)) filter(where created_at>=now()-interval '30 days'),0),
 coalesce(sum(coalesce(settled_nusd,reserved_nusd)) filter(where created_at>=now()-interval '24 hours' or settled_nusd is null),0)
 into daily,rolling,recent from trial_private.calls;
 available:=cfg.enabled and cfg.cleaned_at>=now()-interval '10 minutes' and cfg.cleaned_at<=now()
 and exists(select 1 from public.payment_environment where mode='sandbox') and cost is not null
 and daily+cost<=cfg.daily_nusd and recent+cost<=cfg.daily_nusd and rolling+cost<=cfg.rolling_nusd;
 return jsonb_build_object('enabled',coalesce(available,false),'maxLength',cfg.text_limit,'retentionHours',cfg.retention_seconds/3600.0);
end $$;

-- Monitor via service_role only; this function does not refresh the cleanup heartbeat.
create function public.trial_health() returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('enabled',s.enabled,'cleanedAt',s.cleaned_at,
 'healthy',coalesce(s.cleaned_at>=now()-interval '10 minutes' and s.cleaned_at<=now(),false)
 and not exists(select 1 from trial_private.sessions where expires_at<now()-interval '5 minutes')
 and exists(select 1 from trial_private.prices where model=s.model and valid_until>now()),
 'overdueSessions',(select count(*) from trial_private.sessions where expires_at<now()-interval '5 minutes'),
 'unsettledCalls',(select count(*) from trial_private.calls where settled_nusd is null),
 'pricingExpiresAt',(select valid_until from trial_private.prices where model=s.model))
 from trial_private.settings s where id
$$;
create function public.trial_pause() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 update trial_private.settings set enabled=false where id;
 return jsonb_build_object('paused',true);
end $$;

revoke all on function public.trial_availability(),public.trial_health(),public.trial_pause() from public,anon,authenticated;
grant execute on function public.trial_availability(),public.trial_health(),public.trial_pause() to service_role;
-- CREATE OR REPLACE preserves the original function privileges; no browser grants added.
commit;
