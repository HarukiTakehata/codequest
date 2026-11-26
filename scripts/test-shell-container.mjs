#!/usr/bin/env node
// Shell 教学真实容器 E2E：预设文件、会话持久、重置销毁、脚本判题、交互终端。
// 用法: node scripts/test-shell-container.mjs [raw.wasm] [firefox]
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { loadC2wBrowserWorkerAssets } from "./c2w-browser-assets.mjs";

const [wasmArg, browserBin = "firefox"] = process.argv.slice(2);
if (!wasmArg) { console.error("用法: node scripts/test-shell-container.mjs <raw.wasm> [firefox]"); process.exit(1); }
const wasm = resolve(wasmArg);
const port = 8935;
const timeoutMs = Number(process.env.C2W_SHELL_TEST_TIMEOUT_MS ?? 120_000);
const tmp = "/tmp/opencode/c2w-shell-test";

await build({
  stdin: {
    contents: `import { openAutomatedContainerSession, openContainerSession, buildContainerGoalCheckScript, parseContainerGoalChecks } from "./packages/runtime-shell/src/container-runtime.ts";
      const report = (stage, data = {}) => fetch("/event", { method: "POST", body: JSON.stringify({ stage, ...data }) }).catch(() => {});
      window.runShellChecks = async () => {
        const results = {};
        report("first:open:start");
        const first = await openAutomatedContainerSession({ "/home/student/secret.txt": "decoy\\nCQ{bandit-one}\\n" });
        report("first:open:done");
        try {
          report("bandit:start");
          results.bandit = await first.run({ lang: "shell", code: "cat secret.txt", stdin: "", files: {}, timeoutMs: 10_000 });
          report("bandit:done", { result: results.bandit });
          report("write:start");
          results.write = await first.run({ lang: "shell", code: "echo persisted > persisted.txt", stdin: "", files: {}, timeoutMs: 10_000 });
          report("write:done", { result: results.write });
          report("persist:start");
          results.persist = await first.run({ lang: "shell", code: "cat persisted.txt", stdin: "", files: {}, timeoutMs: 10_000 });
          report("persist:done", { result: results.persist });
        } finally { report("first:close"); first.close(); }

        report("reset:open:start");
        const reset = await openAutomatedContainerSession({
          "/home/student/secret.txt": "CQ{bandit-one}\\n",
          "/home/student/words.txt": "b\\na\\nb\\n",
        });
        report("reset:open:done");
        try {
          report("reset:check:start");
          results.reset = await reset.run({ lang: "shell", code: "test ! -e persisted.txt", stdin: "", files: {}, timeoutMs: 10_000 });
          report("reset:check:done", { result: results.reset });
          report("script:start");
          results.script = await reset.run({
            lang: "shell",
            code: "cat words.txt | sort | uniq -c",
            stdin: "",
            files: {},
            timeoutMs: 10_000,
          });
          report("script:done", { result: results.script });
          report("stdin:start");
          results.stdin = await reset.run({ lang: "shell", code: "cat", stdin: "stdin-ok\\n", files: {}, timeoutMs: 10_000 });
          report("stdin:done", { result: results.stdin });
          report("nonzero:start");
          results.nonzero = await reset.run({ lang: "shell", code: "printf out; printf err >&2; exit 7", stdin: "", files: {}, timeoutMs: 10_000 });
          report("nonzero:done", { result: results.nonzero });
          report("goals:start");
          await reset.run({ lang: "shell", code: "touch dynamic.txt; echo 'CQ{goal}' > goal.txt", stdin: "", files: {}, timeoutMs: 10_000 });
          const goals = [
            { id: "file", text: "dynamic", check: { kind: "file-exists", path: "/home/student/dynamic.txt" } },
            { id: "cmd", text: "goal", check: { kind: "command-stdout", command: "cat /home/student/goal.txt", expect: "CQ{goal}" + String.fromCharCode(10) } },
          ];
          const present = await reset.run({ lang: "shell", code: buildContainerGoalCheckScript(goals), stdin: "", files: {}, timeoutMs: 5000 });
          await reset.run({ lang: "shell", code: "rm -f dynamic.txt goal.txt", stdin: "", files: {}, timeoutMs: 10_000 });
          const missing = await reset.run({ lang: "shell", code: buildContainerGoalCheckScript(goals), stdin: "", files: {}, timeoutMs: 5000 });
          results.goals = { present: parseContainerGoalChecks(goals, present.stdout), missing: parseContainerGoalChecks(goals, missing.stdout) };
          report("goals:done", { result: results.goals });
          report("timeout:start");
          results.timeout = await reset.run({ lang: "shell", code: "trap '' INT TERM; while :; do sleep 1; done", stdin: "", files: {}, timeoutMs: 3000 });
          report("timeout:done", { result: results.timeout });
          report("after-timeout:start");
          results.afterTimeout = await reset.run({ lang: "shell", code: "echo AFTER_TIMEOUT", stdin: "", files: {}, timeoutMs: 5000 });
          report("after-timeout:done", { result: results.afterTimeout });
          report("background:start");
          await reset.run({ lang: "shell", code: "(sleep 2; echo OLD) & echo FIRST", stdin: "", files: {}, timeoutMs: 10_000 });
          results.backgroundSecond = await reset.run({ lang: "shell", code: "sleep 3; echo SECOND", stdin: "", files: {}, timeoutMs: 10_000 });
          report("background:done", { result: results.backgroundSecond });
          report("limit:start");
          results.limit = await reset.run({ lang: "shell", code: "yes x | head -c 2097152", stdin: "", files: {}, timeoutMs: 10_000 });
          report("limit:done", { bytes: results.limit.stdout.length, exitCode: results.limit.exitCode });
        } finally { report("reset:close"); reset.close(); }

        report("interactive:open:start");
        const interactive = await openContainerSession({ "/home/student/secret.txt": "CQ{interactive-one}\\n" });
        report("interactive:open:done");
        const writer = interactive.stdio.stdin.getWriter();
        const reader = interactive.stdio.stdout.getReader();
        const decoder = new TextDecoder();
        let output = "";
        try {
          await writer.write(new TextEncoder().encode("cat secret.txt; echo CQ_INTERACTIVE_DONE\\n"));
          report("interactive:sent");
          while (!/(?:\\r?\\n)CQ_INTERACTIVE_DONE(?:\\r?\\n)/.test(output)) {
            const { done, value } = await reader.read();
            if (done) throw new Error("interactive stdout closed");
            output += decoder.decode(value, { stream: true });
            report("interactive:chunk", { text: output.slice(-200) });
          }
          results.interactive = { stdout: output, stderr: "", exitCode: 0, logs: [] };
        } finally {
          report("interactive:close");
          interactive.close(writer, { stdout: reader });
          try { await reader.cancel(); } catch {}
        }
        return results;
      };`,
    resolveDir: process.cwd(), loader: "js",
  },
  bundle: true, format: "esm", platform: "browser", outfile: `${tmp}/runner.mjs`,
});
const runner = await readFile(`${tmp}/runner.mjs`, "utf8");
const { vmWorker, ringWorker, vendorFiles } = await loadC2wBrowserWorkerAssets(process.cwd(), { totalBytes: (await stat(wasm)).size });
const html = `<!doctype html><html><body><pre id="status">starting</pre><script type="module">
import "/runner.mjs";
const status = document.getElementById("status");
const timer = setTimeout(async () => {
  status.textContent = "TIMEOUT";
  await fetch("/done", { method: "POST", body: JSON.stringify({ ok: false, timeout: true }) });
}, ${timeoutMs});
try {
  const result = await window.runShellChecks();
  clearTimeout(timer); status.textContent = "DONE";
  await fetch("/done", { method: "POST", body: JSON.stringify({ ok: true, result }) });
} catch (error) {
  clearTimeout(timer); status.textContent = "ERROR " + error;
  await fetch("/done", { method: "POST", body: JSON.stringify({ ok: false, error: String(error), stack: String(error?.stack ?? error) }) });
}
</script></body></html>`;

