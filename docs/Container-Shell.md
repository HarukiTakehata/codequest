# Container Shell 模式（真实容器终端）

> 用户 2026-11-25 要求：直接对接 rootfs 内容，尽可能拟真，不做额外处理。
> 2026-11-26 已按要求重新启用课程列表入口，默认禁网。
> 本模式按语言运行 Alpine 开发镜像经 container2wasm 转换出的 wasm，xterm.js 只做字节级终端仿真。

## 形态

课程列表页「⚡ 自由模式」旁的独立入口 **Container Shell**，点击进入全屏终端：

- 顶栏提供 Shell / C/C++ / Java / Python / JavaScript 环境选择器，切换后重启容器。
- 顶栏显示当前镜像与「重启容器」「返回课程列表」。
- xterm.js 把完整键盘字节流（Tab、方向键、Ctrl+C、vi 控制序列）原样写入容器 stdin。
- 容器 TTY 尺寸只在启动前测量一次：xterm 完成字体与布局适配后，把 `cols/rows` 写入容器初始化脚本的 `stty rows ... cols ...`，同时导出 `COLUMNS/LINES`；网格随后固定，确保 `stty size` 与终端元素一致。
- 容器 stdout/stderr 字节流原样写回 xterm；不伪造提示符、不本地行编辑、不拦截命令。
- `vi` 来自镜像内的真实 busybox，不再由前端 Monaco 编辑器代替。

## 镜像与产物

- `scripts/build-language-container.mjs`：统一选择器；`scripts/containers/` 下五个独立脚本与
  Alpine 3.22 Containerfile 构建 `cq-dev-<language>:cn`，全部包含 git/vim/nano。
- `scripts/containers/build-c2w.mjs`：调用 c2w v0.8.5 转换并生成
  `runtime/cq-dev-<language>.wasm.gz` 与 `apps/web/public/container-environments.json`。
- 当前五种工件均已生成、通过 gzip/SHA-256 校验、上传本地 R2，并在 Edge 中完成对应语言冒烟：

| 环境 | gzip 字节 | SHA-256 |
|---|---:|---|
| Shell | 59,341,603 | `460591eeb47bbf4dc948b16a562acb734c233d63eed31899881746c43083bd4d` |
| C/C++ | 180,765,212 | `1a7a2b5c707265ee1991224cc315f2a6eecc80770108343dde15249bee495f4e` |
| Java | 214,346,872 | `83aec7c380cdd50b6f141427543c5c6727a57235ed1aa06b23a9f95c44112df1` |
| Python | 176,050,296 | `bae5701222fdcabe78deed0fc5d0a74a0d91b4f6a982867bc0fd996b5b6c6489` |
| JavaScript | 82,317,852 | `4acb17d7e341011b41e34526ce8b8c5f2ee97bdefcba838183c73178d2848ecb` |

- 运行时统一使用 `cq-dev-<language>.wasm.gz`，不再提供旧 `cq-minimal` 兼容工件或路由。
  工件超过 Workers Assets 单文件 25MiB 上限，因此存 R2，由 `GET /runtime/cq-dev-<language>.wasm`
  返回 gzip 原始字节。路由不主动设置 `Content-Encoding`，VM Worker 也不依赖该头，而是按 gzip magic
  校验并解压后再交给 `WebAssembly.instantiateStreaming`，避免浏览器自动解压导致 SHA 与缓存表示不一致。
- 上传：`npm run runtime:upload`（本地 R2）/ `npm run runtime:upload:remote`（线上 R2）。上传命令只设置
  `application/wasm` MIME，不写 R2 `Content-Encoding` 元数据，确保浏览器收到的压缩表示可被稳定校验。
- 跨源隔离头（`apps/web/public/_headers` + vite + R2 路由）提供 SharedArrayBuffer，满足 c2w 运行时要求。

## 执行路径

```ts
const session = await openContainerSession({}, {
  wasmUrl: `/runtime/cq-dev-${environment}.wasm?env=${environment}&bytes=${compressedBytes}&v=${sha256.slice(0, 12)}&sha256=${sha256}`,
  requestId: environment,
});
session.stdio.stdin.getWriter() ← xterm.onData / onBinary 原始字节
session.stdio.stdout/stderr     → xterm.write
session.close(stdinWriter, { stdout, stderr }) → 退出 guest、取消 reader/writer
```

## 本地工件缓存

- 所有 Shell 入口（独立终端、课程探索、自动判题、自由模式）统一从 `container-environments.json`
  补充完整 `sha256` 与压缩 `bytes`；清单请求在页面内共享一次。
- VM Worker 在 gzip 解压前读取原始压缩字节，按工件路径写入 Cache API 的
  `codequest-c2w-runtime-v1`。`requestId`、进度参数与版本查询参数不进入缓存键。
- 每次命中缓存都会重新计算 SHA-256 并校验字节数；不一致时删除旧条目、重新下载。网络响应
  也必须通过完整 SHA-256 校验后才写入缓存，校验失败不会启动容器。
- Web Locks 按工件路径合并多个 VM Worker 的首次下载，避免快速重置或严格模式重放产生重复费用。
- Cache API 不可用、缓存读取失败或配额不足时降级为网络下载；Service Worker 更新会保留该缓存。

