---
name: CodeQuest 维护
description: 维护 CodeQuest 学习端、Container Shell、五语言运行时 Worker、R2 工件与国内镜像源构建流程；用于本地验收、镜像重建、c2w 转换和浏览器端到端测试
---

# CodeQuest 维护流程

本 skill 记录当前实现的可复现维护步骤。所有命令在仓库根目录执行，要求 Node.js >= 22.12.0；依赖安装统一使用 `npm --registry https://registry.npmmirror.com`。

## 1. 本地开发与基础验收

```bash
npm install --registry https://registry.npmmirror.com
cp .dev.vars.example .dev.vars   # 填入 TOKEN_PEPPER
npm run db:migrate
npm run dev                      # 构建学习端 + Wrangler，http://localhost:8787
```

需要热更新时分开运行：

```bash
npm run dev:api                  # Worker API：8787
npm run dev:web                  # 学习端 Vite：5173，代理 /api 与 /runtime
npm run dev:admin                # 管理面板：5174，代理 /api
```

基础验收：

```bash
npm test
npm run typecheck
npm run build
npm run validate:course
npm run test:admin               # Chromium 管理面板交互验收，可用 CHROMIUM_PATH 指定浏览器
```

真实本地 D1 烟测只允许空数据库和本地 API，使用独立持久化目录：

```bash
npx wrangler d1 migrations apply codequest_local --local --persist-to /tmp/opencode/codequest-admin-smoke-db
npx wrangler dev --local --persist-to /tmp/opencode/codequest-admin-smoke-db --port 8787
# 另一个终端：
ADMIN_SMOKE_ALLOW_WRITE=1 npm run smoke:admin
```

## 2. 学习端与语言运行时

- `apps/web/src/main.tsx` 是 SPA 入口；`App.tsx` 调度初始化、登录、课程、自由模式与 Container Shell 视图。
- v0.9 目标只使用 RPGJS：浏览器 `@rpgjs/client` + Cloudflare Worker/Durable Object；`apps/web/src/engine/` 的 WebGAL 兼容子集属于待删除历史代码。
- `apps/web/src/runners.ts` 按语言懒加载 Worker；Shell 明确拒绝一次性模拟运行时，必须使用常驻容器会话。
- JS：`packages/runtime-js/src/exec.ts` 在 Worker 中执行，捕获 console 与逐行 stdin，stdout 上限 1 MiB。
- Python：`packages/runtime-pyodide/src/worker.ts` 以 ESM 动态导入本地 `/pyodide/pyodide.mjs`；**禁止 `importScripts`**，不依赖 CDN。
- C/C++：默认走 `packages/runtime-clang/src/online-client.ts` 的 wasm-clang 在线编译；只有显式携带 `__template_wasm_base64` 时才走模板 WASM。
- Java：`packages/runtime-java` 使用 teavm-javac；编译错误回填 Monaco 诊断。
- 判题器 `packages/judge` 保持纯 TS，不接触运行时，也不引入浏览器/Node 专属 API。
- 用户代码只在 Worker/WASM/container2wasm 内执行；主线程不得 `eval` 或运行用户代码。
- Monaco worker 使用 `worker: { format: "es" }`；Vite 设置 `assetsInlineLimit = 0`，避免 c2w worker 被内联成无法解析裸模块的 data URL。

定向运行时测试：

```bash
npx vitest run packages/judge/tests/judge.test.ts
npx vitest run packages/runtime-js/tests/exec.test.ts
npx vitest run packages/runtime-pyodide/tests/python.test.ts tests/frontend/pyodide-worker.test.ts
npx vitest run packages/runtime-clang/tests/template.test.ts tests/acceptance/cpp.test.ts
```

## 3. Container Shell 当前架构

- `apps/web/src/features.ts` 的 `CONTAINER_SHELL_ENABLED = true`；课程列表入口与容器视图共用该开关。
- `packages/runtime-shell/src/container-runtime.ts` 是唯一 Shell 运行时：
  - `openContainerSession()` 供独立终端与课程探索终端直接连接 xterm 字节流；
  - `openAutomatedContainerSession()` 供 Shell 脚本判题与自由模式复用常驻会话。
