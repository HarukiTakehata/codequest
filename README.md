# CodeQuest · 剧情驱动的编程学习系统

> 设计书：[docs/编程学习系统设计书.md](docs/编程学习系统设计书.md)（v0.2，2026-11-24）

把 galgame 式叙事演出（fork 自 [WebGAL](https://github.com/OpenWebGAL/WebGAL)）作为课程载体，用 OI/竞赛常用的 **输入输出比对判题** 作为过关机制。学生在浏览器里登录后写代码、直接运行、直接判定；支持 **C/C++（wasm-clang）、Shell（container2wasm + wasi-sh）、JavaScript、Python（Pyodide）** 四种语言，代码全部在浏览器 Worker/WASM 沙箱内执行。

## 状态

设计阶段。里程碑 M0（账号与课程下发）未开始——实现工作从 M0/M1 起步，详见设计书 §8。

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
