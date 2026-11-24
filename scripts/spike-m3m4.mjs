#!/usr/bin/env node
// M3/M4 可行性 spike（设计书 v0.3 §8）：记录本机能否拿到 wasm-clang / container2wasm 工件。
// 只读探测，不改第三方仓库；结果写入 docs/spike-M3-M4.md 的证据表。
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60_000 });
  return { status: r.status, out: String((r.stdout ?? "") + (r.stderr ?? "")).trim().slice(0, 500) };
};

const tools = ["docker", "podman", "c2w", "clang", "clang++", "wasm-ld", "zig", "go", "git"];
console.log("TOOL AVAILABILITY");
for (const tool of tools) {
  const r = run(tool, ["--version"]);
  console.log(`  ${tool.padEnd(10)} ${r.status === 0 ? "OK" : "MISSING"} ${r.status === 0 ? r.out.split("\n")[0] : ""}`);
}

console.log("NETWORK (upstream artifact sources)");
for (const url of [
  "https://raw.githubusercontent.com/binji/wasm-clang/master/README.md",
  "https://github.com/container2wasm/container2wasm",
]) {
  const r = run("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-L", "--max-time", "10", url]);
  console.log(`  ${url} -> ${r.out || "unreachable"}`);
}

console.log("NPM PACKAGES");
for (const name of ["wasm-clang", "clang-wasm", "@bjorn3/browser_wasi_shim"]) {
  const r = run("npm", ["--registry", "https://registry.npmmirror.com", "view", name, "version"]);
  console.log(`  ${name.padEnd(26)} ${r.status === 0 ? r.out : "not published"}`);
}

console.log("LOCAL DOWNLOAD CACHE");
for (const path of ["/home/yang/文档/WebGAL", "/home/yang/文档/WebGAL_Terre"]) {
  try {
    console.log(`  ${path} ${statSync(path).isDirectory() ? "present" : "absent"}`);
  } catch { console.log(`  ${path} absent`); }
}