let finish;
const done = new Promise((resolveDone) => { finish = resolveDone; });
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
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
  if (url === "/vm-worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(vmWorker); return; }
  if (url === "/ring-buffer-worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(ringWorker); return; }
  const vendor = vendorFiles.get(url);
  if (vendor) { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); res.end(vendor); return; }
  if (url === "/runtime/cq-minimal.wasm" || url === "/runtime/cq-dev-shell.wasm") {
    res.writeHead(200, { ...headers, "Content-Type": "application/wasm", "Content-Length": (await stat(wasm)).size });
    res.end(await readFile(wasm)); return;
  }
  res.writeHead(404); res.end();
});
await new Promise((resolveReady) => server.listen(port, "127.0.0.1", resolveReady));
console.log("SHELL_CONTAINER_TEST_READY");
const { rmSync } = await import("node:fs");
const profile = `${tmp}/profile-${process.pid}`;
rmSync(profile, { recursive: true, force: true });
const chromium = !/firefox/i.test(browserBin);
const browser = spawn(browserBin, [
  ...(chromium
    ? ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions", `--user-data-dir=${profile}`]
    : ["--headless", "--user-data-dir", profile]),
  `http://127.0.0.1:${port}/`,
], { stdio: ["ignore", "inherit", "inherit"], detached: true });
browser.on("exit", (code, signal) => finish(JSON.stringify({ ok: false, browserExit: code, signal })));
const timer = setTimeout(() => finish(JSON.stringify({ ok: false, timeout: true, timeoutMs })), timeoutMs);
const raw = await done;
clearTimeout(timer);
try { process.kill(-browser.pid, "SIGTERM"); } catch { browser.kill("SIGTERM"); }
server.close();
console.log("RESULT " + raw);
const parsed = JSON.parse(raw);
if (!parsed.ok) process.exit(1);
const r = parsed.result;
const checks = {
  bandit: r.bandit?.stdout.includes("CQ{bandit-one}"),
  write: r.write?.exitCode === 0,
  persist: r.persist?.stdout === "persisted\n",
  reset: r.reset?.exitCode === 0,
  script: r.script?.stdout === "      1 a\n      2 b\n",
  stdin: r.stdin?.stdout === "stdin-ok\n",
  nonzero: r.nonzero?.stdout === "out" && r.nonzero?.stderr === "err" && r.nonzero?.exitCode === 7,
  goals: r.goals?.present?.file === true && r.goals?.present?.cmd === true && r.goals?.missing?.file === false && r.goals?.missing?.cmd === false,
  timeout: r.timeout?.exitCode === 124 && r.timeout?.stderr.includes("超过"),
  afterTimeout: r.afterTimeout?.stdout === "AFTER_TIMEOUT\n",
  background: r.backgroundSecond?.stdout === "SECOND\n",
  limit: r.limit?.stdout.length > 0 && r.limit?.stdout.length <= 1024 * 1024,
  interactive: r.interactive?.stdout.includes("CQ{interactive-one}"),
};
await writeFile("docs/shell-container-result.json", JSON.stringify({ ...parsed, checks, browser: browserBin, at: new Date().toISOString() }, null, 2) + "\n");
console.log("CHECKS " + JSON.stringify(checks));
process.exit(Object.values(checks).every(Boolean) ? 0 : 2);
