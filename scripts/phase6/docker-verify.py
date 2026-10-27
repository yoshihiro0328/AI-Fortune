"""Synthetic, network-isolated Docker verification. No production credentials or data."""
import subprocess,json,concurrent.futures,uuid,pathlib,hashlib,os
ROOT=pathlib.Path(__file__).resolve().parents[2]
CONTAINER=os.environ.get('PHASE6_TEST_CONTAINER','yorisoi-phase6-test')
base=['docker','exec','-i',CONTAINER,'psql','-h','/tmp','-U','postgres','-v','ON_ERROR_STOP=1','-qAt']
def sql(query,db='postgres'):
 r=subprocess.run(base+['-d',db],input=query,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr[-1500:])
 return r.stdout.strip()
def obj(query,db='postgres'):return json.loads(sql(query,db).splitlines()[-1])
def runrpc(name,values,db='postgres'):
 def literal(x):
  if x is None:return 'null'
  if isinstance(x,bool):return 'true' if x else 'false'
  if isinstance(x,(int,float)):return str(x)
  return "'"+str(x).replace("'","''")+"'"
 return obj('set role service_role;select public.'+name+'('+','.join(map(literal,values))+');',db)
def key(n):return hashlib.sha256(str(n).encode()).hexdigest()
sql('create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin nologin;create role public_probe nologin;grant anon,authenticated,service_role,public_probe to postgres with inherit false,set true;')
sql((ROOT/'scripts/phase6/auth-bootstrap.sql').read_text())
# Supabase's postgres owner has BYPASSRLS, not superuser. Exercise that real boundary.
sql('alter role postgres nosuperuser createdb createrole bypassrls;')
files=sorted((ROOT/'supabase/migrations').glob('*.sql'))
for f in files:
 if f.name<'20261014151638_trial_foundation.sql':sql(f.read_text())
# Old and current purchase fixtures, no real user data.
sql("update public.payment_environment set stripe_account_id='acct_synthetic';")
u=str(uuid.uuid4());sql(f"insert into auth.users(id,email_confirmed_at) values('{u}',now());")
for amount in [1980,980]:
 d=sql(f"insert into public.diagnoses(user_id,anonymous_session_id,diagnosis_type_id) values('{u}','synthetic',(select id from public.diagnosis_types limit 1)) returning id;")
 sql(f"insert into public.payments(user_id,diagnosis_id,amount,status) values('{u}','{d}',{amount},'paid');")
plus_user=str(uuid.uuid4());sql(f"insert into auth.users(id,email_confirmed_at) values('{plus_user}',now());")
sql(f"insert into public.billing_customers(user_id,stripe_customer_id) values('{plus_user}','cus_synthetic');")
sql(f"insert into public.subscriptions(id,user_id,stripe_customer_id,price_version,amount,status,period_start,period_end,paid_through,is_test,created_at) values('sub_synthetic','{plus_user}','cus_synthetic','plus-2026-10-980',980,'active',now()-interval '1 day',now()+interval '29 days',now()+interval '29 days',true,now());")
assert runrpc('consultation_entitlement',[u])['remaining']==3
assert runrpc('consultation_entitlement',[plus_user])['remaining']==30
snapshot="select jsonb_build_object('subscriptions',(select md5(string_agg(to_jsonb(s)::text,'|' order by id)) from public.subscriptions s),'payments',(select md5(string_agg(to_jsonb(p)::text,'|' order by id)) from public.payments p),'settings',(select to_jsonb(s) from public.service_settings s),'policies',(select md5(string_agg(to_jsonb(p)::text,'|' order by tablename,policyname)) from pg_policies p where schemaname='public' and tablename<>'consultation_events'));"
before=obj(snapshot)
migrations=[f for f in files if f.name>='20261014151638_trial_foundation.sql']
auth_snapshot="select jsonb_build_object('rls',(select relrowsecurity from pg_class where oid='auth.users'::regclass),'acl',(select relacl::text from pg_class where oid='auth.users'::regclass),'policies',(select count(*) from pg_policies where schemaname='auth'));"
auth_before=obj(auth_snapshot)
for migration in migrations:
 if migration.name.endswith('_trial_auth_verification.sql'):
  pre=subprocess.run(base,input="set role service_role;select public.trial_claim(repeat('a',64),'"+u+"',null,null,null,null,'{}');",text=True,capture_output=True)
  assert pre.returncode!=0 and 'permission denied for table users' in pre.stderr,pre.stderr
 sql(migration.read_text())
