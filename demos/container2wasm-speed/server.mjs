#!/usr/bin/env node
// 独立的 container2wasm 加载速度 demo（不依赖主程序、不依赖 wrangler）。
// 用法: node demos/container2wasm-speed/server.mjs [cq-minimal-alpine.wasm] [port]
import http from "node:http";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const wasmPath = resolve(process.argv[2] ?? "/tmp/opencode/alpine-out2/cq-minimal-alpine.wasm");
const port = Number(process.argv[3] ?? 8950);
const c2wDist = resolve(process.cwd(), "node_modules/@webvirt/c2w/dist");
const entry = `
import { createContainer } from "@webvirt/c2w";
window.c2wStages = [];
const mark = (name) => window.c2wStages.push({ name, at: performance.now() });
window.runContainer = async (command) => {
  mark("createContainer:start");
  const container = await createContainer({
    wasmUrl: "/cq.wasm",
    command: ["/bin/sh", "-c", command],
    onExit: (code) => mark("exit:" + code),
  });
  mark("createContainer:done");
  let output = "";
  const decoder = new TextDecoder();
  for await (const bytes of container.stdio.stdout) output += decoder.decode(bytes);
  mark("stdout:done");
  return output;
};
`;
await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "js" },
  bundle: true, format: "esm", platform: "browser",
  outfile: "/tmp/opencode/c2w-speed-runner.mjs",
});
const runner = await readFile("/tmp/opencode/c2w-speed-runner.mjs", "utf8");
const vmWorker = await readFile(resolve(c2wDist, "vm-worker.js"), "utf8");
const ringWorker = await readFile(resolve(c2wDist, "ring-buffer-worker.js"), "utf8");

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>container2wasm 加载速度</title>
<style>
body{font-family:system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 16px;color:#e8edff;background:#0b1026}
button{background:#8ab4ff;border:0;border-radius:8px;padding:10px 18px;font-weight:700;cursor:pointer}
table{border-collapse:collapse;width:100%;margin-top:16px}
td,th{border:1px solid #35406b;padding:8px;text-align:left}
pre{background:#070b1c;color:#b8f0c8;padding:12px;border-radius:8px;white-space:pre-wrap}
.muted{color:#9aa6cc}
</style></head><body>
<h1>container2wasm 加载速度测试</h1>
<p class="muted">独立 demo：加载 ${wasmPath} 并在容器内执行 <code>echo CQ_READY</code>。</p>
<button id="run">开始测试</button><span id="status"></span>
<table><thead><tr><th>阶段</th><th>耗时</th></tr></thead><tbody id="rows"></tbody></table>
<h3>容器输出</h3><pre id="output"></pre>
<script type="module">
import "/runner.mjs";
const stages = [];
const fetchStart = new Map();
const originalFetch = window.fetch;
window.fetch = (input, init) => {
  const url = String(input);
  if (url.includes("/cq.wasm")) fetchStart.set(url, performance.now());
  return originalFetch(input, init).then((r) => {
    if (url.includes("/cq.wasm")) stages.push({ name: "wasm fetch", at: performance.now(), from: fetchStart.get(url) });
    return r;
  });
};
document.getElementById("run").onclick = async () => {
  const status = document.getElementById("status");
  stages.length = 0;
  window.c2wStages.length = 0;
  status.textContent = " 测试中…";
  document.getElementById("output").textContent = "";
  document.getElementById("rows").innerHTML = "";
  const t0 = performance.now();
  try {
    const out = await window.runContainer("echo CQ_READY");
    const events = [
      ...stages.map((s) => ({ name: s.name, start: s.from ?? t0, end: s.at })),
      ...window.c2wStages.map((s, i, a) => ({
        name: s.name,
        start: i ? a[i - 1].at : t0,
        end: s.at,
      })),
    ];
    events.push({ name: "总计", start: t0, end: performance.now() });
    const tbody = document.getElementById("rows");
    for (const e of events) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td>" + e.name + "</td><td>" + ((e.end - e.start) / 1000).toFixed(2) + "s</td>";
      tbody.appendChild(tr);
    }
    document.getElementById("output").textContent = out.slice(-2000);
    status.textContent = out.includes("CQ_READY") ? " 完成" : " 未收到 READY";
  } catch (error) {
    status.textContent = " 失败: " + String(error);
    document.getElementById("output").textContent = String(error.stack ?? error);
  }
};
</script></body></html>`;

const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/") {
    res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" }); res.end(html); return;
  }
  if (url === "/runner.mjs") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(runner); return; }
  if (url === "/vm-worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(vmWorker); return; }
  if (url === "/ring-buffer-worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(ringWorker); return; }
  if (url === "/cq.wasm") {
    const stat = await (await import("node:fs/promises")).stat(wasmPath);
    res.writeHead(200, { ...headers, "Content-Type": "application/wasm", "Content-Length": stat.size });
    const stream = (await import("node:fs")).createReadStream(wasmPath);
    stream.pipe(res); return;
  }
  res.writeHead(404); res.end();
});
server.listen(port, "127.0.0.1", () => {
  console.log(`速度 demo: http://127.0.0.1:${port}/`);
  console.log(`wasm: ${wasmPath}`);
});
