# CodeQuest Python 运行时（@codequest/runtime-pyodide）

使用真实 Pyodide 在浏览器 Module Worker 中运行课程 Python，并适配为统一的 `RunRequest` / `RunResponse`。

## 入口

| 路径 | 作用 |
|---|---|
| `src/execute.ts` | 包入口；`executePython(pyodide, request)` 执行内核与 stdin/stdout/stderr 引导 |
| `src/worker.ts` | 动态加载本地 Pyodide ESM 工件并执行请求 |
| `src/client.ts` | `runPython(request)`；创建 Worker、处理超时/错误并终止 Worker |

## 已实现行为

- Worker 通过 `import()` 加载 `/pyodide/pyodide.mjs`，并以本地 `indexURL` 初始化；Pyodide 工件位于 `apps/web/public/pyodide/`，不依赖 CDN。
- 用户代码运行前注入引导，重定向 `sys.stdout` / `sys.stderr`，并用给定 stdin 实现逐行 `input()`（包含 prompt）。
- 使用 `runPythonAsync` 执行用户代码，支持顶层 `await`。
- 捕获 Python 异常并写入 stderr，返回非零退出码。
- stdout 与 stderr 各自有 1 MiB 缓冲上限。
- `runPython` 的超时上限为 `request.timeoutMs + 1000ms`，超时返回退出码 124。

Worker 是 ES module，不能使用 classic worker 的 `importScripts`。执行内核接受 `PyodideLike` 接口，因此 Node 测试可加载真实 Pyodide 复用同一逻辑。

## 测试

```bash
npx vitest run packages/runtime-pyodide/tests/python.test.ts
npx vitest run tests/frontend/pyodide-worker.test.ts tests/frontend/cross-origin-isolation.test.ts
npx vitest run tests/acceptance/m2.test.ts tests/acceptance/free-templates.test.ts
```

运行时测试覆盖 `print()`、带 prompt 的 `input()`、异常与顶层 `await`；前端守卫检查本地 ESM 加载、Worker 接线和跨源隔离配置。
