#!/usr/bin/env node
// 真实浏览器验证 Container Shell 清单首屏、语言切换与工件请求。
// 用法: C2W_BROWSER=/opt/microsoft/msedge/msedge node scripts/test-container-selector.mjs
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadC2wBrowserWorkerAssets } from "./c2w-browser-assets.mjs";

const browserBin = process.env.C2W_BROWSER ?? "firefox";
const timeoutMs = Number(process.env.C2W_SELECTOR_TEST_TIMEOUT_MS ?? 180_000);
const port = 8940;
const tmp = "/tmp/opencode/c2w-selector-test";
mkdirSync(tmp, { recursive: true });

await build({
  stdin: {
    contents: `import React from "react";
      import { createRoot } from "react-dom/client";
      import { ContainerShell } from "./apps/web/src/components/ContainerShell.tsx";
      import { I18nProvider } from "./apps/web/src/i18n/I18nProvider.tsx";
      import { ThemeProvider } from "./apps/web/src/theme/ThemeProvider.tsx";
      createRoot(document.getElementById("root")).render(
        React.createElement(I18nProvider, null,
          React.createElement(ThemeProvider, null,
            React.createElement(ContainerShell, { onBack: () => {} }),
          ),
        ),
      );
      const report = (stage, data = {}) => fetch("/event", { method: "POST", body: JSON.stringify({ stage, ...data }) }).catch(() => {});
      const waitFor = async (check, label) => {
        const started = Date.now();
        while (Date.now() - started < 120000) {
          const value = await check();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("timeout waiting for " + label);
      };
      const runtimeRequests = async () => (await fetch("/requests").then((response) => response.json())).requests;
      window.runSelectorChecks = async () => {
        const select = await waitFor(() => document.querySelector(".container-environment-select select"), "selector");
        await waitFor(() => {
          const items = [...select.options];
          return items.length === 5 && items.every((option) => !option.disabled);
        }, "all artifacts enabled");
        const options = [...select.options].map((option) => ({ value: option.value, disabled: option.disabled }));
        await waitFor(() => document.querySelector(".xterm-screen")?.textContent.includes("$"), "initial shell prompt");
        const initialRequests = await runtimeRequests();
        const initialUrl = initialRequests.find((url) => url.includes("cq-dev-shell.wasm")) || "";
        report("initial", { initialUrl, options });
        select.value = "javascript";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await waitFor(async () => (await runtimeRequests()).some((url) => url.includes("cq-dev-javascript.wasm")), "javascript wasm request");
        await waitFor(() => document.querySelector(".xterm-screen")?.textContent.includes("$"), "javascript shell prompt");
        await waitFor(() => !document.querySelector(".container-startup-progress"), "progress hidden");
        const requests = await runtimeRequests();
        return {
          options,
          initialUrl,
          javascriptUrl: requests.find((url) => url.includes("cq-dev-javascript.wasm")) || "",
          legacyRequested: requests.some((url) => url.includes("cq-minimal.wasm")),
          selectedValue: select.value,
          image: document.querySelector(".container-environment-select")?.parentElement?.textContent || "",
        };
      };`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: `${tmp}/runner.mjs`,
});
const runner = readFileSync(`${tmp}/runner.mjs`, "utf8");
const css = existsSync(`${tmp}/runner.css`) ? readFileSync(`${tmp}/runner.css`) : Buffer.alloc(0);
const shellBytes = statSync("/tmp/opencode/cq-dev-shell.wasm").size;
const assets = await loadC2wBrowserWorkerAssets(process.cwd(), { totalBytes: shellBytes });
const manifest = readFileSync(resolve("apps/web/public/container-environments.json"));
const html = `<!doctype html><html><head><link rel="stylesheet" href="/runner.css"></head><body><div id="root"></div><pre id="status">starting</pre><script type="module">
import "/runner.mjs";
const status = document.getElementById("status");
const timer = setTimeout(async () => {
  status.textContent = "TIMEOUT";
  await fetch("/done", { method: "POST", body: JSON.stringify({ ok: false, timeout: true }) });
}, ${timeoutMs});
try {
  const result = await window.runSelectorChecks();
  clearTimeout(timer); status.textContent = "DONE";
  await fetch("/done", { method: "POST", body: JSON.stringify({ ok: true, result }) });
} catch (error) {
  clearTimeout(timer); status.textContent = "ERROR " + error;
  await fetch("/done", { method: "POST", body: JSON.stringify({ ok: false, error: String(error), stack: String(error?.stack ?? error) }) });
}
</script></body></html>`;

let finish;
const done = new Promise((resolveDone) => { finish = resolveDone; });
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const runtimeRequests = [];
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/event") {
    let body = ""; for await (const chunk of req) body += chunk;
    console.log("EVENT " + body);
    res.writeHead(204); res.end(); return;
  }
  if (url === "/done") {
    let body = ""; for await (const chunk of req) body += chunk;
    res.writeHead(204); res.end(); finish(body); return;
  }
  if (url === "/") { res.writeHead(200, { ...headers, "Content-Type": "text/html" }); res.end(html); return; }
  if (url === "/runner.mjs") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(runner); return; }
  if (url === "/runner.css") { res.writeHead(200, { ...headers, "Content-Type": "text/css" }); res.end(css); return; }
  if (url === "/container-environments.json") { res.writeHead(200, { ...headers, "Content-Type": "application/json" }); res.end(manifest); return; }
  if (url === "/requests") { res.writeHead(200, { ...headers, "Content-Type": "application/json" }); res.end(JSON.stringify({ requests: runtimeRequests })); return; }
  if (url === "/vm-worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(assets.vmWorker); return; }
  if (url === "/ring-buffer-worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(assets.ringWorker); return; }
  const vendor = assets.vendorFiles.get(url);
  if (vendor) { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(vendor); return; }
  const runtime = url.match(/^\/runtime\/cq-dev-(shell|javascript)\.wasm$/);
  if (runtime) {
    runtimeRequests.push(req.url);
    const file = resolve(`/tmp/opencode/cq-dev-${runtime[1]}.wasm`);
    res.writeHead(200, { ...headers, "Content-Type": "application/wasm", "Content-Length": statSync(file).size });
    createReadStream(file).pipe(res); return;
  }
  res.writeHead(404); res.end();
});
await new Promise((resolveReady) => server.listen(port, "127.0.0.1", resolveReady));
console.log("CONTAINER_SELECTOR_TEST_READY");
const profile = `${tmp}/profile-${process.pid}`;
rmSync(profile, { recursive: true, force: true });
const chromium = !/firefox/i.test(browserBin);
const browser = spawn(browserBin, [
  ...(chromium
    ? ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions", `--user-data-dir=${profile}`]
    : ["--headless", `--user-data-dir=${profile}`]),
  `http://127.0.0.1:${port}/`,
], { stdio: ["ignore", "inherit", "inherit"], detached: true });
browser.on("exit", (code, signal) => finish(JSON.stringify({ ok: false, browserExit: code, signal })));
const timer = setTimeout(() => finish(JSON.stringify({ ok: false, timeout: true, timeoutMs })), timeoutMs + 10_000);
const raw = await done;
clearTimeout(timer);
try { process.kill(-browser.pid, "SIGTERM"); } catch { browser.kill("SIGTERM"); }
await new Promise((resolveClose) => server.close(resolveClose));
const parsed = JSON.parse(raw);
const result = parsed.result;
const checks = {
  allEnabled: result?.options?.length === 5 && result.options.every((item) => !item.disabled),
  initialNewShell: Boolean(result?.initialUrl?.includes("cq-dev-shell.wasm")),
  switched: result?.selectedValue === "javascript" && Boolean(result?.javascriptUrl?.includes("cq-dev-javascript.wasm")),
  noLegacy: result?.legacyRequested === false,
};
const report = { ...parsed, checks, browser: browserBin, at: new Date().toISOString() };
console.log(JSON.stringify(report, null, 2));
const { writeFile } = await import("node:fs/promises");
await writeFile("docs/container-selector-result.json", JSON.stringify(report, null, 2) + "\n");
process.exit(parsed.ok && Object.values(checks).every(Boolean) ? 0 : 1);