assert obj(auth_snapshot)==auth_before
assert sql("select rolsuper from pg_roles where rolname='postgres';")=='f'
assert sql("select rolbypassrls from pg_roles where rolname='postgres';")=='t'
assert sql("select has_table_privilege('service_role','auth.users','SELECT');")=='f'
assert sql("select relrowsecurity from pg_class where oid='auth.users'::regclass;")=='t'
assert obj("select jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'path',proconfig,'type',prorettype::regtype::text) from pg_proc where oid='trial_private.email_verified(uuid)'::regprocedure;")=={'owner':'postgres','definer':True,'path':['search_path=""'],'type':'boolean'}
assert sql("select prosecdef from pg_proc where oid='public.trial_claim(text,uuid,uuid,text,text,text,jsonb)'::regprocedure;")=='f'
assert sql("select pg_get_userbyid(proowner) from pg_proc where oid='public.trial_claim(text,uuid,uuid,text,text,text,jsonb)'::regprocedure;")=='postgres'
assert obj("select jsonb_agg(n.nspname || '.' || p.proname order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','trial_private') and p.prosrc like '%from auth.users%';")==['public.protect_payment_environment','trial_private.email_verified']
assert sql("select has_schema_privilege('service_role','trial_private','CREATE');")=='f'
for role in ['anon','authenticated']:
 assert sql("select has_function_privilege('"+role+"','trial_private.email_verified(uuid)','EXECUTE');")=='f'

for role in ['anon','authenticated','service_role','public_probe']:
 denied=subprocess.run(base,input='set role '+role+';select id,email_confirmed_at from auth.users;',text=True,capture_output=True)
 assert denied.returncode!=0 and 'permission denied' in denied.stderr
 if role!='service_role':
  denied=subprocess.run(base,input='set role '+role+";select trial_private.email_verified('"+u+"');",text=True,capture_output=True)
  assert denied.returncode!=0 and 'permission denied' in denied.stderr
assert sql("select count(*) from pg_proc p,lateral aclexplode(p.proacl) a where p.oid='trial_private.email_verified(uuid)'::regprocedure and a.grantee=0;")=='0'
assert sql("set role service_role;select trial_private.email_verified('"+u+"');")=='t'
# Existing Stripe guard needs Auth only for owner-only environment changes.
denied=subprocess.run(base,input="set role service_role;update payment_environment set stripe_account_id='acct_forbidden';",text=True,capture_output=True)
assert denied.returncode!=0 and 'permission denied' in denied.stderr
denied=subprocess.run(base,input="update payment_environment set stripe_account_id='acct_forbidden';",text=True,capture_output=True)
assert denied.returncode!=0 and 'only an empty project' in denied.stderr

# Preserve every pre-existing policy; check the newly introduced table separately.
assert obj(snapshot)==before
assert sql("select count(*) from pg_policies where schemaname='public' and tablename='consultation_events' and policyname='consultation_events_owner' and cmd='SELECT' and roles=array['authenticated']::name[];")=='1'
assert sql("select relrowsecurity from pg_class where oid='public.consultation_events'::regclass;")=='t'
assert sql("select has_table_privilege('anon','public.consultation_events','SELECT');")=='f'
assert sql("select has_table_privilege('authenticated','public.consultation_events','SELECT');")=='t'
for privilege in ['INSERT','UPDATE','DELETE']:
 assert sql("select has_table_privilege('authenticated','public.consultation_events','"+privilege+"');")=='f'
for role in ['anon','authenticated','public_probe']:
 assert sql("select has_function_privilege('"+role+"','public.manage_consultation_event(uuid,text,uuid,uuid,date,text,integer)','EXECUTE');")=='f'
assert sql("select has_function_privilege('service_role','public.manage_consultation_event(uuid,text,uuid,uuid,date,text,integer)','EXECUTE');")=='t'
assert runrpc('consultation_entitlement',[u])['remaining']==3
assert runrpc('consultation_entitlement',[plus_user])['remaining']==30
# Fresh price validity is synthetic; the checked-in release price remains time-limited.
sql("update trial_private.settings set enabled=true,cleaned_at=now();update trial_private.prices set valid_until=now()+interval '1 day';")
for n in range(24):
 r=runrpc('trial_create',[key('session'+str(n)),key('ip'+str(n)),key('challenge'+str(n)),'trial-2026-10-15']);assert 'error' not in r,r
# Parallel same-session requests: one provider reservation only.
h=key('session0');req=str(uuid.uuid4())
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
 results=list(pool.map(lambda _:runrpc('trial_reserve',[h,req,'body','general','ciphertext']),range(12)))
winners=[r for r in results if 'call' in r];assert len(winners)==1,results
w=winners[0];runrpc('trial_finish',[w['call']['id'],w['lease'],'answer',False,100,100,'synthetic',False])
# Concurrent different sessions, budget permits exactly two worst-case calls.
sql('update trial_private.settings set daily_nusd=3962500;')
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
 results=list(pool.map(lambda n:runrpc('trial_reserve',[key('session'+str(n)),str(uuid.uuid4()),'body','general','ciphertext']),range(1,21)))
