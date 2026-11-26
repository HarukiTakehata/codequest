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

- `packages/runtime-shell/src/container-runtime.ts` 是唯一 Shell 运行时：交互 xterm 会话与自动判题会话都直接使用 container2wasm。
- 进入 Shell 题目或自由模式 Shell 标签时立即启动常驻容器；运行/测试点复用同一会话；手动重置关闭旧容器再开新容器；退出发送 `exit` 销毁。
- 初始 `presetFiles` 与 stdin 在容器内通过 `/bin/busybox base64` 真实写入；自动会话用 `/bin/busybox stty -echo` 与结果标记回收 stdout/stderr。
- `TerminalWorkbench` 是 xterm 字节流，不解析命令；`Workbench` / `FreeMode` 的 Shell 运行走 `openAutomatedContainerSession()`。
- 已删除 TS 模拟 shell、wasi-sh、旧 rootfs 快照与临时 xterm harness。

## 4. 前端红线

- 不使用 emoji/文字符号图标：统一 `lucide-react`。守卫测试 `tests/frontend/no-emoji.test.ts`。
- Pyodide worker 是 ES module，**禁止 `importScripts`**；工件已本地化到 `apps/web/public/pyodide/`，
  用 `await import(${PYODIDE_BASE}pyodide.mjs)` + `loadPyodide({ indexURL })`，不依赖 CDN。
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
   - `mkisofs` 在 Alpine 不存在，用 `xorriso`；`gettext-base` 用 `gettext`。
   - tini：补 `#include <libgen.h>`、去掉 CMakeLists 里的 `-Werror`、`CC="gcc -static -Wno-error"`。
   - Bochs/vmtouch 里的 `CC="x86_64-linux-gnu-gcc"` 改为 `gcc`；vmtouch 只 `make vmtouch`（避免 pod2man）。
   - GNU 源码镜像用阿里云 `https://mirrors.aliyun.com/gnu/`（ftp.gnu.org 约 10KB/s，USTC 容器内 403）；
     Alpine apk 在 c2w 构建内也用阿里云（清华在容器内 403）。
   - 实测 Alpine 化 127 步可完成：`cq-minimal-alpine.wasm` 98MB，`EXIT=0`。
5. 每失败一层只改该层，podman 会复用之前缓存；不要从头重跑所有层。
6. 浏览器 spike：`@webvirt/c2w` 用 `import.meta.url` 定位 worker，esbuild 必须打成 **ESM** 而非 IIFE，
   并同时提供 `vm-worker.js` / `ring-buffer-worker.js`；页面需 COOP/COEP 以使用 SharedArrayBuffer。
5. 产物后在真实容器跑 `scripts/test-minimal-rootfs.mjs` 的 loopback 项；浏览器侧 spike 用
   `scripts/spike-loopback.mjs`（需 COOP/COEP 与 headless Firefox）。
6. 若冷启动仍超交互教学可接受范围，记录结论，不把容器会话放进 v1 主链路（设计书 §5.5 降级条款）。

## 6. 验证与提交

- 全量：`npm test`、`npm run typecheck`、`npm run build`、`npm run validate:course`。
- 本地库重置：`npm run db:reset`（只删本地 D1，带 `--yes`，绝不 `--remote`）。
- 提交在 `dev` 分支；署名 `Haruki Takehata <haruki-takehata@yang-qwq.top>`；
  commit message 末尾加 `🤖 自动提交：Hermes Agent`；本机 gpg 签名超时时用 `-c commit.gpgsign=false`。
- 上游 WebGAL 改动只在 fork（`HarukiTakehata/WebGAL`），不要改主仓库第三方目录（AGENTS.md #1）。

## 7. Container Shell 已启用（2026-11-26）

用户要求重新启用入口。`apps/web/src/features.ts` 的 `CONTAINER_SHELL_ENABLED = true`，
课程列表与路由同时受该开关控制。当前使用禁网模式；关闭入口时只改回 `false`，
不要删除 worker patch、同版本 shim、entrypoint 或 marker 修复。

### 已解决的技术障碍（维护务必先看）

1. **Workers Assets 单文件 25MiB 上限**：c2w wasm 不能放 `public/`。运行时统一使用
   `runtime/cq-dev-<lang>.wasm.gz`（Shell 当前 58MB），由 R2 路由返回
   `application/wasm` + `Content-Encoding: gzip`；旧 `cq-minimal` 兼容工件与路由已移除。
   上传命令 `npm run runtime:upload`（本地）/ `npm run runtime:upload:remote`（线上）。
2. **Vite 把 c2w worker 内联成 data URL**，其中裸 `from "comlink"` 在 module worker 无法解析，
   `createContainer()` 永久挂起且不报错：设置 `build.assetsInlineLimit = 0`，
   并由 `scripts/patch-c2w-workers.mjs` 把 `comlink` / `@bjorn3/browser_wasi_shim`
   改写到 `/vendor/...`（已接入 `npm run build:web`）。
3. **gzip magic 错误**：worker 的 `fetch()` 不会替 `instantiateStreaming` 解压；
   patch 脚本在 `fetchFile` 中用 `DecompressionStream("gzip")` 解压后再交给 wasm 实例化。
