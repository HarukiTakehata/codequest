# CodeQuest 判题器（@codequest/judge）

纯 TypeScript 判题与过程目标求值包，供学习端、验收测试和 Worker 侧复用。包本身不执行用户代码，也不依赖浏览器或 Node 专属 API。

## 入口

`src/index.ts` 导出：

- `judge(runCase, config, timeoutMs?)`：顺序执行全部测试点并汇总判定。
- `compareOutput(expected, actual, mode, tolerance?)`：输出比对并返回差异行列表。
- `evaluateGoals(goals, context)`：根据源码、最近运行结果、测试结果和运行时探测计算 goals。
- `replayIsConsistent(a, b)`：比较两次判题结论，作为防作弊回放的基础工具；不是完整回放服务。
- `RunTimeoutError` 与 `RunRequest` / `RunResponse`、`JudgeConfig`、`Goal` 等共享类型。

## 判题行为

- 默认比对模式为 `eol`；支持 `exact`、`eol`、`ws`、`regex-line`、`numeric-tol`。
- `numeric-tol` 使用测试点的 `tolerance`，未设置时为 `1e-6`。
- 每个测试点可设置 `weight`，最终 `score` 为四舍五入后的 0–100 加权分。
- 超时、非零退出码、stderr 或输出不符均判为失败；`firstFailure` 携带失败原因，输出不符时包含行级 `diff`。
- 空测试点配置不会通过。

调用方只提供 `(stdin, index) => Promise<RunResponse>`，因此同一实现可搭配 JS/Python/C++/Java Worker 或 Shell 容器会话：

```ts
import { judge, type JudgeConfig } from "@codequest/judge";

const verdict = await judge(
  (stdin) => runInLanguageRuntime(stdin),
  config satisfies JudgeConfig,
);
```

## Goals

`evaluateGoals` 支持八类检查：

- 源码：`source-regex`、`source-not-regex`。
- 最近一次运行：`output-contains`、`output-regex`、`exit-code`。
- 文件与命令：`file-exists`、`command-stdout`。
- 测试点：`testcase`，可指定测试点 id 或全部/任一通过。

Shell 运行时在同一容器会话中执行 shell 探针，并通过 `runtimeGoalResults` 回传 stdout/stderr/exitCode；该结果优先于初始 `files` 快照。c2w 只有 Shell/终端接口，因此这些 goals 不是独立世界状态判题。最终判题仍走 stdio 轨；RPGJS 世界状态判题在另一条并行轨道中运行。goals 用于过程引导，是否阻断提交由挑战的 `requireAllGoals` 决定。

## 测试

在仓库根目录执行：

```bash
npm --workspace @codequest/judge test
# 或
npx vitest run packages/judge/tests/judge.test.ts
```

测试覆盖五种比对模式、加权评分、首个失败 diff、stderr/非零退出/超时分类、空配置、回放一致性与全部 goals 检查类型。
