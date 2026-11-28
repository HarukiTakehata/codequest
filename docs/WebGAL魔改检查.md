# WebGAL 魔改检查（2026-11-25，历史归档）

> **已废除（2026-11-28）**：CodeQuest v0.9 彻底移除 WebGAL/Terre 路线，不再保留 fork、指令扩展或剧本兼容要求。本文仅保存历史核查记录。

> 检查对象：`/home/yang/文档/WebGAL`（remote `git@github.com:HarukiTakehata/WebGAL.git`），
> commit `5c8056ca feat(codequest): add code/term/token/hint script commands`。
> 符合 AGENTS.md #1：改动在 fork 仓库，主仓库只做集成。

## 检查结论：✅ 可用

| 检查项 | 结果 | 证据 |
|---|---|---|
| 四条指令注册 | ✅ | `packages/parser/src/config/scriptConfig.ts`、`packages/webgal/src/Core/parser/sceneParser.ts`；`commandType` 用**追加**方式保留旧指令编号 |
| Parser 测试 | ✅ | `cd packages/parser && npx vitest run` → 5 files / **40 tests passed**（含新增 `codequestCommands.test.ts` 5 项） |
| Engine 类型检查 | ✅ | `cd packages/webgal && npx tsc --noEmit` 无输出 |
| Engine 构建 | ✅ | `npx tsc && npx vite build --base=./` → `✓ built in 7.14s` |
| 舞台挂载点 | ✅ | `Stage.tsx` 新增 `codequestContainer` / `codequestHintContainer`，SCSS z-index 40 / 20 |
| 宿主桥 | ✅ | `window.CodeQuestEngine.registerHost()` / `window.CodeQuestHost` / DOM 事件三路；挑战通过写 `-onPass` 变量、令牌门支持变量插值 |
| 文档 | ✅ | `dev-docs/CodeQuest扩展指令.md` 199 行，含语法、参数与宿主接入示例 |

> 在仓库根目录直接跑 `npx vitest run packages/parser/test` 会因 cwd 不同报 6 个测试资源路径错误；
> 进入 `packages/parser` 后全量 40 项通过——这是测试运行目录问题，不是魔改引入的回归。

## 代码审阅要点

1. **阻塞语义正确**：`code`/`term`/`token` 返回 `blockingNext/blockingAuto/blockingStateCalculation = true`，
   用超长 `duration` + 宿主 `request.submit()/close()` 显式卸载；`hint` 带隐式 `-next`，不阻塞剧情。
2. **变量门控**：`markCodeQuestVar()` 用 `setStageVarAndCommit` 在用户交互后提交，后续 `-when=pass1==true` 可放行；与主仓库自研引擎语义一致。
3. **降级面板**：未接入宿主时挂载内置提示，避免剧本永久卡死。
4. **预览保护**：`isFastPreview` 时把指令当 `-next` 跳过，Terre 预览不会弹阻塞 UI。

## 建议改进（非阻塞）

- `bridge.ts:notifyHostHint()` 把任何 Promise 都视为「宿主已接管」并立刻标记 viewed；若宿主异步返回 `false`/抛错，提示会被误记为已读。建议等待 Promise 解析结果再决定。
- `bridge.ts:createChallengeRequest()` 只要宿主定义了 `openChallenge` 就 `handledByHost = true`，即使宿主没调用 `claim()`，也不会挂降级面板；若宿主忘记 claim，剧情会卡住。建议用 `claimed` 判定，或加超时降级。
- 构建产物主 chunk 1.58MB（gzip 465KB），WebGAL 自身体量所致，非本次改动引入。

## 与本仓库的关系

当前 SPA 仍用自研 WebGAL 兼容子集引擎（设计书 §4.2 的 MVP 路线）；魔改后的 fork 引擎可作为
M6 的 Terre 自定义引擎候选。剧本格式两边兼容（`code/term/token/hint` 参数语义一致），
课程包无需重写。宿主接入点在 `window.CodeQuestEngine.registerHost`，届时 SPA 只需把
`Workbench`/`TerminalWorkbench` 适配成 `openChallenge` 宿主即可。