assert sum('call' in r for r in results)==2,results
cost=int(sql('select sum(coalesce(settled_nusd,reserved_nusd)) from trial_private.calls;'));assert cost<=3962500,cost
# Stress the actual $3/day cap with deliberately expensive synthetic model rates.
sql('update trial_private.settings set daily_nusd=3000000000;update trial_private.prices set input_nusd=50000,output_nusd=281250;')
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
 full_budget=list(pool.map(lambda n:runrpc('trial_reserve',[key('session'+str(n)),str(uuid.uuid4()),'body','general','ciphertext']),range(1,21)))
assert sum('call' in r for r in full_budget)==3,full_budget
cost=int(sql('select sum(coalesce(settled_nusd,reserved_nusd)) from trial_private.calls;'));assert cost==2928962500,cost
# Transactional claim + cross-account race.
other=str(uuid.uuid4());sql(f"insert into auth.users(id,email_confirmed_at) values('{other}',now());")
turn=w['turnId']
unconfirmed=str(uuid.uuid4());sql(f"insert into auth.users(id) values('{unconfirmed}');")
claim_state="select jsonb_build_object('subjects',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.consultation_subjects s),'threads',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.consultation_threads t),'turns',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.consultation_turns t),'sessions',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from trial_private.sessions s));"
claim_before=obj(claim_state)
for invalid_user in [unconfirmed,str(uuid.uuid4()),None]:
 assert runrpc('trial_claim',[h,invalid_user,turn,'合成相談本文','合成回答','general','{}'])['error']=='auth'
 assert obj(claim_state)==claim_before
# Force a late failure; all earlier inserts and ownership changes must roll back.
sql("create function public.fail_auth_claim_test() returns trigger language plpgsql as $$begin raise exception 'synthetic claim failure';end $$;create trigger fail_auth_claim_test before insert on public.consultation_turns for each row execute function public.fail_auth_claim_test();")
try:
 runrpc('trial_claim',[h,u,turn,'合成相談本文','合成回答','general','{}'])
 raise AssertionError('expected synthetic failure')
except RuntimeError as e:assert 'synthetic claim failure' in str(e)
assert obj(claim_state)==claim_before
sql('drop trigger fail_auth_claim_test on public.consultation_turns;drop function public.fail_auth_claim_test();')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 results=list(pool.map(lambda owner:runrpc('trial_claim',[h,owner,turn,'合成相談本文','合成回答','general','{}']),[u,other]))
assert sum('threadId' in r for r in results)==1,results
assert sum(r.get('error')=='ownership' for r in results)==1,results
winner=[owner for owner,result in zip([u,other],results) if 'threadId' in result][0]
claimed=[result for result in results if 'threadId' in result][0]
assert runrpc('trial_claim',[h,winner,None,None,None,None,'{}'])==claimed
assert sql("select count(*) from public.consultation_threads where id='"+claimed['threadId']+"' and user_id='"+winner+"';")=='1'
assert sql("select count(*) from public.consultation_turns where thread_id='"+claimed['threadId']+"' and user_id='"+winner+"' and not charged;")=='1'

# Caller permissions: service role works; browser roles fail.
assert obj("set role service_role;select public.trial_policy();")['enabled'] is True
for role in ['anon','authenticated']:
 for query in ['select public.trial_policy();','select * from trial_private.sessions;','select * from public.trial_thread_context;']:
  r=subprocess.run(base,input='set role '+role+';'+query,text=True,capture_output=True)
  assert r.returncode!=0 and 'permission denied' in r.stderr
# Restore the complete synthetic DB into a second DB, then prove source data + reservations remain.
dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-h','/tmp','-U','postgres','--no-owner','postgres'],capture_output=True,check=True).stdout
sql('create database phase6_restore;')
r=subprocess.run(base+['-d','phase6_restore'],input=dump,capture_output=True);assert r.returncode==0,r.stderr[-1000:]
sql('update trial_private.settings set enabled=false;', 'phase6_restore')
assert runrpc('trial_policy',[], 'phase6_restore')['enabled'] is False
assert obj(snapshot,'phase6_restore')==before
assert sql("select has_table_privilege('service_role','auth.users','SELECT');",'phase6_restore')=='f'
assert sql("select relrowsecurity from pg_class where oid='auth.users'::regclass;",'phase6_restore')=='t'
assert sql("set role service_role;select trial_private.email_verified('"+u+"');",'phase6_restore')=='t'
assert sql("select count(*) from pg_proc p cross join (values('anon'),('authenticated')) r(role) where p.pronamespace='public'::regnamespace and p.proname like 'trial_%' and has_function_privilege(r.role,p.oid,'EXECUTE');",'phase6_restore')=='0'
restored=int(sql('select sum(coalesce(settled_nusd,reserved_nusd)) from trial_private.calls;','phase6_restore'));assert restored==cost
sql("update trial_private.sessions set expires_at=now()-interval '1 second';select public.trial_cleanup();",'phase6_restore')
assert sql('select count(*) from trial_private.sessions;','phase6_restore')=='0'
assert sql('select count(*) from trial_private.turns;','phase6_restore')=='0'
assert obj(snapshot,'phase6_restore')==before

