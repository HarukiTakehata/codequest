#!/usr/bin/env node
// M4 loopback 实测 spike（设计书 §5.5.1）：在真实 container2wasm 容器里
// 启动 `nc -l 127.0.0.1` 并用 `netstat -ltn` 检查监听端口。
// 用法: node scripts/spike-loopback.mjs <cq-teaching.wasm> [firefox]
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { loadC2wBrowserWorkerAssets } from "./c2w-browser-assets.mjs";

const [wasmArg, firefox = "firefox"] = process.argv.slice(2);
if (!wasmArg) { console.error("用法: node scripts/spike-loopback.mjs <cq-teaching.wasm>"); process.exit(1); }
const wasm = resolve(wasmArg);
const port = 8934;
const timeoutMs = Number(process.env.C2W_SPIKE_TIMEOUT_MS ?? 180_000);
const tmp = "/tmp/opencode/c2w-spike";
await build({
  stdin: {
    contents: `import { createContainer } from "@webvirt/c2w";
      window.runContainer = async (command) => {
        let finish;
        const completed = new Promise((resolveDone) => { finish = resolveDone; });
        let stdout = "";
        let stderr = "";
        const container = await createContainer({
          wasmUrl: "/cq-teaching.wasm",
          entrypoint: "/bin/sh",
          command,
          onExit: () => finish(stdout + stderr),
        });
        const pump = async (reader, name) => {
          const decoder = new TextDecoder();
          let text = "";
          try {
            for await (const bytes of reader) {
              text += decoder.decode(bytes, { stream: true });
              if (name === "stdout") { stdout = text; if (text.includes("LOOPBACK_MARKER")) finish(stdout + stderr); }
              else stderr = text;
            }
          } catch (error) { finish(stdout + stderr + "\\nSTDIO_ERROR " + error); }
        };
        void pump(container.stdio.stdout, "stdout");
        void pump(container.stdio.stderr, "stderr");
        return completed;
      };`,
    resolveDir: process.cwd(), loader: "js",
  },
  bundle: true, format: "esm", platform: "browser", outfile: `${tmp}/runner.mjs`,
});
const runner = await readFile(`${tmp}/runner.mjs`, "utf8");
const { vmWorker, ringWorker, vendorFiles } = await loadC2wBrowserWorkerAssets(process.cwd(), { totalBytes: (await stat(wasm)).size });
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import "/runner.mjs";
(async () => {
  const post = (body) => fetch('/done', { method: 'POST', body: JSON.stringify(body) });
  const progress = (stage) => fetch('/progress', { method: 'POST', body: stage });
  try {
    await progress('page-loaded');
    const out = await window.runContainer(["-c",
      "nc -l -p 8080 127.0.0.1 >/dev/null 2>&1 & sleep 2; netstat -ltn; echo LOOPBACK_MARKER"]);
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
  if (req.url === "/runner.mjs" || req.url.startsWith("/runner.mjs?")) {
    res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(runner); return;
  }
  if (req.url.startsWith("/vm-worker.js")) {
    res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(vmWorker); return;
  }
  if (req.url.startsWith("/ring-buffer-worker.js")) {
    res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(ringWorker); return;
  }
  const vendor = vendorFiles.get(req.url.split("?")[0]);
  if (vendor) { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(vendor); return; }
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
const timer = setTimeout(() => finish(JSON.stringify({ ok: false, timeout: true, stage: currentStage, timeoutMs })), timeoutMs);
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
