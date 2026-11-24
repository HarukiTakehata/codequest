# CodeQuest JavaScript 运行时（@codequest/runtime-js）

在浏览器 Module Worker 中执行课程 JavaScript，并适配为统一的 `RunRequest` / `RunResponse`。主线程只负责创建和终止 Worker。

## 入口

| 路径 | 作用 |
|---|---|
| `src/exec.ts` | 包入口；执行内核，可在 Node 测试中直接调用 |
| `src/worker.ts` | 接收 `RunRequest`，调用 `executeJs` 并回传结果 |
| `src/client.ts` | `runJs(request)`；创建 Worker、处理超时/错误并终止 Worker |

## 已实现行为

- 将 `stdin` 规范化为逐行队列，向用户代码提供 `readline()`；同时注入 `stdin` 原始字符串和 `input` 别名。
- 捕获 `console.log` / `console.info` 到 stdout，`console.error` / `console.warn` 到 stderr。
- 对象参数使用 JSON 序列化，`Error` 输出名称与消息；stdout 同时记录到 `logs`。
- 用户代码抛错时写入 stderr 并返回非零退出码。
- stdout 超过 1 MiB 时终止收集并附加超限提示。
- `runJs` 的超时上限为 `request.timeoutMs + 500ms`，超时返回退出码 124。

当前模型不消费 `RunRequest.files`，也不提供课程文件系统。`executeJs` 必须在 Worker 中执行，不能放到主线程。

## 测试

```bash
npx vitest run packages/runtime-js/tests/exec.test.ts
npx vitest run tests/acceptance/m2.test.ts tests/acceptance/free-templates.test.ts tests/acceptance/free-mode.test.ts
```

单元测试覆盖 stdin、console 分流、对象序列化、异常与 1 MiB 输出上限；验收测试将参考解接入真实判题器。
