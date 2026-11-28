#!/usr/bin/env node
// Real-browser smoke for the RPGJS module Worker loaded through Vite.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.CQ_RPGJS_BROWSER_PORT ?? 5178);
const origin = `http://127.0.0.1:${port}`;
const executablePath = process.env.C2W_BROWSER ?? process.env.CHROMIUM_PATH ?? "/usr/bin/microsoft-edge";
const server = spawn(process.execPath, [
  resolve(repositoryRoot, "node_modules/vite/bin/vite.js"),
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], {
  cwd: resolve(repositoryRoot, "apps/web"),
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite 提前退出：${serverOutput}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Vite 启动超时：${serverOutput}`);
}

let browser;
try {
  await waitForServer();
  const clientPath = resolve(repositoryRoot, "packages/rpgjs-script/src/client.ts");
  const clientUrl = `/@fs${encodeURI(clientPath)}`;
  const warmupDeadline = Date.now() + 30_000;
  while (true) {
    try {
      const response = await fetch(`${origin}${clientUrl}`);
      const text = await response.text();
      if (response.ok && text.includes("runScript")) break;
    } catch {
      // Vite may still be optimizing dependencies.
    }
    if (Date.now() >= warmupDeadline) throw new Error("Vite 客户端模块预热超时");
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }

  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/__rpgjs_worker_smoke__", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><head><title>RPGJS Worker smoke</title></head><body></body></html>",
  }));
  await page.goto(`${origin}/__rpgjs_worker_smoke__`, { waitUntil: "domcontentloaded" });

  const report = await page.evaluate(async ({ url }) => {
    const { runScript } = await import(url);
    return runScript({
      source: `export function move() {
        game.player.move("up", 4);
        $player.gold -= 5;
        return $player.gold;
      }`,
      init: { seed: 7, player: { gold: 10 } },
      cases: [{
        id: "move4",
        name: "向上移动四步",
        call: { fn: "move" },
        expect: {
          "effect:player.moveRoutes:args.0.0.up": 4,
          "player.gold": 5,
          returns: 5,
        },
      }],
      timeoutMs: 10_000,
    });
  }, { url: clientUrl });

  if (!report.ok || !report.passed || report.score !== 100) {
    throw new Error(`浏览器 Worker 判题失败：${JSON.stringify(report)}`);
  }
  const effect = report.results?.[0]?.result?.effects?.[0];
  if (effect?.name !== "player.moveRoutes" || effect?.params?.args?.[0]?.[0]?.up !== 4) {
    throw new Error(`浏览器 Worker 效果参数不正确：${JSON.stringify(effect)}`);
  }
  if (pageErrors.length) throw new Error(`浏览器运行时错误：${pageErrors.join("; ")}`);
  console.log("RPGJS_WORKER_BROWSER_PASS", JSON.stringify({
    score: report.score,
    gold: report.results[0].result.state.player.gold,
    effect: effect.name,
    up: effect.params.args[0][0].up,
  }));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
