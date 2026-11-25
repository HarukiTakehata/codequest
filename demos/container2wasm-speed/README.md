# container2wasm 加载速度 demo（独立）

不依赖主程序、wrangler 或数据库，只测 c2w 容器从加载到执行命令的真实耗时。

## 运行

```bash
cd 仓库根目录
node demos/container2wasm-speed/server.mjs \
  /tmp/opencode/alpine-out2/cq-minimal-alpine.wasm 8950
```

浏览器打开 `http://127.0.0.1:8950/`，点「开始测试」。

## 页面内容

- 分阶段耗时：wasm fetch、`createContainer` 启动、stdout 收齐、总计。
- 容器内执行 `/bin/sh -c "echo CQ_READY"`，输出区显示真实 stdout。
- 页面带 COOP/COEP 头（SharedArrayBuffer 需要），worker 为 ESM 并直接由 demo 服务器提供。

## 产物说明

默认 wasm 是 Alpine 化 c2w 转换得到的 `cq-minimal-alpine.wasm`（98MB），构建过程见
`.opencode/skills/codequest-maintenance/SKILL.md` 与 `docs/spike-M3-M4.md`。
也可换成任何 `c2w` 产物（例如原先的 `cq-teaching.wasm`，109MB）做对比。
