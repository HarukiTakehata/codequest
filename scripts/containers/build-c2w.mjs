#!/usr/bin/env node
// 将语言开发镜像转换为 container2wasm WASM，并生成 gzip 工件与浏览器清单。
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES, resolveLanguage } from "./config.mjs";
import { buildLanguageContainer, run } from "./common.mjs";

const root = resolve(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const here = dirname(fileURLToPath(import.meta.url));
const c2wDir = "/tmp/opencode/c2w-v0.8.5";
const c2w = process.env.C2W_BIN ?? resolve(c2wDir, "c2w");
const tarball = resolve(c2wDir, "container2wasm.tar.gz");
const expectedSha = "95112619c1d9dd61d2b1000ac5695e935ec05c100f6a854c093e0f3c875908f4";

function sha256(file) {
  const result = spawnSync("sha256sum", [file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`sha256sum ${file} 失败`);
  return result.stdout.trim().split(/\s+/)[0];
}

function ensureC2w() {
  if (existsSync(c2w)) return;
  mkdirSync(c2wDir, { recursive: true });
  run("curl", ["-fL", "--retry", "3", "https://gh-proxy.org/https://github.com/container2wasm/container2wasm/releases/download/v0.8.5/container2wasm-v0.8.5-linux-amd64.tar.gz", "-o", tarball]);
  if (sha256(tarball) !== expectedSha) throw new Error("c2w 下载校验失败");
  run("tar", ["-xzf", tarball, "-C", c2wDir]);
}

function parseArgs(argv) {
  const options = { build: true, packOnly: false, language: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--no-build") options.build = false;
    else if (arg === "--pack-only") options.packOnly = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (!arg.startsWith("--")) options.language = arg;
    else throw new Error(`未知参数: ${arg}`);
  }
  return options;
}

function updateManifest() {
  const items = LANGUAGES.map((language) => {
    const file = resolve(root, `runtime/cq-dev-${language.id}.wasm.gz`);
    return {
      id: language.id,
      name: language.name,
      image: language.image,
      bytes: existsSync(file) ? statSync(file).size : 0,
      sha256: existsSync(file) ? sha256(file) : "",
    };
  });
  const json = JSON.stringify(items, null, 2) + "\n";
  writeFileSync(resolve(root, "runtime/container-environments.json"), json);
  writeFileSync(resolve(root, "apps/web/public/container-environments.json"), json);
  return items;
}

async function convert(language, options) {
  if (options.build) buildLanguageContainer(language.id, { test: true });
  const raw = `/tmp/opencode/cq-dev-${language.id}.wasm`;
  if (!options.packOnly) {
    const command = [
      "--builder", resolve(here, "c2w-podman-shim"),
      "--dockerfile", resolve(here, "Containerfile.c2w"),
      "--target-arch", "amd64",
      "--build-arg", `VM_MEMORY_SIZE_MB=${language.memoryMb}`,
      "--extra-flag=--security-opt=label=disable",
      language.image,
      raw,
    ];
    let converted = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        run(c2w, command);
        converted = true;
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        console.warn(`${language.id} c2w 转换第 ${attempt} 次失败，重试（复用 Podman 缓存）`);
      }
    }
    if (!converted) throw new Error(`${language.id} c2w 转换失败`);
  }
  const gzip = resolve(root, `runtime/cq-dev-${language.id}.wasm.gz`);
  const temporary = `${gzip}.tmp`;
  const output = openSync(temporary, "w");
  try {
    const result = spawnSync("gzip", ["-9", "-c", raw], { stdio: ["ignore", output, "inherit"] });
    if (result.status !== 0) throw new Error(`gzip ${language.id} 失败`);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* 临时文件可能尚未创建 */ }
    throw error;
  } finally {
    closeSync(output);
  }
  try {
    run("gzip", ["-t", temporary]);
    renameSync(temporary, gzip);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* 临时文件可能已发布 */ }
    throw error;
  }
  console.log(`转换完成: ${language.id} -> ${gzip} (${statSync(gzip).size} bytes)`);
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log("用法: node scripts/containers/build-c2w.mjs <shell|cpp|java|python|javascript|all> [--no-build] [--pack-only]");
  process.exit(0);
}
try {
  ensureC2w();
  run(process.execPath, [resolve(here, "prepare-c2w-dockerfile.mjs")], { env: { ...process.env, C2W_BIN: c2w } });
  const selected = !options.language || options.language === "all" ? LANGUAGES : [resolveLanguage(options.language)];
  for (const language of selected) {
    await convert(language, options);
    updateManifest();
  }
  const manifest = updateManifest();
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
