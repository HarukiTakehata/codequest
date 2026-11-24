# CodeQuest · 剧情驱动的编程学习系统

> 设计书：[docs/编程学习系统设计书.md](docs/编程学习系统设计书.md)（v0.2，2026-11-24）

把 galgame 式叙事演出（fork 自 [WebGAL](https://github.com/OpenWebGAL/WebGAL)）作为课程载体，用 OI/竞赛常用的 **输入输出比对判题** 作为过关机制。学生在浏览器里登录后写代码、直接运行、直接判定；支持 **C/C++（wasm-clang）、Shell（container2wasm + wasi-sh）、JavaScript、Python（Pyodide）** 四种语言，代码全部在浏览器 Worker/WASM 沙箱内执行。

## 状态

**第一版最小可用（v0.1）已实现**：M0 账号与课程下发、M1 剧情骨架、M2 双语言判题（JS + Python）全部打通；
C/C++ 以预编译 wasm 模板模式、Shell 以内存文件系统教学子集提供可玩形态。详见
[实现说明](docs/实现说明.md) 与 [课程包格式](docs/课程包格式.md)，里程碑仍以设计书 §8 为准。

```bash
npm install --registry https://registry.npmmirror.com
cp .dev.vars.example .dev.vars   # 填入 TOKEN_PEPPER
npm run db:migrate && npm run dev # http://localhost:8787
npm test                         # 判题 / 运行时 / 后端 / 剧情验收
```

演示课程位于 `courses/demo/`（四语言 + Bandit 式令牌关卡），验收：`npm run validate:course`。

## 仓库布局（规划）

| 路径 | 内容 |
|---|---|
| `docs/` | 设计书与开发文档 |
| `apps/web` | 学习端 SPA（React + 剧情舞台 + Monaco 工作台 + xterm.js 终端） |
| `apps/admin` | 管理端（课程包上传/编辑、批量发号） |
| `packages/judge` | 判题器（纯 TS，前后端共用同一实现） |
| `packages/runtime-*` | 各语言执行运行时（pyodide / js / wasm-clang / shell） |
| `engine/` | fork 自 WebGAL 的剧情引擎（打包为 Terre 自定义引擎） |

## 相关 fork（同账号）

- [HarukiTakehata/WebGAL](https://github.com/HarukiTakehata/WebGAL) ← OpenWebGAL/WebGAL（MPL-2.0）
- [HarukiTakehata/WebGAL_Terre](https://github.com/HarukiTakehata/WebGAL_Terre) ← OpenWebGAL/WebGAL_Terre

## 协作约定

见 [AGENTS.md](AGENTS.md)。
