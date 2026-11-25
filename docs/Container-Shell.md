# Container Shell 模式（独立容器终端）

> 用户 2026-11-25 需求：把 `cq-minimal:cn` 最小镜像植入当前代码，提供独立的 Container Shell 模式，
> 前端模拟终端；镜像需带 `nano` 或 `vi`。本实现带 **vi**（busybox applet）。

## 形态

课程列表页「⚡ 自由模式」旁的独立入口 **Container Shell**，点击进入全屏终端：

- 顶栏显示镜像与 applet 数，提供「重启会话」「返回课程列表」。
- 输入区接收命令，回车或「执行」发送；输出区实时追加 shell 字节流。
- 支持 `reset`（重启会话）、`clear`（清屏）、`help`。
- Tab 补全：第一个词补命令（applet），其余位置按 `/` 绝对路径或 `/home/student/` 相对路径补全文件与目录；多个候选列出并补最长公共前缀。
- 不绑定剧情、不做判题。

## 镜像内容

`cq-minimal:cn` 由 `scripts/build-minimal-shell-cn.mjs` 生成：

- Alpine 3.22（清华 apk 源）+ musl 静态编译 busybox 1.38.0（源码经 `gh-proxy.org`）。
- rootfs 1.2MB / 407 applet；`FROM scratch` 打成镜像，无 Ubuntu/Debian 层。
- `vi` 已启用并链接到 `/bin/busybox`（`:wq` 保存，`:q!` 退出）。
- 前端快照：`apps/web/public/container-shell/rootfs.json`（`/etc/passwd`、`/etc/resolv.conf`、
  `/home/student/README.md` 等）与 `applets.json`（407 项）。

## 执行路径

用户命令在浏览器 Worker 内的真实 busybox 执行，不进入主线程（AGENTS.md #4）：

```ts
const session = await spawn({ files: snapshot, env: { COLUMNS: "80", LINES: "24" } });
session.onOutput((bytes) => render(decoder.decode(bytes)));
session.write(command + "\n");
```

使用 wasi-sh 的**常驻交互会话**，因此在 shell 里 `vi` 编辑、`echo > file`、管道与重定向产生的内容
都留在同一会话的文件系统里，符合「模拟终端」语义。判题仍走 `runWasiSh()` 的逐命令路径，两者互不干扰。

## 边界

这是「最小镜像 rootfs 快照 + wasi-sh busybox wasm」的浏览器快速路径，
**不是 container2wasm 模拟内核**；后者的冷启动耗时已被判定为不适合 v1（见 `docs/spike-M3-M4.md`）。

## 验证

- `tests/frontend/container-shell-assets.test.ts`：快照文件、applet（含 `vi`/`nc`/`netstat`）、
  组件使用 `openShellSession` 且不依赖剧情，3 项通过。
- `node scripts/test-minimal-rootfs.mjs`：真实容器内 shell/文件/文本/进程/loopback 5/5 通过。
- `npm run typecheck` / `npm run build` 通过。
