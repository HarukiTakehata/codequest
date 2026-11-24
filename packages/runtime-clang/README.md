# CodeQuest C/C++ 运行时（@codequest/runtime-clang）

提供两条已接入的 C/C++ 执行路径：默认使用 `@live-codes/clang-wasm` 在 Worker 内在线编译运行；显式配置模板工件的挑战使用预编译 WASM 与最小 WASI shim。

## 入口

| 路径 | 作用 |
|---|---|
| `src/online-client.ts` | `runCppOnline(request)`；默认在线编译路径的浏览器客户端 |
| `src/online-worker.ts` | 在 Module Worker 内创建 wasm-clang 编译器，编译运行后回传 |
| `src/online.ts` | `ClangCompiler` 接口、结果适配与 Monaco 行级诊断转换 |
| `src/template.ts` | 包入口；`runTemplateWasm` / `executeCpp` 模板路径 |
| `src/client.ts` / `worker.ts` | 模板 WASM 路径的 Worker 客户端 |

`apps/web/src/runners.ts` 根据 `request.files.__template_wasm_base64` 是否存在选择路径：有模板工件走 `runCpp`，否则走 `runCppOnline`。

## 在线编译路径

- 使用本地 `/clang/` 下的 vendored `@live-codes/clang-wasm` 工件，在独立 Module Worker 内完成 Clang 22 → WASM 编译与运行。
- `toRunResponse` 合并编译器 stderr 与结构化 `errors`，保留 stdout、退出码和编译日志。
- `compileDiagnostics` 从 `main.cpp` / `main.c` 错误中提取行号与消息，供工作台回填编辑器诊断。
- 客户端超时上限为 `request.timeoutMs + 5000ms`，超时返回退出码 124。

## 模板 WASM 路径

- 挑战通过 `files.__template_wasm_base64` 提供预编译模块。
- 最小 WASI shim 支持 `fd_read`、`fd_write`、`proc_exit`，以及基础 environ/args 与占位 random/clock 调用。
- 模块可导出 `_start` 或 `main`；运行结果统一为 stdout、stderr 与退出码。
- 该路径不提供文件系统，也不执行源码编译；它是显式配置的模板模式，不代表在线编译尚未启用。

## 测试

```bash
npx vitest run packages/runtime-clang/tests/template.test.ts
npx vitest run tests/acceptance/cpp.test.ts tests/acceptance/free-templates.test.ts
```

模板测试用 `wabt` 构造真实 WASM，覆盖 stdin/stdout 与统一请求入口；验收测试使用真实 wasm-clang 编译运行参考解，并验证编译错误行号诊断。
