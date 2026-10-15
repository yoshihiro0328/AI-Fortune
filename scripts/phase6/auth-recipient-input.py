"""Loopback-only recipient collection. No Supabase requests, passwords, or emails sent."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs
import json,secrets,sys,os,re
private=Path(sys.argv[1]).resolve()
nonce=secrets.token_urlsafe(32)
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def output(self,status,text):
        self.send_response(status)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers();self.wfile.write(text.encode())
    def valid(self):return self.path=='/'+nonce and self.headers.get('Host')==f'127.0.0.1:{self.server.server_port}'
    def do_GET(self):
        if not self.valid():return self.output(404,'Not found')
        self.output(200,'''<!doctype html><meta charset="utf-8"><title>よりそい｜検証メール宛先の確認</title><style>body{font:18px sans-serif;max-width:640px;margin:48px auto;padding:20px;line-height:1.8}input{display:block;width:95%;padding:12px;font:inherit}button{margin-top:24px;padding:12px;font:inherit}</style><h1>検証メール宛先の確認</h1><p>この画面はMac内だけで動作します。宛先はGit管理外へ保存し、報告書にはA/Bとして記載します。<strong>登録もメール送信も行いません。</strong></p><p>新Supabase：ukdzggjfkcwjssjmnqim<br>最初は各1通・計2通。追加送信は別確認です。</p><form method="post"><label>ユーザーA（管理下のメール）<input name="a" type="email" required maxlength="254" autocomplete="off"></label><label>ユーザーB（別の管理下のメール）<input name="b" type="email" required maxlength="254" autocomplete="off"></label><p>パスワードや認証リンクは入力しないでください。</p><button>宛先を安全に保管（送信しない）</button></form>''')
    def do_POST(self):
        if not self.valid() or self.headers.get('Origin')!=f'http://127.0.0.1:{self.server.server_port}':return self.output(403,'拒否しました')
        try:
            n=int(self.headers.get('Content-Length','0'))
            if n<1 or n>2048:raise ValueError()
            if self.headers.get('Content-Type')!='application/x-www-form-urlencoded':raise ValueError()
            body=parse_qs(self.rfile.read(n).decode(),strict_parsing=True)
            if set(body)!={'a','b'} or any(len(v)!=1 for v in body.values()):raise ValueError()
            data={k:v[0].strip().lower() for k,v in body.items()}
            if data['a']==data['b'] or any(len(v)>254 or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+',v) for v in data.values()):raise ValueError()
            fd=os.open(private/'recipients.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as f:json.dump(data,f)
        except FileExistsError:return self.output(409,'既に保管済みです。変更する場合はお知らせください。')
        except (ValueError,UnicodeError):return self.output(400,'異なる2つの有効なメールアドレスを入力してください。')
        self.output(200,'<meta charset="utf-8"><h1>宛先を安全に保管しました</h1><p>ユーザー作成・メール送信は行っていません。この画面を閉じて構いません。</p>')
server=HTTPServer(('127.0.0.1',0),Handler)
(private/'recipient-input-url.txt').write_text(f'http://127.0.0.1:{server.server_port}/{nonce}')
os.chmod(private/'recipient-input-url.txt',0o600)
print('Local recipient input ready (no sending)',flush=True)
server.serve_forever()
