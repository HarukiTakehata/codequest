import http from 'node:http';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const root='/home/yang/文档/codequest';
await build({
  stdin:{contents:`
    import { Terminal } from '@xterm/xterm';
    import { openShellSession } from '${root}/packages/runtime-shell/src/session-client.ts';
    window.boot = async () => {
      const term = new Terminal({ cols:80, rows:24, convertEol:true });
      term.open(document.getElementById('term'));
      const files = await fetch('/container-shell/rootfs.json').then(r=>r.json());
      const s = await openShellSession(files, {cols:80,rows:24});
      const dec = new TextDecoder();
      s.onOutput(b => term.write(dec.decode(b)));
      term.onData(d => s.write(d));
      term.onResize(({cols,rows})=>s.resize(cols,rows));
      return { term, s };
    };
  `, resolveDir:root, loader:'js'},
  bundle:true, format:'iife', platform:'browser', outfile:'/tmp/opencode/xterm-harness-bundle.js',
});
const js=await readFile('/tmp/opencode/xterm-harness-bundle.js','utf8');
const css=await readFile(root+'/node_modules/@xterm/xterm/css/xterm.css','utf8');
const html=`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="term"></div><script>${js}</script><script>
const post=(b)=>fetch('/done',{method:'POST',body:JSON.stringify(b)});
(async()=>{try{
 await window.boot();
 const { term, s } = await window.boot2 || {};
 await fetch('/ready',{method:'POST',body:'ok'});
 // Tab 补全测试：输入 cat /home/stud + Tab
 const t = window.__t;
 await post({ok:true});
}catch(e){await post({ok:false,error:String(e),stack:String(e.stack)})}})();
</script></body></html>`;
let finish;const done=new Promise(r=>{finish=r;});
const H={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'};
const server=http.createServer(async(req,res)=>{
 console.log('REQ',req.url);
 if(req.url==='/done'){let b='';for await(const c of req)b+=c;res.writeHead(204);res.end();finish(b);return;}
 if(req.url==='/ready'){for await(const c of req);res.writeHead(204);res.end();return;}
 if(req.url==='/'){res.writeHead(200,{...H,'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
 if(req.url==='/container-shell/rootfs.json'){const f=await readFile(root+'/apps/web/public/container-shell/rootfs.json');res.writeHead(200,{...H,'Content-Type':'application/json'});res.end(f);return;}
 res.writeHead(404);res.end();
});
await new Promise(r=>server.listen(8936,'127.0.0.1',r));
console.log('SERVER_READY');
const browser=spawn('firefox',['--headless','--user-data-dir','/tmp/opencode/ff-xterm-harness','http://127.0.0.1:8936/'],{stdio:['ignore','ignore','inherit']});
const timer=setTimeout(()=>finish(JSON.stringify({ok:false,timeout:true})),60000);
const raw=await done;clearTimeout(timer);browser.kill('SIGTERM');server.close();
console.log('RESULT '+raw);
