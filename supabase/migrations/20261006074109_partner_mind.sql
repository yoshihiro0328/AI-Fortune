create table public.profiles(id uuid primary key default gen_random_uuid(),user_id uuid not null unique references auth.users(id) on delete cascade,display_name text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.diagnosis_types(id uuid primary key default gen_random_uuid(),name text not null,slug text not null unique,description text,is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.diagnosis_questions(id uuid primary key default gen_random_uuid(),diagnosis_type_id uuid not null references public.diagnosis_types(id),question_key text not null,question_text text not null,question_type text not null check(question_type in ('radio','select','textarea','text','number','date')),options_json jsonb not null default '[]',placeholder text,required boolean not null default true,sort_order int not null,is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(diagnosis_type_id,question_key));
create table public.diagnoses(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),anonymous_session_id text not null,diagnosis_type_id uuid not null references public.diagnosis_types(id),status text not null default 'answering' check(status in ('answering','followup','analyzing','free_result_ready','payment_pending','paid','report_generating','report_ready','failed','safety')),classification_json jsonb,followup_json jsonb,started_at timestamptz not null default now(),completed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index diagnoses_user_idx on public.diagnoses(user_id);
create index diagnoses_session_idx on public.diagnoses(anonymous_session_id);
create table public.diagnosis_answers(id uuid primary key default gen_random_uuid(),diagnosis_id uuid not null references public.diagnoses(id) on delete cascade,question_id uuid references public.diagnosis_questions(id),question_key text not null,question_text text not null,answer_text text not null check(length(answer_text)<=2000),answer_json jsonb,is_follow_up boolean not null default false,created_at timestamptz not null default now(),unique(diagnosis_id,question_key));
create table public.diagnosis_analyses(id uuid primary key default gen_random_uuid(),diagnosis_id uuid not null unique references public.diagnoses(id) on delete cascade,analysis_json jsonb not null,model text not null,prompt_version text not null,input_tokens int,output_tokens int,estimated_cost numeric,created_at timestamptz not null default now());
create table public.free_reports(id uuid primary key default gen_random_uuid(),diagnosis_id uuid not null unique references public.diagnoses(id) on delete cascade,report_json jsonb not null,model text not null,prompt_version text not null,created_at timestamptz not null default now());
create table public.payments(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),diagnosis_id uuid not null unique references public.diagnoses(id),stripe_customer_id text,stripe_checkout_session_id text unique,stripe_payment_intent_id text unique,amount int not null default 1980 check(amount=1980),currency text not null default 'jpy' check(currency='jpy'),status text not null default 'pending' check(status in ('pending','paid','failed','refunded')),paid_at timestamptz,refunded_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index payments_user_idx on public.payments(user_id);
create table public.paid_reports(id uuid primary key default gen_random_uuid(),diagnosis_id uuid not null unique references public.diagnoses(id),payment_id uuid not null unique references public.payments(id),report_json jsonb,status text not null default 'queued' check(status in ('queued','generating','ready','failed','revoked')),attempts int not null default 0,lease_token uuid,lease_until timestamptz,model text,prompt_version text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.stripe_events(id uuid primary key default gen_random_uuid(),stripe_event_id text not null unique,event_type text not null,payload_hash text not null,processed_at timestamptz not null default now(),created_at timestamptz not null default now());
create table public.ai_calls(id uuid primary key default gen_random_uuid(),diagnosis_id uuid not null references public.diagnoses(id),stage text not null,model text not null,prompt_version text not null,input_tokens int,output_tokens int,estimated_cost numeric,execution_time int,success boolean not null,created_at timestamptz not null default now());
create index ai_calls_diagnosis_idx on public.ai_calls(diagnosis_id);
create table public.rate_limits(key text primary key,count int not null,expires_at timestamptz not null);
create table public.operation_locks(key text primary key,token uuid not null,expires_at timestamptz not null);
create table public.analytics_events(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),anonymous_session_id text,event_name text not null,metadata jsonb not null default '{}',created_at timestamptz not null default now());
create index analytics_events_name_time_idx on public.analytics_events(event_name,created_at);
create table public.conversations(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),title text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index conversations_user_idx on public.conversations(user_id);
create table public.conversation_messages(id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id),role text not null check(role in ('user','assistant')),content text not null,created_at timestamptz not null default now());
create index conversation_messages_parent_idx on public.conversation_messages(conversation_id);
create table public.affiliate_products(id uuid primary key default gen_random_uuid(),service_name text not null,category text,affiliate_url text,reward numeric,target_age_min int,target_age_max int,target_gender text,purpose text,conditions_json jsonb,priority_score int default 0,is_active boolean default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.affiliate_recommendations(id uuid primary key default gen_random_uuid(),diagnosis_id uuid not null references public.diagnoses(id),affiliate_product_id uuid not null references public.affiliate_products(id),reason text,score numeric,created_at timestamptz not null default now());
create table public.affiliate_clicks(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),diagnosis_id uuid references public.diagnoses(id),affiliate_product_id uuid not null references public.affiliate_products(id),source text,created_at timestamptz not null default now());
-- Anonymous access is through a server-only API with a hashed, HttpOnly bearer cookie.
-- The public Data API exposes no private records to anon. Account owners get read-only RLS.
do $$ declare t text; begin
 foreach t in array array['profiles','diagnosis_types','diagnosis_questions','diagnoses','diagnosis_answers','diagnosis_analyses','free_reports','paid_reports','payments','stripe_events','ai_calls','rate_limits','operation_locks','analytics_events','conversations','conversation_messages','affiliate_products','affiliate_recommendations','affiliate_clicks'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant select on public.diagnosis_types,public.diagnosis_questions to anon,authenticated;
create policy active_types on public.diagnosis_types for select to anon,authenticated using(is_active);
create policy active_questions on public.diagnosis_questions for select to anon,authenticated using(is_active);
grant select on public.profiles,public.diagnoses,public.diagnosis_answers,public.free_reports,public.payments,public.paid_reports,public.conversations,public.conversation_messages to authenticated;
create policy own_profile on public.profiles for select to authenticated using(user_id=(select auth.uid()));
create policy own_diagnosis on public.diagnoses for select to authenticated using(user_id=(select auth.uid()));
create policy own_answers on public.diagnosis_answers for select to authenticated using(exists(select 1 from public.diagnoses d where d.id=diagnosis_id and d.user_id=(select auth.uid())));
create policy own_free on public.free_reports for select to authenticated using(exists(select 1 from public.diagnoses d where d.id=diagnosis_id and d.user_id=(select auth.uid())));
create policy own_payments on public.payments for select to authenticated using(exists(select 1 from public.diagnoses d where d.id=diagnosis_id and d.user_id=(select auth.uid())));
create policy own_paid on public.paid_reports for select to authenticated using(status='ready' and exists(select 1 from public.diagnoses d join public.payments p on p.diagnosis_id=d.id where d.id=paid_reports.diagnosis_id and d.user_id=(select auth.uid()) and p.status='paid' and p.id=paid_reports.payment_id));
create policy own_conversations on public.conversations for select to authenticated using(user_id=(select auth.uid()));
create policy own_messages on public.conversation_messages for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and c.user_id=(select auth.uid())));