## 启动进度

- 页面左下角显示固定半透明进度组件。
- vm-worker 流式读取 WASM 时，通过 `BroadcastChannel("codequest-c2w-progress")` 上报
  `loaded / total`；总大小优先来自环境清单的 `bytes` 查询参数，缺少时回退到构建时注入的 Shell 工件大小。
- 下载阶段显示百分比与 MiB；传输完成后切换为不确定滚动条，表示 Bochs / runc / shell 启动中。
- 收到首个 stdout 或容器退出后隐藏；下载失败时显示错误摘要。

## 边界与已知问题

- c2w 采用 Bochs 全系统模拟；禁网 + 正确 worker/entrypoint 下，Firefox/Edge 实测约 2 秒输出。
  旧版“数分钟无响应”来自 worker 加载失败与未接通 DHCP，不是 Bochs 固有启动时间。
- `@webvirt/c2w@0.1.0` 默认传 `--net socket`；当前构建脚本会移除该参数。若以后需要外网，
  必须先实现 `container.net` 对端（如 `c2w-net-proxy`），不能直接恢复网络参数。
- 需要浏览器支持 SharedArrayBuffer 与 WasmGC 能力（取决于 c2w 产物）。
- 课程内 Shell 探索终端与脚本判题统一使用 container2wasm 常驻容器；进入即启动、运行复用、手动重置、退出时发送 Ctrl-C/exit 并取消流。
- `@webvirt/c2w@0.1.0` 没有暴露 VM/ring Worker 的 `terminate()`；当前关闭路径有 750ms 优雅退出上限并释放锁定的 reader/writer，但强制 Worker 回收仍需上游 fork 配合，不能把浏览器 GC 当作销毁保证。
- 当前工件是纯 WASI 构建，没有 Emscripten 的 `__syscall_ioctl` 钩子，c2w 也不提供 PTY resize 通道；因此容器尺寸无法在会话运行中随浏览器窗口改变。窗口缩放后网格保持不变，宿主允许滚动查看；需要新尺寸时重启容器。
- 自动 Shell 判题已串行化，每次运行使用独立临时目录、FIFO 流式 1 MiB 上限、独立超时标记；`file-exists` / `command-stdout` 在同一会话中真实探测。探索关仍按课程设计使用关闭终端后的令牌门。

## 验证

- `tests/frontend/container-shell-assets.test.ts`：确认独立终端与课程终端都使用常驻 c2w 会话、
  `stdio.stdin`，无前端拦截逻辑；`tests/frontend/shell-container-session.test.ts` 验证生命周期与脚本协议。
- `tests/frontend/c2w-worker-bundle.test.ts`：验证 worker 进度上报、总大小注入、缓存包装顺序与禁网 patch。
- `tests/frontend/c2w-runtime-cache.test.ts`：验证冷/热缓存、损坏缓存重下、SHA/字节数不符拒绝加载、配额降级与跨 Worker 下载锁。
- `tests/backend/runtime-assets.test.ts`：验证 R2 路由头部与 `Content-Length`。
- 真实 Edge + 生产 worker：Shell gzip 59,341,603 字节完成 `downloading → starting` 切换，
  新 Shell 工件浏览器冒烟通过。
- `npm run container:test`：五个 Alpine 语言镜像真实编译/运行，并检查 git/vim/nano；Shell 额外检查 procps/iproute2。
- 真实 `wrangler dev`：`GET /runtime/cq-dev-<language>.wasm` 返回 200 + WASM MIME + 跨源隔离头，响应体为 gzip 原始字节；`node scripts/test-r2-runtime.mjs` 在 Edge 中校验 gzip magic、字节数/SHA-256 与清单一致，并按 worker 路径解压后得到 WASM magic。
- `node scripts/test-shell-container.mjs /tmp/opencode/cq-dev-shell.wasm /opt/microsoft/msedge/msedge`：真实浏览器验证预设文件、会话持久、重置、stdin、交互终端、stderr/非零退出、动态 goals、超时后恢复、后台输出隔离与 1 MiB 输出上限；三次会话共用一次工件请求。
- `node scripts/test-c2w-environment.mjs <lang> /tmp/opencode/cq-dev-<lang>.wasm`：五种语言均通过 Edge 冒烟；Java 的 `javac/java` 步骤明显慢于 Shell 启动。
- `node scripts/test-container-selector.mjs`：真实 Edge 验证五种选项全部启用、首次请求新 Shell 工件、切换 JavaScript 后请求对应工件并恢复提示符，且不请求 legacy 工件；同环境重启后服务端请求次数仍为 1。
- `apps/web` 直接固定 `@xterm/xterm@5.5.0`：避免 6.0.0 的 `requestMode` 被当前 Vite/esbuild 压缩成未定义变量。`C2W_BROWSER=/opt/microsoft/msedge/msedge npm run test:terminal-vim` 已在生产构建中验证 `stty size` 与 xterm 网格一致、DECRQM 响应、真实 vim 新建/插入/保存退出/读回，且无页面异常。
- `npm run typecheck` / `npm run build` 通过。
