"""Network-disabled PostgreSQL verification of frozen SQL bytes. Never connects to Hosted.
--artifact-dir verifies the preserved private manifest. --synthetic-ci uses unrelated CI fixtures.
Neither mode can transmit SQL to Supabase. SQL/UUIDs/hashes/provider responses are never logged.
"""
import argparse, concurrent.futures, hashlib, json, os, re, subprocess, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
group = parser.add_mutually_exclusive_group(required=True)
group.add_argument('--artifact-dir', type=Path)
group.add_argument('--synthetic-ci', action='store_true')
parser.add_argument('--report', type=Path, required=True)
parser.add_argument('--cleanup-file', type=Path)
parser.add_argument('--cleanup-sha256')
args = parser.parse_args()
if bool(args.cleanup_file) != bool(args.cleanup_sha256): parser.error('Cleanup file and expected SHA256 must be supplied together')
if args.cleanup_file and not args.artifact_dir: parser.error('Private cleanup requires the preserved artifact manifest')
CONTAINER = 'yorisoi-complete-sql-' + str(os.getpid())
TABLES = ['consultation_subjects','consultation_threads','consultation_turns','diagnoses','diagnosis_answers','free_reports']
checks = []
def digest(data): return hashlib.sha256(data).hexdigest()
def command(argv, data=None, check=True):
    r = subprocess.run(argv, input=data, capture_output=True)
    if check and r.returncode: raise RuntimeError('Isolated command failed; SQL and private values suppressed')
    return r
def sql(data, db='stripe_init_isolated', role='postgres', check=True):
    if isinstance(data,str): data=data.encode()
    return command(['docker','exec','-i',CONTAINER,'psql','-X','-h','/tmp','-U',role,'-d',db,'-qAt','-v','ON_ERROR_STOP=1'],data,check)
def value(query, db='stripe_init_isolated'): return sql(query,db).stdout.decode().strip()
def obj(query, db='stripe_init_isolated'): return json.loads(value(query,db))
def passed(name): checks.append(name); print('PASS '+name,flush=True)
def q(s): return "'"+str(s).replace("'","''")+"'"
def clone(name): sql('create database '+name+' template stripe_init_isolated;',db='postgres')
def counts(db): return [int(value('select count(*) from public.'+t,db)) for t in TABLES]
def invariants(db):
    return value("select jsonb_build_object('users',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u),'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),'payments',(select count(*) from public.payments),'subscriptions',(select count(*) from public.subscriptions),'customers',(select count(*) from public.billing_customers),'prices',(select jsonb_agg(to_jsonb(p) order by id) from public.price_versions p),'settings',(select to_jsonb(s) from public.service_settings s),'trial',(select enabled from trial_private.settings),'acl',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relacl,c.relrowsecurity) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','trial_private','auth') and c.relkind='r'));",db)
def execute_frozen(db, check=True):
    current=(artifact/'complete.sql').read_bytes()
    assert current==frozen and digest(current)==sha, 'SQL changed after freeze'
    return sql(current,db,check=check)
def reject(db, prep, expected):
    clone(db)
    if prep: sql(prep,db)
    before=invariants(db); oldcounts=counts(db)
    r=execute_frozen(db,False)
    assert r.returncode!=0 and expected.encode() in r.stderr, 'Expected precondition refusal missing'
    assert invariants(db)==before and counts(db)==oldcounts, 'Failed precondition changed database'
    passed(db+' refuses before writes')

