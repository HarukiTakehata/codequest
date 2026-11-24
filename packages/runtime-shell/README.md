# CodeQuest Shell 运行时（@codequest/runtime-shell）

基于 `@webvirt/c2w` 的 container2wasm 常驻容器运行时。课程探索终端、Shell 脚本判题、自由模式 Shell 标签与独立 Container Shell 都使用这里的真实容器会话，不再使用 TypeScript 模拟 shell 或 wasi-sh。

## 入口

| 路径 | 作用 |
|---|---|
| `src/container-runtime.ts` | 包入口；交互/自动会话、初始化、执行协议与 goals 探测 |
| `src/container-runtime-assets.ts` | 读取环境清单并补充工件 SHA-256、字节数等校验参数 |
| `src/container-runtime-cache.ts` | c2w VM Worker 的运行时下载包装：Cache API、SHA-256、gzip 解压、下载锁与进度 |

各模块的主要 API：

- `openContainerSession(files?, options?)`：返回 `stdio.stdin/stdout/stderr` 字节流，供 xterm 直接连接。
- `openAutomatedContainerSession(files?, options?)`：返回可重复调用的 `run(request)` 与 `close()`。
- `buildContainerInitialization` / `buildContainerRunBlock`：容器内初始化与脚本执行协议。
- `buildContainerGoalCheckScript` / `parseContainerGoalChecks`：在同一会话中探测 `file-exists` 与 `command-stdout`。
- `fetchContainerRuntime`：运行时工件缓存、完整性与解压入口。

## 会话行为

- 默认工件为 `/runtime/cq-dev-shell.wasm`；独立终端可切换 `/runtime/cq-dev-<language>.wasm`。
- 启动时通过 `/bin/busybox base64` 将绝对路径的 `presetFiles` 和 stdin 写成容器内真实文件，工作目录为 `/home/student`。
- 交互会话启动真实 `/bin/sh`；xterm 键盘字节原样写入 stdin，stdout/stderr 原样写回。
- 自动会话关闭 TTY 回显，运行请求串行排队；每次运行使用独立临时目录、FIFO、结果标记和超时看门狗。
- stdout 与 stderr 分别限制为 1 MiB；初始文件与 stdin、脚本与 stdin 各有 512 KiB 注入上限。
- `close()` 发送 Ctrl-C/exit，最多等待 750ms，再取消 reader/writer；重复关闭安全。

## 工件与缓存

- 五语言 Alpine 镜像由 `scripts/build-language-container.mjs` 构建，`scripts/containers/build-c2w.mjs` 转换并生成 `runtime/cq-dev-<language>.wasm.gz` 与 `apps/web/public/container-environments.json`。
- 工件超过 Workers Assets 单文件限制，存于 R2，经 `/runtime/cq-dev-<language>.wasm` 返回 gzip 原始字节；响应不设置 `Content-Encoding`。
- 缓存键只保留工件路径。命中缓存和网络下载都按清单校验完整 SHA-256 与压缩字节数，然后才解压并实例化 WASM。
- 缓存损坏时删除并重下；Cache API 不可用或写入失败时降级为网络下载。Web Locks 合并同一工件的首次下载。

## 已知边界

- 当前 c2w 工件是纯 WASI，没有运行时 PTY resize 通道；TTY 尺寸只在启动前设置，窗口缩放后需重启容器。
- 当前构建默认禁网；恢复外网前必须先提供 `container.net` 对端。
- `@webvirt/c2w@0.1.0` 未暴露 VM/ring Worker 的 `terminate()`；关闭路径会取消流，但不能把浏览器 GC 当作强制销毁保证。
- 需要 SharedArrayBuffer、`DecompressionStream("gzip")` 与跨源隔离头；c2w 工件使用 WasmGC 时还需浏览器支持 WasmGC。

## 测试

```bash
npx vitest run tests/frontend/shell-container-session.test.ts
npx vitest run tests/frontend/c2w-runtime-cache.test.ts
npx vitest run tests/frontend/container-shell-assets.test.ts tests/frontend/container-startup-progress.test.ts
npx vitest run tests/frontend/c2w-worker-bundle.test.ts tests/backend/runtime-assets.test.ts
```

真实容器浏览器验收（需要对应 raw wasm 与 Chromium/Edge）：

```bash
npm run test:shell-container -- /tmp/opencode/cq-dev-shell.wasm /path/to/chromium
C2W_BROWSER=/path/to/chromium npm run test:container-selector
npm run build:web
C2W_BROWSER=/path/to/chromium npm run test:terminal-vim
```

端到端验收覆盖预设文件、会话持久/重置、stdin、交互终端、非零退出、动态 goals、超时恢复、后台输出隔离、输出上限、五环境切换与缓存复用。完整流程见 [Container Shell 文档](../../docs/Container-Shell.md)。
