begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); s text:=gen_random_uuid()::text; n integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values(a,a::text||'@example.com',now()),(b,b::text||'@example.com',now()),(c,c::text||'@example.com',null);
 insert into public.diagnoses(id,anonymous_session_id,diagnosis_type_id) values(d,s,(select id from public.diagnosis_types limit 1));
 execute 'set local role service_role';
 select public.claim_anonymous_diagnoses(a,s) into n;
 execute 'reset role';
 assert n=1,'first claim';
 select public.claim_anonymous_diagnoses(b,s) into n;
 assert n=0,'other user cannot claim owned diagnosis';
 assert (select user_id=a from public.diagnoses where id=d),'owner unchanged';
 assert exists(select 1 from public.profiles where user_id=a),'profile created';
 assert not has_function_privilege('anon','public.claim_anonymous_diagnoses(uuid,text)','EXECUTE'),'anonymous RPC denied';
 assert not has_function_privilege('authenticated','public.claim_anonymous_diagnoses(uuid,text)','EXECUTE'),'authenticated RPC denied';
 assert not has_table_privilege('anon','public.contact_messages','SELECT'),'contact anonymous denied';
 assert not has_table_privilege('authenticated','public.contact_messages','SELECT'),'contact user denied';
 perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 assert (select count(*)=0 from public.diagnoses where id=d),'RLS other user denied';
 execute 'reset role';
 perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 assert (select count(*)=1 from public.diagnoses where id=d),'RLS owner permitted';
 execute 'reset role';

end $$;
rollback;
