#!/usr/bin/env node
// 验收 cq-minimal:cn 根文件系统：文件/文本处理、进程、容器内 loopback 监听。
// 用法: node scripts/test-minimal-rootfs.mjs [镜像名]
import { spawnSync } from "node:child_process";

const image = process.argv[2] ?? "cq-minimal:cn";
const checks = [
  {
    name: "shell 与基础命令",
    script: 'echo hello && pwd && test -x /bin/busybox && echo BASIC_OK',
    expect: "BASIC_OK",
  },
  {
    name: "文件读写与查找",
    script: 'mkdir -p /tmp/t/aa && echo token > /tmp/t/aa/flag.txt && cat /tmp/t/aa/flag.txt && find /tmp/t -name "flag*" && stat /tmp/t/aa/flag.txt | head -2 && echo FILE_OK',
    expect: "FILE_OK",
  },
  {
    name: "文本处理（grep/sort/uniq/wc/awk/tr/cut）",
    script: 'printf "b\\na\\nb\\n" > /tmp/words && cat /tmp/words | sort | uniq -c && grep -c b /tmp/words && cat /tmp/words | wc -l && cat /tmp/words | tr a A && echo TEXT_OK',
    expect: "TEXT_OK",
  },
  {
    name: "进程检查（ps/pgrep/pidof）",
    script: 'sleep 30 & pid=$!; ps | grep -q sleep && pgrep sleep >/dev/null && pidof sleep >/dev/null && kill $pid && echo PROC_OK',
    expect: "PROC_OK",
  },
  {
    name: "容器内 loopback 监听（nc -l + netstat）",
    script: 'nc -l -p 8080 127.0.0.1 >/dev/null 2>&1 & sleep 1; netstat -ltn | grep -E "127\\.0\\.0\\.1:8080|0\\.0\\.0\\.0:8080" && echo LOOPBACK_OK',
    expect: "LOOPBACK_OK",
  },
];

let failed = 0;
for (const check of checks) {
  const result = spawnSync("podman", [
    "run", "--rm", "--security-opt", "label=disable", "--network", "none",
    "--entrypoint", "/bin/sh", image, "-c", check.script,
  ], { encoding: "utf8", timeout: 60_000 });
  const output = (result.stdout + result.stderr).trim();
  const ok = result.status === 0 && output.includes(check.expect);
  console.log(`${ok ? "PASS" : "FAIL"} ${check.name}`);
  if (!ok) {
    failed++;
    console.log("  exit: " + result.status);
    console.log("  output: " + output.slice(-800));
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
