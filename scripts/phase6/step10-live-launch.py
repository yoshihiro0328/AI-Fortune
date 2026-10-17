"""Dedicated loopback runtime. Never sources .env, never launches hosted tests automatically."""
import json,os,sys,subprocess,shutil
from pathlib import Path
private=Path(sys.argv[1]).resolve()
mode=sys.argv[2]
if mode not in ('app','runner'): raise SystemExit('Explicit app or runner mode required')
r=json.loads((private/'runtime.json').read_text())
scripts=Path(__file__).resolve().parent
app=private/'app'
if any(p.name.startswith('.env') and p.name!='.env.example' for p in app.iterdir()): raise SystemExit('Unexpected environment file')
node=shutil.which('node')
env={**r,'PATH':os.environ['PATH'],'STEP10_PRIVATE':str(private),'NODE_OPTIONS':'--import='+str(scripts/'step10-live-fetch.mjs')}
profile='(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:5209"))(allow network-outbound (remote ip "localhost:5208"))'
script='step10-live-server.mjs' if mode=='app' else 'step10-live-runner.mjs'
result=subprocess.run(['/usr/bin/sandbox-exec','-p',profile,node,str(scripts/script)],cwd=app,env=env)
sys.exit(result.returncode)
