"""Offline only: test scoped initialization with the real 17 migrations, no hosted credentials."""
import concurrent.futures, hashlib, json, os, pathlib, re, subprocess, time
ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTAINER = f'yorisoi-stripe-init-{os.getpid()}'
DB = 'stripe_init_isolated'
SOURCE = ROOT/'supabase/environments/ukdzggjfkcwjssjmnqim/stripe-initialize.psql'
checks = []
def run(args, data=None, check=True):
    r = subprocess.run(args, input=data, text=True, capture_output=True)
    if check and r.returncode: raise RuntimeError(r.stderr[-1500:])
    return r
def sql(text, db=DB, role='postgres', check=True):
    if role in ('anon','authenticated','service_role'):
        text='set role '+role+';\n'+text
        role='postgres'
    return run(['docker','exec','-i',CONTAINER,'psql','-X','-h','/tmp','-U',role,'-d',db,'-qAt','-v','ON_ERROR_STOP=1'],text,check)
def value(text): return sql(text).stdout.strip()
def passed(name): checks.append(name); print('PASS '+name, flush=True)
def snapshot():
    return value("select jsonb_build_object('env',(select to_jsonb(e) from public.payment_environment e),'prices',(select jsonb_agg(to_jsonb(p) order by id) from public.price_versions p),'settings',(select to_jsonb(s) from public.service_settings s));")
def security():
    return value("select jsonb_build_object('tables',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','trial_private','auth') and c.relkind='r'),'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),'triggers',(select jsonb_agg(jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid)) order by tgrelid,tgname) from pg_trigger where not tgisinternal),'functions',(select jsonb_agg(jsonb_build_array(p.oid,p.proacl,p.prosecdef,p.proconfig,p.prosrc) order by p.oid) from pg_proc p where p.pronamespace in ('public'::regnamespace,'trial_private'::regnamespace)));" )
def reject(name, prep='', undo='', script=None, role='postgres', expected=None):
    if prep: sql(prep)
    before=snapshot()
    r=sql(script or SOURCE.read_text(),role=role,check=False)
    assert r.returncode != 0, name+' unexpectedly succeeded'
    if expected: assert expected in r.stderr+r.stdout, (name,r.stderr,r.stdout)
    assert snapshot()==before, name+' partially committed'
    if undo: sql(undo)
    passed(name)
