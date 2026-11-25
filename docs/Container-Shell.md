# Container Shell 模式（真实容器终端）

> 用户 2026-11-25 要求：直接对接 rootfs 内容，尽可能拟真，不做额外处理。
> 本模式直接运行由 `cq-minimal:cn` 经 container2wasm 转换出的 wasm，xterm.js 只做字节级终端仿真。

## 形态

课程列表页「⚡ 自由模式」旁的独立入口 **Container Shell**，点击进入全屏终端：

- 顶栏显示镜像与「重启容器」「返回课程列表」。
- xterm.js 把完整键盘字节流（Tab、方向键、Ctrl+C、vi 控制序列）原样写入容器 stdin。
- 容器 stdout/stderr 字节流原样写回 xterm；不伪造提示符、不本地行编辑、不拦截命令。
- `vi` 来自镜像内的真实 busybox，不再由前端 Monaco 编辑器代替。

## 镜像与产物

- `scripts/build-minimal-shell-cn.mjs`：清华 apk 源 + `gh-proxy.org` 源码，Alpine/musl 静态编译
  busybox 1.38.0，rootfs 1.2MB / 407 applet，`FROM scratch` 打成 `cq-minimal:cn`。
- c2w 转换产物：`runtime/cq-minimal.wasm.gz`（约 37MB）。原 wasm 约 98MiB，超过 Workers Assets
  单文件 25MiB 上限，因此**不放进静态资源目录**，改为存 R2，由 Worker 路由
  `GET /runtime/cq-minimal.wasm` 以 `Content-Type: application/wasm` + `Content-Encoding: gzip` 返回。
- 上传：`npm run runtime:upload`（本地 R2）/ `npm run runtime:upload:remote`（线上 R2）。
- 跨源隔离头（`apps/web/public/_headers` + vite + R2 路由）提供 SharedArrayBuffer，满足 c2w 运行时要求。

## 执行路径

```ts
const container = await createContainer({
  wasmUrl: "/runtime/cq-minimal.wasm",
  command: ["/bin/sh"],
  env: { TERM: "xterm", PS1: "$ ", HOME: "/home/student" },
});
container.stdio.stdin.getWriter() ← xterm.onData 原始字节
container.stdio.stdout/stderr     → xterm.write
```

## 边界与已知问题

- c2w 采用 Bochs/QEMU 全系统模拟，首次启动较慢（此前实测 109MB 教学镜像冷启动不可用）。
  本最小镜像更小，但性能仍取决于模拟层；详见 `docs/spike-M3-M4.md`。
- 需要浏览器支持 SharedArrayBuffer 与 WasmGC 能力（取决于 c2w 产物）。
- 课程内 shell 教学仍走毫秒级 wasi-sh 路径；本模式是独立探索入口。

## 验证

- `tests/frontend/container-shell-assets.test.ts`：确认组件直接对接 `createContainer`、
  `stdio.stdin`，无前端拦截逻辑；`tests/backend/runtime-assets.test.ts` 验证 R2 路由头部。
- 真实 `wrangler dev`：`GET /runtime/cq-minimal.wasm` 返回 200 + wasm/gzip/跨源隔离头。
- `node scripts/test-minimal-rootfs.mjs`：镜像内 shell/文件/文本/进程/loopback 5/5 通过。
- `npm run typecheck` / `npm run build` 通过。
