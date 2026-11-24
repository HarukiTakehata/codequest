#!/usr/bin/env node
// M2.5 Java 运行时实测 spike（设计书 v0.3）。
// 在无自动化浏览器驱动的环境中，用 firefox --headless 加载本地静态页，
// 页面内运行 @live-codes/java-wasm（teavm-javac）并把结果 POST 回本地服务。
// 用法: node scripts/spike-java.mjs [firefox 可执行文件]
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "node_modules/@live-codes/java-wasm/dist/");
const firefoxBin = process.argv[2] ?? "firefox";
const port = 8933;

const html = `<!doctype html><html><body><pre id="out">running...</pre>
<script src="/java-wasm.iife.js"></script>
<script>
(async () => {
  const post = (body) => fetch('/done', { method: 'POST', body: JSON.stringify(body) });
  try {
    const rt = await JavaWasm.createRuntime({ baseUrl: location.origin + '/' });
    const run = async (src, input) => {
      const r = await rt.run(src, { input });
      return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode,
        compileMs: r.compileMs, generateMs: r.generateMs, runMs: r.runMs };
    };
    const hello = await run('public class Main { public static void main(String[] a){ System.out.println("Hello from Java"); } }', '');
    const stdin = await run(
      'import java.util.Scanner; public class Main { public static void main(String[] a){ Scanner s=new Scanner(System.in); int x=s.nextInt(), y=s.nextInt(); System.out.println("sum="+(x+y)); } }',
      '2\\n3\\n');
    const bad = await run('public class Main { public static void main(String[] a){ int x = ; } }', '');
    rt.destroy();
    await post({ hello, stdin, bad: { ok: bad.ok, stderr: String(bad.stderr).slice(0, 300), exitCode: bad.exitCode } });
  } catch (error) {
    await post({ error: String(error), stack: String(error.stack ?? '') });
  }
})();
</script></body></html>`;

let finish;
const done = new Promise((r) => { finish = r; });
const server = http.createServer(async (req, res) => {
  if (req.url === "/done") {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(204); res.end();
    finish(body);
    return;
  }
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html); return;
  }
  try {
    const data = await readFile(resolve(dist, req.url.replace(/^\//, "")));
    res.writeHead(200, {
      "Content-Type": req.url.endsWith(".wasm") || req.url.endsWith(".bin")
        ? "application/wasm" : "application/javascript",
    });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});

await new Promise((r) => server.listen(port, "127.0.0.1", r));
console.log(`SERVER_READY http://127.0.0.1:${port}/`);
const browser = spawn(firefoxBin, [
  "--headless", "--user-data-dir", `/tmp/opencode/ff-java-spike-${process.pid}`,
  `http://127.0.0.1:${port}/`,
], { stdio: "ignore" });

const timer = setTimeout(() => finish(JSON.stringify({ timeout: true })), 150_000);
const raw = await done;
clearTimeout(timer);
browser.kill("SIGTERM");
server.close();
console.log("RESULT " + raw);
let result;
try { result = JSON.parse(raw); } catch { result = { parseError: raw }; }
if (result.timeout || result.error) process.exit(1);
if (!result.hello?.ok || result.hello.stdout !== "Hello from Java\n") process.exit(2);
if (!result.stdin?.ok || result.stdin.stdout !== "sum=5\n") process.exit(3);
if (result.bad?.ok !== false) process.exit(4);
console.log("M2.5_JAVA_SPIKE_PASS");