4. **Vite dev 代理**：`vite.config.ts` 必须代理 `/runtime` 到 `http://localhost:8787`，否则 wasm 请求落到 SPA fallback。
5. **跨源隔离**：`_headers`、vite `server/preview.headers`、R2 路由都要带 COOP/COEP/CORP；
   否则 `createContainer()` 在 `new SharedArrayBuffer` 阶段就失败（早于任何 wasm 请求）。
6. **DHCP 假死**：`@webvirt/c2w@0.1.0` 无条件传 `--net socket`，guest 跑 `udhcpc`；没有
   `container.net` 对端时永远等不到响应。`scripts/c2w-browser-assets.mjs` 默认移除网络参数。
7. **entrypoint 重复**：镜像已是 `ENTRYPOINT ["/bin/sh"]`；一次性命令必须传
   `entrypoint: "/bin/sh"` + `command: ["-c", "..."]`，交互 shell 只传 entrypoint。
8. **stdout 没有 EOF**：ring buffer 退出时不关闭；一次性 harness 必须以 marker / `onExit`
   完成，不能 `for await` 等 `done`。
9. **下载进度**：浏览器 JS 读不到 `Content-Length`；构建脚本把 gzip 工件大小注入 vm-worker，
   worker 通过 `BroadcastChannel("codequest-c2w-progress")` 按约 1% 步长上报，页面左下角显示
   百分比，传输完成后切换为启动滚动条。

### 实测性能（2026-11-26，浏览器端到端）

```
Firefox 160：createContainer 返回 103ms，首个 stdout 1927ms，marker 约 2.02s
Edge 158：    createContainer 返回 71ms，首个 stdout 2019ms，marker 约 2.13s
输出：CQ_READY / 407 / CQ_DIAG_DONE
新 Shell 工件（158,826,186 字节 raw / 59,341,603 字节 gzip）Edge 冒烟约 2.2s，
git/vim/nano/bash/sort/find/ps/ss/ip 与 CQ_ENV_DONE 均通过。五种语言 c2w 工件均已生成并浏览器冒烟。
```

旧版 300s / 900s “冷启动不可接受”结论来自失效 harness（worker 裸导入 + DHCP 无对端），
不是 Bochs 固有启动时间。复现命令见 `scripts/spike-loopback.mjs` 与 `docs/spike-M3-M4.md`。

### 明确未验证

- 浏览器内真实 `vi` 交互是否可用（c2w 内有 vi，但尚未做键盘序列 E2E）。
- 外网：当前默认禁网；需要外网必须先实现 `container.net` / `c2w-net-proxy`。
- 模拟内核 loopback 已通过：`0.0.0.0:8080 LISTEN`，见 `docs/spike-loopback-result.json`。

## 8. 语言开发容器

- 构建选择器：`npm run container`（交互）或 `node scripts/build-language-container.mjs all --test`。
- 五个镜像：`cq-dev-shell:cn`、`cq-dev-cpp:cn`、`cq-dev-java:cn`、`cq-dev-python:cn`、
  `cq-dev-javascript:cn`；全部基于 Alpine 3.22 并包含 git/vim/nano，Shell 另含 procps/iproute2。
- c2w 转换：`npm run container:c2w -- all --no-build`；产物为 `runtime/cq-dev-<lang>.wasm.gz`。
- 浏览器验证：`node scripts/test-c2w-environment.mjs <lang> /tmp/opencode/cq-dev-<lang>.wasm`。
- Shell 完整 E2E：`node scripts/test-shell-container.mjs /tmp/opencode/cq-dev-shell.wasm /opt/microsoft/msedge/msedge`，
  覆盖会话持久/重置/stdin/交互终端/非零退出/动态 goals/超时恢复/后台输出隔离/1 MiB 上限。
- 上传：`npm run runtime:upload` 会自动校验清单大小与 SHA-256，再上传所有 `runtime/cq-dev-*.wasm.gz`。
- Web 选择器读取 `apps/web/public/container-environments.json`，切换环境后重启 c2w 会话。
- 选择器 E2E：`C2W_BROWSER=/opt/microsoft/msedge/msedge node scripts/test-container-selector.mjs`，
  验证首屏新 Shell 工件、五种选项启用、切换 JavaScript 工件与提示符恢复。
- R2 路由 E2E：先 `npm run dev`，再 `C2W_BROWSER=/opt/microsoft/msedge/msedge node scripts/test-r2-runtime.mjs`，
  校验浏览器收到的 gzip 大小/SHA-256 与清单一致、worker 解压后为 WASM magic。
- 已知边界：`@webvirt/c2w@0.1.0` 未暴露 Worker `terminate()`；当前关闭会取消 reader/writer，但强制 Worker 回收仍需上游 fork。

## 9. 关键文档

- `docs/实现说明.md`：实现状态与验收证据。
- `docs/任务状态.md`：已完成 / 进行中 / 未开始。
- `docs/spike-M3-M4.md`：M3/M4 spike 与耗时结论。
- `docs/Container-Shell.md`、`docs/自由模式.md`、`docs/课程包格式.md`。