- 进入 Shell 题目、探索关、自由模式 Shell 标签或独立终端即启动容器；运行/测试点复用同一会话；手动重置关闭旧会话再开新会话；退出时关闭。
- `presetFiles` 与 stdin 在容器内通过 `/bin/busybox base64` 真实写入；Shell 路径必须是绝对路径。
- 自动会话使用 `/bin/busybox stty -echo`，以结果标记回收 stdout/stderr；每次运行使用独立临时目录、FIFO、超时看门狗与 1 MiB 输出上限。
- `file-exists` / `command-stdout` 在同一容器会话中探测，不另开容器，也不使用前端文件快照代替真实状态。
- `TerminalWorkbench` 与 `ContainerShell` 的 xterm 只传输字节，不解析命令、不伪造提示符、不做本地行编辑。
- 容器 TTY 尺寸只在启动前测量一次：字体/布局稳定后把 `cols/rows` 传给会话，初始化时执行 `stty rows ... cols ...` 并导出 `COLUMNS/LINES`。**不要恢复动态 fit**：当前纯 WASI c2w 没有 PTY resize 通道。
- `apps/web` 固定 `@xterm/xterm@5.5.0`；6.0.0 的 `requestMode` 会被当前 Vite/esbuild 压缩成未定义变量，导致 vim 的 DECRQM 查询崩溃。不要盲目升级。

## 4. 镜像、c2w 与 R2 工件

当前生产镜像是五个 Alpine 3.22 开发环境：

- `cq-dev-shell:cn`、`cq-dev-cpp:cn`、`cq-dev-java:cn`、`cq-dev-python:cn`、`cq-dev-javascript:cn`。
- 全部包含 git/vim/nano；Shell 另有 procps/iproute2，C/C++ 有 build-base/gdb，Java 有 OpenJDK 21，Python 有 pip/构建工具，JavaScript 有 Node.js/npm。
- `scripts/build-language-container.mjs` 是统一构建/选择器；`scripts/containers/` 下是各语言 Containerfile 与共用逻辑。
- Alpine 基础镜像从 `docker.1ms.run/library/alpine:3.22` 拉取并 tag 为 `docker.io/library/alpine:3.22`；apk 源使用清华镜像。
- GitHub c2w release 走 `gh-proxy.org`；下载后按脚本内固定 SHA-256 校验。当前使用 c2w v0.8.5 与 Podman。
- 镜像构建默认执行禁网冒烟，检查 git/vim/nano 与语言工具链。

```bash
npm run container:list
npm run container                      # 交互选择
npm run container -- all --test        # 构建并冒烟全部镜像
npm run container:test                 # 冒烟已构建镜像
npm run container:c2w -- all --no-build
npm run runtime:upload                 # 校验清单后上传本地 R2
npm run runtime:upload:remote          # 线上 R2，谨慎使用
```

`build-c2w.mjs` 生成 `runtime/cq-dev-<language>.wasm.gz`，并同步更新 `runtime/container-environments.json` 与 `apps/web/public/container-environments.json`。

### 运行时加载不变量

