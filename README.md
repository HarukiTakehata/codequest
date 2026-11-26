# CodeQuest · 剧情驱动的编程学习系统

> 设计书：[docs/编程学习系统设计书.md](docs/编程学习系统设计书.md)（v0.4，含 Java/M2.5 与 M6 管理端部署，2026-11-25）

把 galgame 式叙事演出（fork 自 [WebGAL](https://github.com/OpenWebGAL/WebGAL)）作为课程载体，用 OI/竞赛常用的 **输入输出比对判题** 作为过关机制。学生在浏览器里登录后写代码、直接运行、直接判定；支持 **C/C++（wasm-clang 在线编译）、Shell（container2wasm 真实容器）、JavaScript、Python（Pyodide）、Java（teavm-javac）** 五种语言，代码全部在浏览器 Worker/WASM 沙箱内执行。

## 状态

**第一版最小可用（v0.2）已实现**：M0 账号与课程下发、M1 剧情骨架、M2 双语言（JS 3 题 + Python 3 题）、
M2.5 Java（teavm-javac）、M3 C/C++ 浏览器内真编译、M4 Shell 真实容器常驻会话与 Bandit 式探索、M5 课程包格式。
**自由模式**（用户要求的优先功能）已实现：任选五语言、自定义测试点判题、草稿云端保存（见 [自由模式](docs/自由模式.md)）。
**管理端部署骨架**已落地：管理面板与 Terre 编辑器使用 `admin.` / `editor.` 独立子域，nginx + Docker Compose 单套发布，跨子域复用管理员会话（见设计书 §7.3）。
**Container Shell** 已重新启用：课程列表独立入口运行 c2w 真实 Linux 容器，默认禁网；顶栏可选择 Shell / C/C++ / Java / Python / JavaScript 的 Alpine 开发环境，五种 wasm 工件均已生成并完成浏览器冒烟。Shell 启动实测约 2 秒；Java 环境内 `javac/java` 冒烟耗时更长。模拟内核 loopback 已通过（见 [spike 报告](docs/spike-M3-M4.md)）。
详见 [实现说明](docs/实现说明.md) 与 [课程包格式](docs/课程包格式.md)，里程碑以设计书 §8 为准。

```bash
npm install --registry https://registry.npmmirror.com
cp .dev.vars.example .dev.vars   # 填入 TOKEN_PEPPER
npm run db:migrate && npm run dev # http://localhost:8787
npm test                         # 判题 / 运行时 / 后端 / 剧情验收
npm run container:list           # 列出五语言 Alpine 开发容器
npm run container -- all --test  # 构建并冒烟全部语言镜像
npm run container:c2w -- all --no-build # 转换为浏览器 WASM
```

演示课程位于 `courses/demo/`（五语言 17 题 + Bandit 式令牌关），验收：`npm run validate:course`。
第三方工件许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 仓库布局

| 路径 | 内容 |
|---|---|
| `docs/` | 设计书（v0.4）、课程包格式、实现说明、M3/M4 spike 报告 |
| `src/` / `migrations/` | Workers 后端（Hono + D1）：登录、发号、课程下发、进度 |
| `apps/web` | 学习端 SPA（React + 剧情舞台 + Monaco 工作台 + shell 终端） |
| `apps/admin` | 管理端（规划中，当前为 API + 手写课程包） |
| `packages/judge` | 判题器（纯 TS，前后端共用同一实现） |
| `packages/runtime-*` | 各语言运行时（js / pyodide / clang / java / shell） |
| `courses/demo` | 可玩演示课程（五语言 17 题） |
| `scripts/` | 课程打包/验收、M2.5/M3/M4 spike |
| `engine/` | fork 自 WebGAL 的剧情引擎（规划；当前用自研兼容子集） |

## 相关 fork（同账号）

- [HarukiTakehata/WebGAL](https://github.com/HarukiTakehata/WebGAL) ← OpenWebGAL/WebGAL（MPL-2.0）
- [HarukiTakehata/WebGAL_Terre](https://github.com/HarukiTakehata/WebGAL_Terre) ← OpenWebGAL/WebGAL_Terre

## 协作约定

见 [AGENTS.md](AGENTS.md)。
