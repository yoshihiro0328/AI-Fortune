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
 return obj('select public.'+name+'('+','.join(map(literal,values))+');',db)
def key(n):return hashlib.sha256(str(n).encode()).hexdigest()
bootstrap="""
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key,created_at timestamptz default now(),email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant select on auth.users to service_role;
alter default privileges in schema public grant all on tables to service_role;
"""
sql(bootstrap)
files=sorted((ROOT/'supabase/migrations').glob('*.sql'))
for f in files:
 if 'trial_foundation' not in f.name:sql(f.read_text())
# Old and current purchase fixtures, no real user data.
u=str(uuid.uuid4());sql(f"insert into auth.users(id,email_confirmed_at) values('{u}',now());")
for amount in [1980,980]:
 d=sql(f"insert into public.diagnoses(user_id,anonymous_session_id,diagnosis_type_id) values('{u}','synthetic',(select id from public.diagnosis_types limit 1)) returning id;")
 sql(f"insert into public.payments(user_id,diagnosis_id,amount,status) values('{u}','{d}',{amount},'paid');")
snapshot="select jsonb_build_object('payments',(select md5(string_agg(to_jsonb(p)::text,'|' order by id)) from public.payments p),'settings',(select to_jsonb(s) from public.service_settings s),'policies',(select md5(string_agg(to_jsonb(p)::text,'|' order by tablename,policyname)) from pg_policies p where schemaname='public'));"
before=obj(snapshot)
migration=next(f for f in files if 'trial_foundation' in f.name);sql(migration.read_text());assert obj(snapshot)==before
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
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 results=list(pool.map(lambda owner:runrpc('trial_claim',[h,owner,turn,'合成相談本文','合成回答','general','{}']),[u,other]))
assert sum('threadId' in r for r in results)==1,results
assert sum(r.get('error')=='ownership' for r in results)==1,results
# Caller permissions: service role works; browser roles fail.
assert obj("set role service_role;select public.trial_policy();")['enabled'] is True
for role in ['anon','authenticated']:
 for query in ['select public.trial_policy();','select * from trial_private.sessions;','select * from public.trial_thread_context;']:
  r=subprocess.run(base,input='set role '+role+';'+query,text=True,capture_output=True)
  assert r.returncode!=0 and 'permission denied' in r.stderr
# Restore the complete synthetic DB into a second DB, then prove source data + reservations remain.
dump=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-h','/tmp','-U','postgres','--no-owner','--no-acl','postgres'],capture_output=True,check=True).stdout
sql('create database phase6_restore;')
r=subprocess.run(base+['-d','phase6_restore'],input=dump,capture_output=True);assert r.returncode==0,r.stderr[-1000:]
assert obj(snapshot,'phase6_restore')==before
restored=int(sql('select sum(coalesce(settled_nusd,reserved_nusd)) from trial_private.calls;','phase6_restore'));assert restored==cost
sql("update trial_private.sessions set expires_at=now()-interval '1 second';select public.trial_cleanup();",'phase6_restore')
assert sql('select count(*) from trial_private.sessions;','phase6_restore')=='0'
assert sql('select count(*) from trial_private.turns;','phase6_restore')=='0'
assert obj(snapshot,'phase6_restore')==before
print(json.dumps({'database':'PostgreSQL 17.11 (Docker, network none)','migrationApplied':migration.name,'existingSyntheticDataUnchanged':True,'sameSessionParallelRequests':12,'sameSessionReservations':1,'budgetParallelRequests':20,'budgetReservations':2,'reservedAndSettledNusd':cost,'budgetNusd':3000000000,'fullBudgetParallelRequests':20,'fullBudgetReservations':3,'crossAccountClaimWinners':1,'browserRolePermissionChecks':6,'restoreVerified':True,'expiryCleanupVerified':True},indent=2))