create function public.consume_limit(p_key text,p_limit int,p_seconds int) returns boolean language plpgsql set search_path='' as $$
declare n int; begin
 insert into public.rate_limits(key,count,expires_at) values(p_key,1,now()+make_interval(secs=>p_seconds)) on conflict(key) do update set count=case when public.rate_limits.expires_at<now() then 1 else public.rate_limits.count+1 end,expires_at=case when public.rate_limits.expires_at<now() then now()+make_interval(secs=>p_seconds) else public.rate_limits.expires_at end returning count into n;
 return n<=p_limit;
end $$;
create function public.acquire_lock(p_key text,p_token uuid) returns boolean language plpgsql set search_path='' as $$
declare n int;begin
 insert into public.operation_locks values(p_key,p_token,now()+interval '5 minutes') on conflict(key) do update set token=p_token,expires_at=now()+interval '5 minutes' where public.operation_locks.expires_at<now();
 get diagnostics n=row_count; return n=1;
end $$;
-- One transaction: deduplication + authoritative paid state + durable generation job.
create function public.apply_stripe_event(p_event text,p_type text,p_hash text,p_session text,p_intent text,p_payment uuid,p_amount int,p_currency text,p_state text) returns boolean language plpgsql set search_path='' as $$
declare p public.payments; n int;begin
 insert into public.stripe_events(stripe_event_id,event_type,payload_hash) values(p_event,p_type,p_hash) on conflict(stripe_event_id) do nothing;
 get diagnostics n=row_count;if n=0 then return false;end if;
 select * into p from public.payments where (p_payment is not null and id=p_payment) or (p_intent is not null and stripe_payment_intent_id=p_intent) for update;
 if p.id is null then raise exception 'payment not found';end if;
 if p_state='paid' then
  if p_amount<>p.amount or p_currency<>p.currency or p_session is null or p_intent is null or (p.stripe_checkout_session_id is not null and p.stripe_checkout_session_id<>p_session) then raise exception 'payment mismatch';end if;
  if p.status='refunded' then return true;end if;
  update public.payments set status='paid',stripe_checkout_session_id=p_session,stripe_payment_intent_id=p_intent,paid_at=coalesce(paid_at,now()),updated_at=now() where id=p.id;
  insert into public.paid_reports(diagnosis_id,payment_id) values(p.diagnosis_id,p.id) on conflict(diagnosis_id) do nothing;
  update public.diagnoses set status='paid',updated_at=now() where id=p.diagnosis_id and status<>'report_ready';
  if p.status<>'paid' then insert into public.analytics_events(event_name,metadata) values('payment_completed',jsonb_build_object('diagnosis_id',p.diagnosis_id));end if;
 elsif p_state='refunded' then
  update public.payments set status='refunded',refunded_at=now(),updated_at=now() where id=p.id;
  update public.paid_reports set status='revoked',report_json=null,updated_at=now() where payment_id=p.id;
 elsif p_state='failed' then
  update public.payments set status='failed',updated_at=now() where id=p.id and status='pending';
 end if;return true;
