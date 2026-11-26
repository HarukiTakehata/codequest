#!/usr/bin/env node
// 在真实浏览器中验证 R2 运行时路由：gzip 字节数/SHA-256 与清单一致，worker 解压后为 WASM。
// 先启动 npm run dev，再运行: C2W_BROWSER=/opt/microsoft/msedge/msedge node scripts/test-r2-runtime.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.C2W_R2_URL ?? "http://127.0.0.1:8787";
const browserBin = process.env.C2W_BROWSER ?? "/opt/microsoft/msedge/msedge";
const item = JSON.parse(readFileSync(resolve("runtime/container-environments.json"), "utf8"))
  .find((entry) => entry.id === "shell");
if (!item) throw new Error("清单缺少 Shell 工件");
const browser = await chromium.launch({ executablePath: browserBin, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async ({ expectedBytes, expectedSha }) => {
    const response = await fetch(`/runtime/cq-dev-shell.wasm?env=shell&bytes=${expectedBytes}&v=${expectedSha.slice(0, 12)}&requestId=shell`);
    const fetched = await response.arrayBuffer();
    const digest = async (buffer) => {
      const hash = await crypto.subtle.digest("SHA-256", buffer);
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const fetchedSha = await digest(fetched);
    let final = fetched;
    if (response.headers.get("content-encoding")?.includes("gzip") && fetched.byteLength > 0) {
      final = await new Response(new Blob([fetched]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    }
    return {
      status: response.status,
      encoding: response.headers.get("content-encoding"),
      fetchedBytes: fetched.byteLength,
      fetchedSha,
      finalBytes: final.byteLength,
      finalMagic: [...new Uint8Array(final).slice(0, 4)],
    };
  }, { expectedBytes: item.bytes, expectedSha: item.sha256 });
  const checks = {
    http200: result.status === 200,
    bytesMatch: result.fetchedBytes === item.bytes,
    shaMatch: result.fetchedSha === item.sha256,
    wasmMagic: result.finalMagic.join(",") === "0,97,115,109",
  };
  const report = { ...result, checks, browser: browserBin, at: new Date().toISOString() };
  console.log(JSON.stringify(report, null, 2));
  await writeFile("docs/runtime-r2-result.json", JSON.stringify(report, null, 2) + "\n");
  process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
} finally {
  await browser.close();
}
