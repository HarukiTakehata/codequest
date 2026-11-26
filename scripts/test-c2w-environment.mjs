#!/usr/bin/env node
// 在真实浏览器中验证指定语言的 container2wasm 开发环境。
// 用法: node scripts/test-c2w-environment.mjs <shell|cpp|java|python|javascript> <raw.wasm>
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { readFile, mkdir, stat } from "node:fs/promises";
import { createReadStream, rmSync } from "node:fs";
import { resolve } from "node:path";
import { resolveLanguage } from "./containers/config.mjs";
import { loadC2wBrowserWorkerAssets } from "./c2w-browser-assets.mjs";

const language = resolveLanguage(process.argv[2]);
const wasm = resolve(process.argv[3] ?? `/tmp/opencode/cq-dev-${language.id}.wasm`);
const browserBin = process.env.C2W_BROWSER ?? "firefox";
const timeoutMs = Number(process.env.C2W_TEST_TIMEOUT_MS ?? 180_000);
const port = 8970 + ["shell", "cpp", "java", "python", "javascript"].indexOf(language.id);
const tmp = `/tmp/opencode/c2w-env-test-${language.id}`;
await mkdir(tmp, { recursive: true });
const wasmStat = await stat(wasm);
const assets = await loadC2wBrowserWorkerAssets(process.cwd(), { totalBytes: wasmStat.size });
const command = `set -e\ncommand -v git && command -v vim && command -v nano && ${language.smoke}\necho CQ_ENV_DONE`;
const entry = `
import { createContainer } from "@webvirt/c2w";
window.runEnvironment = async () => {
  let finish;
  const completed = new Promise((resolveDone) => { finish = resolveDone; });
  let stdout = "";
  let stderr = "";
  const container = await createContainer({
    wasmUrl: "/cq.wasm",
    entrypoint: "/bin/sh",
    command: ["-c", ${JSON.stringify(command)}],
    onExit: (code) => finish({ stdout, stderr, code }),
  });
  const pump = async (reader, name) => {
    const decoder = new TextDecoder();
    let text = "";
    try {
      for await (const bytes of reader) {
        text += decoder.decode(bytes, { stream: true });
        if (name === "stdout") {
          stdout = text;
          if (text.includes("CQ_ENV_DONE")) finish({ stdout, stderr, code: 0 });
        } else stderr = text;
      }
    } catch (error) { finish({ stdout, stderr, code: null, error: String(error) }); }
  };
  void pump(container.stdio.stdout, "stdout");
  void pump(container.stdio.stderr, "stderr");
  return completed;
};
`;
await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "js" }, bundle: true, format: "esm", platform: "browser", outfile: `${tmp}/runner.mjs` });
const runner = await readFile(`${tmp}/runner.mjs`, "utf8");
const html = `<!doctype html><html><body><pre id="status">starting</pre><script type="module">
import "/runner.mjs";
const status = document.getElementById("status");
const timer = setTimeout(async () => {
  status.textContent = "TIMEOUT";
  await fetch("/done", { method: "POST", body: JSON.stringify({ ok: false, timeout: true }) });
}, ${timeoutMs});
try {
  const result = await window.runEnvironment();
  clearTimeout(timer); status.textContent = "DONE";
  await fetch("/done", { method: "POST", body: JSON.stringify({ ok: true, result }) });
} catch (error) {
  clearTimeout(timer); status.textContent = "ERROR";
  await fetch("/done", { method: "POST", body: JSON.stringify({ ok: false, error: String(error?.stack ?? error) }) });
}
</script></body></html>`;

let finish;
const done = new Promise((resolveDone) => { finish = resolveDone; });
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/done") {
    let body = ""; for await (const chunk of req) body += chunk;
    res.writeHead(204); res.end(); finish(body); return;
  }
  if (url === "/") { res.writeHead(200, { ...headers, "Content-Type": "text/html" }); res.end(html); return; }
  if (url === "/runner.mjs") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(runner); return; }
  if (url === "/vm-worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(assets.vmWorker); return; }
  if (url === "/ring-buffer-worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(assets.ringWorker); return; }
  const vendor = assets.vendorFiles.get(url);
  if (vendor) { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(vendor); return; }
  if (url === "/cq.wasm") {
    res.writeHead(200, { ...headers, "Content-Type": "application/wasm", "Content-Length": wasmStat.size });
    createReadStream(wasm).pipe(res); return;
  }
  res.writeHead(404); res.end();
});
await new Promise((resolveReady) => server.listen(port, "127.0.0.1", resolveReady));
const profile = `${tmp}/profile-${process.pid}`;
rmSync(profile, { recursive: true, force: true });
const chromium = !/firefox/i.test(browserBin);
const browser = spawn(browserBin, [
  ...(chromium
    ? ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions", `--user-data-dir=${profile}`]
    : ["--headless", "--user-data-dir", profile]),
  `http://127.0.0.1:${port}/`,
], { stdio: ["ignore", "inherit", "inherit"], detached: true });
const timer = setTimeout(() => finish(JSON.stringify({ ok: false, timeout: true })), timeoutMs + 10_000);
const raw = await done;
clearTimeout(timer);
try { process.kill(-browser.pid, "SIGTERM"); } catch {}
await new Promise((resolveClose) => server.close(resolveClose));
const parsed = JSON.parse(raw);
const output = `${parsed.result?.stdout ?? ""}${parsed.result?.stderr ?? ""}`;
const ok = parsed.ok && parsed.result?.code === 0 && output.includes(language.expect) && output.includes("CQ_ENV_DONE");
console.log(JSON.stringify({ language: language.id, ok, wasmBytes: wasmStat.size, result: parsed }, null, 2));
process.exit(ok ? 0 : 1);
