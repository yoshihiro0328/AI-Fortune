"""Read-only checks for the STEP 6 harness. Never invokes Auth signup/login/mail."""
import json,sys
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
private=Path(sys.argv[1]);env=json.loads((private/'runtime.json').read_text());checks=[]
def call(path,method='GET',proxy=False,headers=None):
    base='http://127.0.0.1:5199' if proxy else 'http://localhost:5198'
    try:
        r=urlopen(Request(base+path,method=method,headers=headers or {},data=b'{}' if method=='POST' else None),timeout=20)
        return r.status,r.read(),r.headers
    except HTTPError as e:return e.code,e.read(),e.headers
def check(label,condition):
    if not condition:raise RuntimeError('Check failed: '+label)
    checks.append(label)
for path in ['/','/diagnosis/partner-mind','/account']:
    status,_,h=call(path);check(path+' display/noindex',status==200 and 'noindex' in h.get('X-Robots-Tag',''))
status,body,_=call('/api/auth');check('unauthenticated Auth API',status==200 and json.loads(body)=={'user':None,'recovery':False})
status,body,_=call('/api/questions?flow=v2');check('new DB question read',status==200 and len(json.loads(body))==9)
for path in ['/api/consultations','/api/billing']:
    check(path+' authentication required',call(path)[0]==401)
for path,method in [('/api/auth','POST'),('/api/diagnoses','POST'),('/api/events','POST'),('/auth/callback?code=invalid','GET'),('/api/cron/mail','GET')]:
    check(path+' stopped before mutation',call(path,method)[0]==403)
headers={'x-step6-token':env['PHASE6_PROXY_TOKEN'],'apikey':env['NEXT_PUBLIC_SUPABASE_ANON_KEY']}
status,body,_=call('/auth/v1/settings',proxy=True,headers=headers)
data=json.loads(body);check('real new Auth settings readable; confirmation on',status==200 and data.get('mailer_autoconfirm') is False)
for path,method in [('/auth/v1/signup','POST'),('/auth/v1/verify','GET'),('/rest/v1/rpc/consume_limit','GET'),('/rest/v1/diagnoses','POST')]:
    check(path+' egress write denied',call(path,method,True,headers)[0]==403)
check('egress requires local secret',call('/auth/v1/settings',proxy=True)[0]==403)
secret_values=[env[k].encode() for k in ['SUPABASE_SERVICE_ROLE_KEY','SESSION_SECRET']]
files=list((private/'app/.next/static').rglob('*'))+[private/'app.log',private/'egress.log',private/'build.log']
check('no server secrets in client bundles or logs',not any(any(v in p.read_bytes() for v in secret_values) for p in files if p.is_file()))
result={'passed':len(checks),'checks':checks,'auth_users_created':0,'emails_sent':0,'writes_sent_upstream':0}
(private/'smoke.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
