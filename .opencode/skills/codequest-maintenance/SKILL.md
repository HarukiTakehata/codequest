---
name: CodeQuest 维护
description: 维护 CodeQuest 最小容器镜像、Container Shell、运行时 Worker 与国内镜像源构建流程；用于镜像重建、rootfs 验收、前端接入和 container2wasm 重试
---

# CodeQuest 维护流程

本 skill 记录第一版最小可用项目中反复用到的可复现维护步骤。所有命令在仓库根目录执行。

## 1. 最小镜像（cn 版，无 Ubuntu）

脚本：`scripts/build-minimal-shell-cn.mjs`

- GitHub 源码一律走 `https://gh-proxy.org/https://github.com/...`（git clone 与 release/curl 下载）。
- Alpine apk 源一律换清华：`https://mirrors.tuna.tsinghua.edu.cn/alpine`（`sed -i` 改 `/etc/apk/repositories`，构建容器与 build.sh 两层都改）。
- Alpine 基础镜像从 `docker.1ms.run/library/alpine:3.22` 拉取后 tag 为 `docker.io/library/alpine:3.22`。
- BusyBox 1.38.0（mirror 为 `busybox_mirror-1_38_0`）：`make defconfig` 后直接改 `.config`
  （该版本**没有** `scripts/config` 脚本），`scripts/config --enable` 会报 not found。
- 必须禁用 `CONFIG_TC`：新内核头缺 CBQ 宏，`networking/tc.c` 编译失败。
- 静态链接用 `CONFIG_STATIC=y` 写进 `.config`，再 `yes '' | make oldconfig && make -j$(nproc)`。
- `podman cp` 到已存在目录必须写 `:/out/rootfs/.`，否则嵌套成 `rootfs/rootfs`，新文件进不了镜像。
- 产物：`/tmp/cq-minimal-cn/rootfs`（约 1.2MB，407 applet，`vi` 可用）与 `cq-minimal:cn`（`FROM scratch`）。
- 重跑：`node scripts/build-minimal-shell-cn.mjs`（podman 层缓存会复用 apk 与编译层）。

## 2. rootfs 验收

`node scripts/test-minimal-rootfs.mjs [image]`，默认 `cq-minimal:cn`：

1. shell 与基础命令；2. 文件读写与查找；3. 文本处理；4. 进程（需要 `sleep`/`pidof` 符号链接）；
5. 容器内 `nc -l -p 8080 127.0.0.1` + `netstat -ltn`。

失败时先看 `/tmp/opencode/busybox-debug/make.log` 与容器内 `busybox --list`，不要盲目重试。

## 3. 前端 Container Shell 接入

- 快照资产：`apps/web/public/container-shell/rootfs.json`、`applets.json`（由容器导出）。
- `packages/runtime-shell/src/session-client.ts`：`spawn()` 常驻 wasi-sh 会话，`onOutput` 渲染字节流，
  `write()` 发送命令；文件与 `vi` 编辑在同一 Worker 会话内保持。`reset` 用 terminate + 重新 spawn。
- 组件：`apps/web/src/components/ContainerShell.tsx`，从课程列表独立入口进入，不绑定剧情/判题。
- 判题仍用 `runWasiSh()` 逐命令路径，与交互会话互不干扰。
- 这是「rootfs 快照 + wasi-sh busybox wasm」快速路径，**不是** container2wasm 模拟内核。

## 4. 前端红线

- 不使用 emoji/文字符号图标：统一 `lucide-react`。守卫测试 `tests/frontend/no-emoji.test.ts`。
- Pyodide worker 是 ES module，**禁止 `importScripts`**；用 `await import(${PYODIDE_CDN}pyodide.mjs)`。
  守卫测试 `tests/frontend/pyodide-worker.test.ts`。
- 用户代码只在 Worker/WASM 内执行；主线程不得 `eval` 或跑用户代码（AGENTS.md #4）。
- Monaco worker 接线用 `worker: { format: "es" }`（vite.config.ts），否则 IIFE + code splitting 会构建失败。

## 5. container2wasm 重试思路（按最小镜像路线）

之前 c2w 用内置 127 步 Ubuntu Dockerfile 可跑通（`cq-teaching.wasm` 109MB，`EXIT=0`），
但冷启动被判定为生产问题。重试时按以下顺序：

1. **放弃 Ubuntu**：使用 `c2w --dockerfile <自定义>` 提供基于 `scratch` / Alpine 的最小 Dockerfile，
   输入镜像用 `cq-minimal:cn`，不要走内置 ubuntu:22.04 / ubuntu:latest 阶段。
2. 网络：镜像 `docker.1ms.run`；GitHub git clone/release 走 `gh-proxy.org`；Go modules 走 `goproxy.cn`。
3. rootless podman：`mknod` 不可用，用 `touch` 降级；必要时 `--security-opt label=disable`。
4. 先用 `c2w --show-dockerfile` 导出模板做基线，逐段替换镜像来源；每改一层利用 podman 缓存继续。
   Alpine 化替换表（已实测）：
   - `FROM ubuntu*` / `FROM ubuntu:22.04` → `FROM docker.io/library/alpine:3.22`，并在每个 Alpine
     FROM 后 `sed -i 's|dl-cdn.alpinelinux.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apk/repositories`。
   - `apt-get install -y` → `apk add --no-cache`；`build-essential` → `build-base`，
     `linux-libc-dev-*-cross` → `linux-headers`，`gcc-*-linux-gnu` → `gcc`，
     `libc-dev-*-cross` → `musl-dev`，`libelf-dev` → `elfutils-dev`。
   - 所有 `git clone` 前加 `-c url."https://gh-proxy.org/https://github.com/".insteadOf="https://github.com/"`。
   - 内核/busybox 编译阶段必须补 `musl-dev linux-headers make gcc`，并移除 Ubuntu 风格
     `CROSS_COMPILE=x86_64-linux-gnu-`（Alpine/musl 原生工具链不需要）。
   - busybox `make defconfig` 后禁用 `CONFIG_TC`（新版内核头缺 CBQ 宏），否则 `networking/tc.c` 编译失败。
5. 每失败一层只改该层，podman 会复用之前缓存；不要从头重跑所有层。
5. 产物后在真实容器跑 `scripts/test-minimal-rootfs.mjs` 的 loopback 项；浏览器侧 spike 用
   `scripts/spike-loopback.mjs`（需 COOP/COEP 与 headless Firefox）。
6. 若冷启动仍超交互教学可接受范围，记录结论，不把容器会话放进 v1 主链路（设计书 §5.5 降级条款）。

## 6. 验证与提交

- 全量：`npm test`、`npm run typecheck`、`npm run build`、`npm run validate:course`。
- 本地库重置：`npm run db:reset`（只删本地 D1，带 `--yes`，绝不 `--remote`）。
- 提交在 `dev` 分支；署名 `Haruki Takehata <haruki-takehata@yang-qwq.top>`；
  commit message 末尾加 `🤖 自动提交：Hermes Agent`；本机 gpg 签名超时时用 `-c commit.gpgsign=false`。
- 上游 WebGAL 改动只在 fork（`HarukiTakehata/WebGAL`），不要改主仓库第三方目录（AGENTS.md #1）。

## 7. 关键文档

- `docs/实现说明.md`：实现状态与验收证据。
- `docs/任务状态.md`：已完成 / 进行中 / 未开始。
- `docs/spike-M3-M4.md`：M3/M4 spike 与耗时结论。
- `docs/Container-Shell.md`、`docs/自由模式.md`、`docs/课程包格式.md`。
