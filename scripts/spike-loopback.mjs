#!/usr/bin/env node
// M4 loopback 实测 spike（设计书 §5.5.1）：在真实 container2wasm 容器里
// 启动 `nc -l 127.0.0.1` 并用 `netstat -ltn` 检查监听端口。
// 用法: node scripts/spike-loopback.mjs <cq-teaching.wasm> [firefox]
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [wasmArg, firefox = "firefox"] = process.argv.slice(2);
if (!wasmArg) { console.error("用法: node scripts/spike-loopback.mjs <cq-teaching.wasm>"); process.exit(1); }
const wasm = resolve(wasmArg);
const port = 8934;
const tmp = "/tmp/opencode/c2w-spike";
await build({
  stdin: {
    contents: `import { createContainer } from "@webvirt/c2w";
      window.runContainer = async (command) => {
        const container = await createContainer({ wasmUrl: "/cq-teaching.wasm", command });
        const decoder = new TextDecoder();
        let output = "";
        const reader = container.stdio.stdout.getReader();
        while (true) { const { done, value } = await reader.read(); if (done) break; output += decoder.decode(value); }
        return output;
      };`,
    resolveDir: process.cwd(), loader: "js",
  },
  bundle: true, format: "iife", platform: "browser", outfile: `${tmp}/runner.js`,
});
const runner = await readFile(`${tmp}/runner.js`, "utf8");
const html = `<!doctype html><html><body><script src="/runner.js"></script><script>
(async () => {
  const post = (body) => fetch('/done', { method: 'POST', body: JSON.stringify(body) });
  const progress = (stage) => fetch('/progress', { method: 'POST', body: stage });
  try {
    await progress('page-loaded');
    const out = await window.runContainer(["/bin/sh", "-c",
      "nc -l 127.0.0.1 8080 >/dev/null 2>&1 & sleep 2; netstat -ltn; echo LOOPBACK_MARKER"]);
    await progress('container-returned');
    await post({ ok: true, output: out.slice(-4000) });
  } catch (error) { await post({ ok: false, error: String(error), stack: String(error.stack ?? '') }); }
})();
</script></body></html>`;

let finish;
const done = new Promise((r) => { finish = r; });
let currentStage = "starting";
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const server = http.createServer(async (req, res) => {
  console.log("REQ " + req.url);
  if (req.url === "/done") {
    let body = ""; for await (const chunk of req) body += chunk;
    res.writeHead(204); res.end(); finish(body); return;
  }
  if (req.url === "/progress") {
    let body = ""; for await (const chunk of req) body += chunk;
    res.writeHead(204); res.end(); currentStage = body; console.log("PROGRESS " + body); return;
  }
  if (req.url === "/") { res.writeHead(200, { ...headers, "Content-Type": "text/html" }); res.end(html); return; }
  if (req.url === "/runner.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(runner); return; }
  if (req.url === "/cq-teaching.wasm") {
    res.writeHead(200, { ...headers, "Content-Type": "application/wasm" });
    res.end(await readFile(wasm)); return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));
console.log("SERVER_READY");
const { rmSync } = await import("node:fs");
rmSync(`${tmp}/profile`, { recursive: true, force: true });
const browser = spawn(firefox, ["--headless", "--user-data-dir", `${tmp}/profile`, `http://127.0.0.1:${port}/`], { stdio: ["ignore", "ignore", "inherit"] });
const timer = setTimeout(() => finish(JSON.stringify({ ok: false, timeout: true, stage: currentStage })), 900_000);
const raw = await done;
clearTimeout(timer); browser.kill("SIGTERM"); server.close();
console.log("RESULT " + raw);
let result;
try { result = JSON.parse(raw); } catch { result = { raw }; }
if (!result.ok) process.exit(1);
const loopback = /127\.0\.0\.1:8080|0\.0\.0\.0:8080/.test(result.output ?? "");
console.log(loopback ? "LOOPBACK_LISTEN_CONFIRMED" : "LOOPBACK_LISTEN_NOT_CONFIRMED");
await writeFile("docs/spike-loopback-result.json", JSON.stringify({ ...result, loopback, at: new Date().toISOString() }, null, 2) + "\n");
process.exit(loopback ? 0 : 2);
