"""Launch without inheriting .env.local or provider keys. macOS only; read-only stage."""
import json,os,sys,subprocess,secrets
from pathlib import Path
private=Path(sys.argv[1]).resolve()
app=private/'app'
if any(app.glob('.env')) or any(app.glob('.env.local')) or any(app.glob('.env.production*')):
    raise SystemExit('Unexpected env file')
node=subprocess.check_output(['which','node'],text=True).strip()
scripts=Path(__file__).resolve().parent
runtime=json.loads((private/'runtime.json').read_text())
if not runtime.get('PHASE6_PROXY_TOKEN'):
    runtime['PHASE6_PROXY_TOKEN']=secrets.token_hex(32)
    (private/'runtime.json').write_text(json.dumps(runtime));os.chmod(private/'runtime.json',0o600)
env={**runtime,'PATH':os.environ['PATH'],'NODE_OPTIONS':'--import='+str(scripts/'local-auth-fetch.mjs')}
profile='(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:5199"))'
proxylog=(private/'egress.log').open('a'); applog=(private/'app.log').open('a')
proxy=subprocess.Popen([node,str(scripts/'local-auth-egress.mjs'),str(private/'runtime.json')],stdout=proxylog,stderr=proxylog,env={'PATH':os.environ['PATH']})
server=subprocess.Popen(['/usr/bin/sandbox-exec','-p',profile,node,str(scripts/'local-auth-server.mjs')],cwd=app,env=env,stdout=applog,stderr=applog)
(private/'pids.json').write_text(json.dumps({'proxy':proxy.pid,'server':server.pid}))
print('Read-only local processes launched; no credentials printed',flush=True)
try:
    result=server.wait()
finally:
    proxy.terminate();proxy.wait()
sys.exit(result)