try:
    entries=re.findall(r'`(\d{14}_[^`]+\.sql)`\s*\|\s*`([a-f0-9]{64})`',(ROOT/'docs/phase6-external-migration-manifest.md').read_text())
    assert len(entries)==17
    for f,h in entries: assert hashlib.sha256((ROOT/'supabase/migrations'/f).read_bytes()).hexdigest()==h
    passed('17 immutable migration SHA256 values')
    run(['docker','run','-d','--name',CONTAINER,'--network','none','--user','postgres','--entrypoint','sh','public.ecr.aws/supabase/postgres:17.11.0.004','-c',"initdb -D /tmp/data -U platform_admin --auth=trust >/dev/null && exec postgres -D /tmp/data -k /tmp -h '' -c log_statement=none -c log_min_error_statement=panic"])
    for _ in range(120):
        if run(['docker','exec',CONTAINER,'pg_isready','-h','/tmp'],check=False).returncode==0: break
        time.sleep(.25)
    else: raise RuntimeError('Docker readiness failed')
    assert json.loads(run(['docker','inspect',CONTAINER]).stdout)[0]['HostConfig']['NetworkMode']=='none'
    passed('network disabled; Unix socket only; no published port')
    sql('create role postgres login superuser;create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin nologin;grant anon,authenticated,service_role to postgres with inherit false,set true;',db='postgres',role='platform_admin')
    sql('create database '+DB+' owner postgres;',db='postgres',role='platform_admin')
    sql((ROOT/'scripts/phase6/auth-bootstrap.sql').read_text())
    sql('create table auth.sessions(id uuid primary key);alter table auth.sessions owner to supabase_auth_admin;alter table auth.sessions enable row level security;grant all on auth.sessions to postgres;alter role postgres nosuperuser createdb createrole bypassrls;',role='platform_admin')
    sql('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);')
    for f,h in entries:
        sql((ROOT/'supabase/migrations'/f).read_text())
        sql("insert into supabase_migrations.schema_migrations values('"+f.split('_')[0]+"');")
    passed('17 migrations applied as non-superuser; platform-owner Auth ACL fixture')
    assert value("select has_table_privilege('service_role','auth.users','SELECT')")=='f'
    passed('service_role cannot SELECT auth.users')
    reject('wrong host fails before writes',script="\\set HOST forbidden.supabase.co\n"+SOURCE.read_text(),expected='unexpected connection target')
    reject('browser anon denied',role='anon',expected='unexpected connection target')
    reject('browser authenticated denied',role='authenticated',expected='unexpected connection target')
    reject('service_role denied',role='service_role',expected='unexpected connection target')
    sql('revoke all on auth.users from postgres;grant select on auth.users to postgres;',role='platform_admin')
    reject('Auth lock privilege shortage fails before writes',expected='permission denied for table users')
    sql('grant all on auth.users to postgres;',role='platform_admin')
    reject('wrong prior account',"update public.payment_environment set stripe_account_id='acct_wrong';","update public.payment_environment set stripe_account_id='acct_1UNSvsIYwtQeIHKP';",expected='unexpected prior Stripe')
    reject('Live mode refused',"update public.payment_environment set mode='live';","update public.payment_environment set mode='sandbox';",expected='unexpected prior Stripe')
    reject('incomplete migration history',"delete from supabase_migrations.schema_migrations where version='20261015081652';","insert into supabase_migrations.schema_migrations values('20261015081652');",expected='exact approved 17')
    reject('existing Portal refused',"update public.service_settings set portal_configuration_id='bpc_existing';","update public.service_settings set portal_configuration_id=null;",expected='unexpected service settings')
    reject('trial ON refused',"update trial_private.settings set enabled=true;","update trial_private.settings set enabled=false;",expected='anonymous AI must remain OFF')
    sql("insert into auth.users(id) values('00000000-0000-0000-0000-000000000001');",role='platform_admin')
    reject('Auth user prevents initialization',expected='Auth must be empty')
    sql('delete from auth.users;',role='platform_admin')
    sql("insert into auth.sessions values('00000000-0000-0000-0000-000000000001');",role='platform_admin')
    reject('Auth session prevents initialization',expected='Auth must be empty')
    sql('delete from auth.sessions;',role='platform_admin')
    reject('anonymous diagnosis prevents initialization',"insert into public.diagnoses(anonymous_session_id,diagnosis_type_id) values('synthetic',(select id from public.diagnosis_types limit 1));",'delete from public.diagnoses;',expected='nonempty table: public.diagnoses')
    reject('Stripe event prevents initialization',"insert into public.stripe_events(stripe_event_id,event_type,payload_hash) values('evt_synthetic','synthetic','synthetic');",'delete from public.stripe_events;',expected='nonempty table: public.stripe_events')
    reject('unexpected extra catalog version refused',"insert into public.price_versions(id,kind,amount) values('unexpected','report',980);","delete from public.price_versions where id='unexpected';",expected='four inactive baseline')
    reject('RLS disabled refused','alter table public.payments disable row level security;','alter table public.payments enable row level security;',expected='unexpected RLS/Auth privilege')
    reject('disabled isolation trigger refused','alter table public.price_versions disable trigger price_environment;','alter table public.price_versions enable trigger price_environment;',expected='environment trigger drift')
    reject('mid-transaction error rolls back account, new versions and Portal',script=SOURCE.read_text().replace('commit;','select 1/0;\ncommit;'),expected='division by zero')
    before_security=security()
    before_prices=value('select jsonb_agg(to_jsonb(p) order by id) from public.price_versions p;')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _: sql(SOURCE.read_text(),check=False),range(2)))
    assert sorted(r.returncode==0 for r in results)==[False,True]
    assert 'unexpected prior Stripe' in next(r.stderr for r in results if r.returncode)
    passed('concurrent initialization commits exactly once')
    assert value("select mode||':'||stripe_account_id from public.payment_environment")=='sandbox:acct_1UQlQdI73kTcvXz8'
    assert value('select count(*) from public.price_versions where active')=='0'
    assert value('select count(*) from public.price_versions')=='6'
    assert value("select portal_configuration_id from public.service_settings")=='bpc_1UQlv6I73kTcvXz8G4TVvwUm'
    assert value("select jsonb_agg(to_jsonb(p) order by id) from public.price_versions p where id not like '%integration%';")==before_prices
    passed('successful atomic initialization; six inactive prices; legacy rows unchanged')
    assert security()==before_security
    passed('Auth ACL/RLS, all 42 app table RLS, functions and isolation triggers unchanged')
    assert value("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','trial_private') and c.relkind='r' and c.relrowsecurity")=='42'
    assert value("select free_limit||':'||plus_limit from public.service_settings")=='3:30'
    assert value('select enabled from trial_private.settings')=='f'
    passed('free 3 / Plus 30 / anonymous AI OFF preserved')
    reject('duplicate run refuses rather than silently reinitializing',expected='unexpected prior Stripe')
    reject('legacy identifier update blocked by original trigger',script="update public.price_versions set stripe_product_id='prod_wrong' where id='report-2026-10-980';",expected='create a new price version')
    reject('wrong-environment active catalog blocked',script="update public.price_versions set active=true where id='report-live-2026-10-980';",expected='active catalog environment mismatch')
    report={'passed':len(checks),'checks':checks,'hostedConnections':0,'stripeTransactions':0,'sqlSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest()}
    if os.getenv('PHASE6_STRIPE_INIT_REPORT'): pathlib.Path(os.environ['PHASE6_STRIPE_INIT_REPORT']).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
finally:
    run(['docker','rm','-f',CONTAINER],check=False)
