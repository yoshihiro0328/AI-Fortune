// Local harness only. The browser uses its real cookie; no cookie/JWT/response
// body is read by computer-use tools. Only HTTP status numbers reach the DOM.
export const postCloseProbe = `<!doctype html><html lang="ja"><meta charset="utf-8">
<title>終了後のアクセス拒否確認</title><h1>終了後のアクセス拒否確認</h1>
<p>Dまたは未認証のタブで実行します。契約のあるCでは実行しません。</p>
<button id="verify">アクセス拒否を確認する</button><pre id="result">未実行</pre>
<a href="/account">アプリへ戻る</a>
<script>
document.getElementById('verify').onclick=async function(){
 this.disabled=true;const output=document.getElementById('result');
 try {
  const current=await fetch('/api/billing');
  if(current.status!==401 && (current.status!==200 || (await current.json()).subscription!==null))throw Error();
  const expected=current.status===401?401:403, results=[];
  for(const action of ['checkout','portal','cancel']){
   const r=await fetch('/api/billing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,consent:true})});
   results.push(action+': '+r.status); if(r.status!==expected)throw Error();
  }
  output.textContent='確認成功\\n'+results.join('\\n');
 }catch{output.textContent='確認停止：結果不一致または通信失敗。再送しないでください。';}
};
</script></html>`;