end $$;
create function public.claim_report(p_diagnosis uuid,p_token uuid) returns setof public.paid_reports language sql set search_path='' as $$
 update public.paid_reports r set status='generating',attempts=attempts+1,lease_token=p_token,lease_until=now()+interval '5 minutes',updated_at=now()
 where r.diagnosis_id=p_diagnosis and r.attempts<5 and (r.status in ('queued','failed') or (r.status='generating' and r.lease_until<now())) and exists(select 1 from public.payments p where p.id=r.payment_id and p.status='paid') returning r.*;
$$;
create function public.finish_report(p_diagnosis uuid,p_token uuid,p_report jsonb,p_model text,p_version text) returns boolean language plpgsql set search_path='' as $$
declare n int; begin
 perform 1 from public.payments where diagnosis_id=p_diagnosis and status='paid' for update;
 if not found then return false;end if;
 update public.paid_reports set status='ready',report_json=p_report,model=p_model,prompt_version=p_version,lease_until=null,updated_at=now() where diagnosis_id=p_diagnosis and lease_token=p_token and status='generating';
 get diagnostics n=row_count;
 if n=1 then update public.diagnoses set status='report_ready',updated_at=now() where id=p_diagnosis;end if;return n=1;
end $$;
revoke all on function public.consume_limit(text,int,int),public.acquire_lock(text,uuid),public.apply_stripe_event(text,text,text,text,text,uuid,int,text,text),public.claim_report(uuid,uuid),public.finish_report(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.consume_limit(text,int,int),public.acquire_lock(text,uuid),public.apply_stripe_event(text,text,text,text,text,uuid,int,text,text),public.claim_report(uuid,uuid),public.finish_report(uuid,uuid,jsonb,text,text) to service_role;
insert into public.diagnosis_types(name,slug,description) values('相手の心理診断','partner-mind','ふたりの関係を、回答に基づいて整理します');
insert into public.diagnosis_questions(diagnosis_type_id,question_key,question_text,question_type,options_json,placeholder,sort_order)
select d.id,q.key,q.text,q.type,q.opts::jsonb,q.placeholder,q.n from public.diagnosis_types d cross join (values
('relationship','現在の相手との関係は？','radio','["交際中","片思い","友人","曖昧な関係","元恋人","マッチングアプリで知り合った","その他"]',null,1),
('duration','知り合ってからどのくらいですか？','radio','["1か月未満","1〜3か月","3〜6か月","半年〜1年","1年以上"]',null,2),
('last_meeting','最後に会ったのはいつですか？','radio','["1週間以内","1か月以内","1〜3か月前","3か月以上前","まだ会っていない"]',null,3),
('contact','現在どの程度LINEやDMをしていますか？','radio','["ほぼ毎日","週に数回","週に1回ほど","月に数回","ほとんどない"]',null,4),
('reply_change','以前と比較して返信速度は変化しましたか？','radio','["早くなった","変わらない","少し遅くなった","かなり遅くなった","まだ分からない"]',null,5),
('initiative','相手から連絡してくる割合は？','radio','["相手からが多い","同じくらい","自分からが多い","ほぼ自分から","まだ分からない"]',null,6),
('next_meeting','次に会う予定はありますか？','radio','["日時が決まっている","会う話はしている","まだ予定はない","断られた・延期になった"]',null,7),
('behavior','最近気になった相手の行動は？','textarea','[]','いつ、どんなことがあったか。分かる範囲で大丈夫です。',8),
('concern','現在、一番不安に思っていることは？','textarea','[]','うまく言葉にならなくても、そのまま書いてください。',9),
('goal','最終的に相手とどうなりたいですか？','textarea','[]','あなたが望む関係や、大切にしたいことを教えてください。',10)
) as q(key,text,type,opts,placeholder,n) where d.slug='partner-mind';