- c2w wasm 超过 Workers Assets 单文件 25MiB 上限，必须放 R2，不能放 `apps/web/public/`。
- `GET /runtime/cq-dev-<language>.wasm` 返回 gzip 原始字节，设置 `application/wasm`、`Content-Length` 与跨源隔离头，**不设置 `Content-Encoding`**。
- VM Worker 在实例化前按 gzip magic 校验并用 `DecompressionStream("gzip")` 解压；SHA-256 与缓存都针对压缩原始字节。
- `scripts/patch-c2w-workers.mjs` 在 `npm run build:web` 中运行：把 `comlink` / `@bjorn3/browser_wasi_shim` 改写到 `/vendor/...`，注入缓存、下载进度和默认 Shell 工件总大小。
- Vite dev、preview、`_headers` 与 R2 路由都要提供 COOP/COEP/CORP，否则 SharedArrayBuffer 在 wasm 请求前就会失败。
- 默认构建移除 c2w 的 `--net socket`，避免 guest 等待没有对端的 DHCP。恢复外网前必须先实现 `container.net` / `c2w-net-proxy`。
- 镜像已是 `ENTRYPOINT ["/bin/sh"]`；一次性命令使用 `entrypoint: "/bin/sh"` + `command: ["-c", "..."]`，交互 shell 只传 entrypoint。
- c2w stdout 没有可靠 EOF；自动会话必须以结果标记或 `onExit` 完成，不能 `for await` 等 `done`。

## 5. 浏览器端到端验收

需要 Chromium/Edge 与对应工件。除 `test:runtime-route` 外，脚本会自行启动静态测试服务；`test:runtime-route` 需要先运行 `npm run dev` 并上传本地 R2 工件。

```bash
npm run build:web
C2W_BROWSER=/opt/microsoft/msedge/msedge npm run test:terminal-vim
node scripts/test-shell-container.mjs /tmp/opencode/cq-dev-shell.wasm /opt/microsoft/msedge/msedge
C2W_BROWSER=/opt/microsoft/msedge/msedge node scripts/test-container-selector.mjs

# 另一个终端保持 npm run dev 运行：
C2W_BROWSER=/opt/microsoft/msedge/msedge node scripts/test-r2-runtime.mjs
node scripts/test-c2w-environment.mjs shell /tmp/opencode/cq-dev-shell.wasm
```

覆盖范围：

- `test-shell-container`：预设文件、会话持久/重置、stdin、交互终端、非零退出、动态 goals、超时恢复、后台输出隔离与 1 MiB 上限。
- `test-container-selector`：首屏 Shell 工件、五种环境启用、切换 JavaScript、提示符恢复与缓存复用。
- `test-terminal-vim`：生产构建中的 `stty size`、DECRQM、真实 vim 新建/插入/保存退出/读回。
- `test-r2-runtime`：R2 路由的 gzip magic、压缩字节数/SHA-256、响应头与解压后的 WASM magic。
- `test-c2w-environment`：指定语言在真实容器中的工具链冒烟；Java 的 javac/java 明显慢于 Shell 启动。

## 6. 已知边界

- `@webvirt/c2w@0.1.0` 没有暴露 VM/ring Worker 的 `terminate()`。当前关闭路径最多等待 750ms 并取消 reader/writer，但强制 Worker 回收仍需上游 fork；不能把浏览器 GC 当销毁保证。
- 当前工件是纯 WASI，没有 Emscripten `__syscall_ioctl` 钩子；窗口缩放后终端网格保持不变，需要新尺寸时重启容器。
- 浏览器需支持 SharedArrayBuffer 与 gzip 解压；c2w 工件使用 WasmGC 时还需 WasmGC。生产部署必须保留跨源隔离头。
- 当前默认禁网。模拟内核 loopback 的历史验证不等于外网可用。
- `docs/Container-Shell.md` 记录当前架构、工件与验收命令；性能数字是特定机器/浏览器的历史实测，不作为功能测试断言。

## 8. 协作与提交

- 设计决策先改 `docs/编程学习系统设计书.md` 再动代码；实现状态见 `docs/实现说明.md`。
- 不修改第三方技能或上游仓库；container2wasm 等上游变更走对应 fork，主仓库只做依赖与集成。
- WebGAL/Terre 与 PC/Docker 创作端已废除；当前部署边界只允许 Cloudflare 与用户浏览器，RPGJS 框架不 fork。
- 判题/运行时改动必须附可复现的挑战、判题配置与预期结果。
- 提交在 `dev` 分支；署名 `Haruki Takehata <haruki-takehata@yang-qwq.top>`；
- `npm run db:reset` 只重置本地 D1，带 `--yes`，绝不用于远端。