# Hardening: all 11 RPC grants and all 8 table RLS flags in real PostgreSQL.
assert sql("select count(*) from pg_class where relkind='r' and (relnamespace='trial_private'::regnamespace or relname='trial_thread_context') and relrowsecurity;")=='8'
assert sql("select count(*) from pg_proc p cross join (values('anon'),('authenticated')) r(role) where p.pronamespace='public'::regnamespace and p.proname like 'trial_%' and has_function_privilege(r.role,p.oid,'EXECUTE');")=='0'
# Concurrent delete/claim: either complete owned transfer or no member rows; never a partial transfer.
db='phase6_restore'
sql("update trial_private.prices set input_nusd=125,output_nusd=500;update trial_private.settings set enabled=true,cleaned_at=now();",db)
r=runrpc('trial_create',[key('race'),key('race-ip'),key('race-challenge'),'trial-2026-10-15'],db);assert 'error' not in r
r=runrpc('trial_reserve',[key('race'),str(uuid.uuid4()),'body','general','cipher'],db)
runrpc('trial_finish',[r['call']['id'],r['lease'],'answer',False,100,100,'synthetic-race',False],db)
before_threads=int(sql('select count(*) from public.consultation_threads;',db))
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 a=pool.submit(runrpc,'trial_claim',[key('race'),u,r['turnId'],'合成相談','合成回答','general',{}],db)
 b=pool.submit(runrpc,'trial_delete_content',[key('race')],db)
 claim_result,delete_result=a.result(),b.result()
assert delete_result.get('ok') is True
assert 'threadId' in claim_result or claim_result.get('error')=='conflict'
assert int(sql('select count(*) from public.consultation_threads;',db))==before_threads+int('threadId' in claim_result)
assert sql("select count(*) from trial_private.turns where payload is not null or answer is not null;",db)=='0'
# Purge/late settlement race must retain usage and never recreate removed content.
runrpc('trial_create',[key('late'),key('late-ip'),key('late-challenge'),'trial-2026-10-15'],db)
r=runrpc('trial_reserve',[key('late'),str(uuid.uuid4()),'body','general','cipher'],db)
sql("update trial_private.sessions set expires_at=now()-interval '1 second';update trial_private.turns set lease_until=now()-interval '1 second';",db)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 a=pool.submit(runrpc,'trial_cleanup',[],db)
 b=pool.submit(runrpc,'trial_finish',[r['call']['id'],r['lease'],'late-answer',False,4000,2000,'synthetic-late',False],db)
 a.result();b.result()
assert sql("select settled_nusd from trial_private.calls where id='"+r['call']['id']+"';",db)=='1500000'
assert sql('select enabled from trial_private.settings;',db)=='f'
assert sql('select count(*) from trial_private.sessions;',db)=='0'
assert sql('select count(*) from trial_private.turns;',db)=='0'
print(json.dumps({'database':'PostgreSQL 17.11 (Docker, isolated synthetic)' ,'allMigrationsApplied':len(files),'authDirectSelectDenied':True,'authRlsPreserved':True,'pre17FailureReproduced':True,'verifierOwnerNonSuperuser':True,'verifierPublicDenied':True,'claimAsServiceRole':True,'claimRollbackVerified':True,'stripeGuardUnchanged':True,'restoreAclVerified':True,'restoreQuarantinedBeforeCleanup':True,'legacy1980And980PlusFreePreserved':True,'migrationsApplied':[f.name for f in migrations],'existingSyntheticDataUnchanged':True,'sameSessionParallelRequests':12,'sameSessionReservations':1,'budgetParallelRequests':20,'budgetReservations':2,'reservedAndSettledNusd':cost,'budgetNusd':3000000000,'fullBudgetParallelRequests':20,'fullBudgetReservations':3,'crossAccountClaimWinners':1,'browserRolePermissionChecks':6,'allTrialTableRlsChecks':8,'allRpcBrowserGrantChecks':22,'deleteClaimRaceVerified':True,'purgeLateSettlementRaceVerified':True,'restoreVerified':True,'expiryCleanupVerified':True},indent=2))