with tempfile.TemporaryDirectory(prefix='yorisoi-frozen-sql-') as tmp:
  artifact=args.artifact_dir.resolve() if args.artifact_dir else Path(tmp)/'artifact'
  mode='preserved-artifact' if args.artifact_dir else 'synthetic-ci'
  try:
    entries=re.findall(r'`(\d{14}_[^`]+\.sql)`\s*\|\s*`([a-f0-9]{64})`',(ROOT/'docs/phase6-external-migration-manifest.md').read_text())
    assert len(entries)==17
    for f,h in entries: assert digest((ROOT/'supabase/migrations'/f).read_bytes())==h
    passed('all 17 original migration checksums preserved')
    command(['docker','run','-d','--name',CONTAINER,'--network','none','--user','postgres','--entrypoint','sh','public.ecr.aws/supabase/postgres:17.11.0.004','-c',"initdb -D /tmp/data -U platform_admin --auth=trust >/dev/null && exec postgres -D /tmp/data -k /tmp -h '' -c log_statement=none -c log_min_error_statement=panic"])
    for _ in range(120):
      if command(['docker','exec',CONTAINER,'pg_isready','-h','/tmp'],check=False).returncode==0: break
      time.sleep(.25)
    else: raise RuntimeError('Isolated PostgreSQL readiness failed')
    inspect=json.loads(command(['docker','inspect',CONTAINER]).stdout)[0]
    assert inspect['HostConfig']['NetworkMode']=='none' and not inspect['HostConfig']['PortBindings']
    passed('network none; Unix socket only; no credentials or hosted connection')
    sql('create role postgres login superuser;create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin nologin;grant anon,authenticated,service_role to postgres with inherit false,set true;',db='postgres',role='platform_admin')
    sql('create database stripe_init_isolated owner postgres;',db='postgres',role='platform_admin')
    sql((ROOT/'scripts/phase6/auth-bootstrap.sql').read_bytes())
    sql('create table auth.sessions(id uuid primary key);alter table auth.sessions owner to supabase_auth_admin;alter table auth.sessions enable row level security;grant all on auth.sessions to postgres;alter role postgres nosuperuser createdb createrole bypassrls;',role='platform_admin')
    sql('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);')
    for f,h in entries:
      sql((ROOT/'supabase/migrations'/f).read_bytes())
      sql('insert into supabase_migrations.schema_migrations values('+q(f.split('_')[0])+');')
    # Reproduce the approved test database's existing sandbox configuration only inside Docker.
    sql((ROOT/'supabase/environments/ukdzggjfkcwjssjmnqim/stripe-initialize.psql').read_bytes())
    assert value("select has_table_privilege('service_role','auth.users','SELECT')")=='f'
    passed('17 migrations and inactive sandbox baseline; Auth privileges unchanged')
    if args.synthetic_ci:
      script="""import fs from 'node:fs';import {fixturePlan} from './scripts/phase6/step10-fixtures.mjs';import {randomUUID} from 'node:crypto';const p=fixturePlan([randomUUID(),randomUUID()],['a'.repeat(64),'b'.repeat(64)]);fs.writeFileSync(process.argv[1],JSON.stringify(p),{mode:0o600});"""
      ci_plan=Path(tmp)/'plan.json'
      command(['node','--input-type=module','-e',script,str(ci_plan)])
      plan=json.loads(ci_plan.read_text())
      profiles=[{'id':u,'user_id':u,'display_name':None,'created_at':'2026-01-01T00:00:00+00:00','updated_at':'2026-01-01T00:00:00+00:00'} for u in plan['users']]
    else:
      plan=json.loads((artifact/'manifest.json').read_text())
      profiles=json.loads((artifact/'baseline.json').read_text())['profiles']
    assert plan['project']=='ukdzggjfkcwjssjmnqim' and len(set(sum(plan['rows'].values(),[])))==12
    assert len(profiles)==2 and all(p['display_name'] is None for p in profiles)
    for u in plan['users']: sql('insert into auth.users(id,email_confirmed_at) values('+q(u)+",'2026-01-01');")
    sql('insert into public.profiles select * from jsonb_populate_recordset(null::public.profiles,'+q(json.dumps(profiles))+'::jsonb);')
    fingerprint=value("select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p;")
    if args.synthetic_ci:
      input_file=Path(tmp)/'prepare.json'
      input_file.write_text(json.dumps({'plan':plan,'profiles':profiles,'profileFingerprint':fingerprint,'previousAttemptSha256':'0'*64}))
      script="""import fs from 'node:fs';import {saveArtifact} from './scripts/phase6/step10-sql-artifact.mjs';saveArtifact(process.argv[2],JSON.parse(fs.readFileSync(process.argv[1])));"""
      command(['node','--input-type=module','-e',script,str(input_file),str(artifact)])
    assert fingerprint==json.loads((artifact/'baseline.json').read_text())['profileFingerprint']
    frozen=(artifact/'complete.sql').read_bytes();sha=digest(frozen)
    metadata=json.loads((artifact/'attempt.json').read_text())
    assert metadata['sqlSha256']==sha
    assert b'do $$ begin\n' in frozen and b'\nend $$;' in frozen and frozen.endswith(b'\ncommit;')
    assert len(re.findall(rb'insert into public\.',frozen))==12
    assert not re.search(rb'\b(update|delete|truncate|upsert)\b',frozen,re.I)
    passed('frozen complete SQL digest, dollar delimiters and INSERT-only scope verified')
    clone('success_case');before=invariants('success_case')
    execute_frozen('success_case')
    assert counts('success_case')==[2]*6
    for t in TABLES:
      ids=obj('select jsonb_agg(id order by id) from public.'+t,'success_case')
      assert ids==sorted(plan['rows'][t]), 'Unexpected inserted UUID'
    assert invariants('success_case')==before
    assert value('select count(*) from public.diagnoses where user_id is not null','success_case')=='0'
    for i in range(2):
      assert value('select anonymous_session_id from public.diagnoses where id='+q(plan['rows']['diagnoses'][i]),'success_case')==plan['hashes'][i]
    passed('exact frozen bytes accepted; six tables x two rows; twelve UUIDs and anonymous hashes unchanged')
    passed('Auth users/profiles, RLS/ACL, payments/contracts, six inactive prices, trial OFF unchanged')
    r=execute_frozen('success_case',False)
    assert r.returncode!=0 and b'Nonempty business table' in r.stderr and counts('success_case')==[2]*6
    passed('duplicate frozen SQL execution refused without changes')
    clone('concurrent_case');before=invariants('concurrent_case')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
      outcomes=list(pool.map(lambda _:execute_frozen('concurrent_case',False),range(2)))
    assert sorted(r.returncode==0 for r in outcomes)==[False,True]
    assert b'Nonempty business table' in next(r.stderr for r in outcomes if r.returncode)
    assert counts('concurrent_case')==[2]*6 and invariants('concurrent_case')==before
    passed('two concurrent executions serialize; only one commits twelve rows')
    reject('identity_mismatch',"update auth.users set email_confirmed_at=null where id="+q(plan['users'][0]),'Identity mismatch')
    reject('profile_mismatch',"update public.profiles set display_name='synthetic-changed' where user_id="+q(plan['users'][0]),'Profile changed')
    reject('trial_mismatch','update trial_private.settings set enabled=true','Safety state mismatch')
    reject('migration_mismatch',"delete from supabase_migrations.schema_migrations where version='20261015081652'",'Safety state mismatch')
    reject('rls_mismatch','alter table public.diagnoses disable row level security','RLS mismatch')
    # Build the mismatched fixture while empty, then restore its synthetic identities.
    # The production isolation trigger remains enabled throughout.
    reject('environment_mismatch',"begin;create temp table held_users as table auth.users;create temp table held_profiles as table public.profiles;delete from auth.users;update public.payment_environment set stripe_account_id='acct_syntheticwrong';insert into auth.users select * from held_users;insert into public.profiles select * from held_profiles;commit;",'Payment target mismatch')
    reject('existing_row',"insert into public.consultation_subjects(user_id,nickname) values("+q(plan['users'][0])+",'synthetic unrelated')",'Nonempty business table')
    clone('rollback_case');before=invariants('rollback_case')
    # Only the separate rollback experiment replaces final COMMIT. The deployment file is untouched.
    body=frozen[:-len(b'commit;')]
    verify='do $$ begin '+''.join("if (select count(*) from public."+t+")<>2 then raise exception 'in-transaction count';end if;" for t in TABLES)+' end $$;\n'
    sql(body+verify.encode()+b'rollback;','rollback_case')
    assert counts('rollback_case')==[0]*6 and invariants('rollback_case')==before
    passed('explicit ROLLBACK after verifying twelve rows inside transaction leaves zero rows')
    clone('mid_failure');before=invariants('mid_failure')
    sql("create sequence public.injected_count;create function public.injected_failure() returns trigger language plpgsql as $$ begin if nextval('public.injected_count')=12 then raise exception 'injected twelfth insert failure';end if;return new;end $$;"+''.join('create trigger injected before insert on public.'+t+' for each row execute function public.injected_failure();' for t in TABLES),'mid_failure')
    r=execute_frozen('mid_failure',False)
    assert r.returncode!=0 and b'injected twelfth insert failure' in r.stderr
    assert value('select last_value from public.injected_count','mid_failure')=='12'
    assert counts('mid_failure')==[0]*6 and invariants('mid_failure')==before
    passed('exact frozen SQL fails on twelfth INSERT; first eleven rolled back; no partial writes')
    # Cleanup is tested only in this isolated success database, never sent to Hosted.
    script="""import fs from 'node:fs';import {cleanupSQL} from './scripts/phase6/step10-fixtures.mjs';fs.writeFileSync(process.argv[2],cleanupSQL(JSON.parse(fs.readFileSync(process.argv[1]))),{mode:0o600});"""
    generated_cleanup=Path(tmp)/'cleanup.sql'
    command(['node','--input-type=module','-e',script,str(artifact/'manifest.json'),str(generated_cleanup)])
    cleanup_file=args.cleanup_file.resolve() if args.cleanup_file else generated_cleanup
    cleanup_bytes=cleanup_file.read_bytes();cleanup_sha=digest(cleanup_bytes)
    assert cleanup_bytes==generated_cleanup.read_bytes(), 'Cleanup compiler/manifest mismatch'
    if args.cleanup_sha256: assert cleanup_sha==args.cleanup_sha256, 'Cleanup digest mismatch'
    def execute_cleanup(db, check=True):
      current=cleanup_file.read_bytes()
      assert current==cleanup_bytes and digest(current)==cleanup_sha, 'Cleanup artifact changed'
      return sql(current,db,check=check)
    # Match Hosted's already-claimed diagnoses without copying credentials or sessions.
    for i in range(2):
      assert value('select public.claim_anonymous_diagnoses('+q(plan['users'][i])+','+q(plan['hashes'][i])+');','success_case')=='1'
    passed('cleanup uses exact frozen bytes and original manifest with both diagnoses claimed')
    for index,t in enumerate(TABLES):
      db='cleanup_count_'+str(index)
      sql('create database '+db+' template success_case;',db='postgres')
      before=invariants(db)
      fixture_before=[value('select jsonb_agg(to_jsonb(t) order by id) from public.'+table+' t',db) for table in TABLES]
      sql("create function public.suppress_delete() returns trigger language plpgsql as $$ begin if old.id="+q(plan['rows'][t][1])+"::uuid then return null;end if;return old;end $$;create trigger suppress_delete before delete on public."+t+' for each row execute function public.suppress_delete();',db)
      r=execute_cleanup(db,False)
      assert r.returncode!=0 and b'Cleanup affected-row mismatch' in r.stderr, 'Affected-row refusal missing'
      assert counts(db)==[2]*6 and invariants(db)==before
      assert [value('select jsonb_agg(to_jsonb(t) order by id) from public.'+table+' t',db) for table in TABLES]==fixture_before
      passed('cleanup affected-row mismatch on '+t+' rolls back every prior delete')
    sql('create database cleanup_new_fk template success_case;',db='postgres')
    sql('create table public.unexpected_child(id uuid references public.diagnoses(id));','cleanup_new_fk')
    r=execute_cleanup('cleanup_new_fk',False)
    assert r.returncode!=0 and b'Fixture FK schema drift' in r.stderr and counts('cleanup_new_fk')==[2]*6
    passed('cleanup refuses unknown foreign key even with zero child rows')
    sql('create database cleanup_rollback template success_case;',db='postgres')
    assert cleanup_bytes.endswith(b'commit;')
    verify='do $$ begin '+''.join("if exists(select 1 from public."+t+") then raise exception 'cleanup in-transaction count';end if;" for t in TABLES)+' end $$;\n'
    sql(cleanup_bytes[:-len(b'commit;')]+verify.encode()+b'rollback;','cleanup_rollback')
    assert counts('cleanup_rollback')==[2]*6
    passed('cleanup explicit rollback restores all twelve after in-transaction zero-row confirmation')
    sentinel=value('insert into public.consultation_subjects(user_id,nickname) values('+q(plan['users'][0])+",'synthetic unrelated') returning id",'success_case')
    extra=value('insert into public.diagnosis_answers(diagnosis_id,question_key,question_text,answer_text) values('+q(plan['rows']['diagnoses'][0])+",'unexpected','synthetic','synthetic') returning id",'success_case')
    r=execute_cleanup('success_case',False)
    assert r.returncode!=0 and b'Unexpected dependent fixture row' in r.stderr and counts('success_case')==[3,2,2,2,3,2]
    passed('cleanup refuses unexpected related row and preserves every row')
    sql('delete from public.diagnosis_answers where id='+q(extra),'success_case')
    before=invariants('success_case');execute_cleanup('success_case')
    assert counts('success_case')==[1,0,0,0,0,0] and invariants('success_case')==before
    assert value('select id from public.consultation_subjects','success_case')==sentinel
    passed('UUID-scoped cleanup removes exactly twelve; unrelated row, users and profiles survive')
    assert (artifact/'complete.sql').read_bytes()==frozen and cleanup_file.read_bytes()==cleanup_bytes
    passed('artifact bytes unchanged after all positive and negative scenarios')
    report={'success':True,'mode':mode,'sqlSha256':sha,'cleanupSha256':cleanup_sha,'passed':len(checks),'checks':checks,'hostedWrites':0,'hostedConnections':0,'deploymentArtifactRegenerated':False,'insertedRows':12,'rollbackRemainingRows':0,'cleanupDeletedRows':12}
    args.report.parent.mkdir(parents=True,exist_ok=True)
    with args.report.open('x') as f: json.dump(report,f,indent=2);f.write('\n')
    os.chmod(args.report,0o400)
    print(json.dumps({'success':True,'mode':mode,'passed':len(checks),'sqlSha256':sha,'hostedConnections':0}))
  finally:
    command(['docker','rm','-f',CONTAINER],check=False)
