# CodeQuest · 剧情驱动的编程学习系统

> 设计书：[docs/编程学习系统设计书.md](docs/编程学习系统设计书.md)（v0.9，2026-11-28）

把剧情演出与 2D 场景（RPGJS 先行，WebGAL 推迟）作为课程载体，用 OI/竞赛常用的 **输入输出比对判题** 作为过关机制。学生在浏览器里登录后写代码、直接运行、直接判定；支持 **C/C++（wasm-clang）、Shell（container2wasm 真实容器）、JavaScript、Python（Pyodide）、Java（teavm-javac）** 五种语言，代码全部在浏览器 Worker/WASM 沙箱内执行。成品按「引擎壳公开 + 课程内容鉴权」三桶存储，判题答案不下发。

## 状态

**当前设计（v0.9，2026-11-28）**：只使用 RPGJS v5，彻底废除 WebGAL/Terre；不 fork 框架。游戏服务端运行于 Cloudflare Worker + Durable Object，编辑器 UI 与游戏渲染运行于用户浏览器；不引入 VPS、安装客户端、Docker 服务器版或外部运行时 SaaS。详见 [RPGJS + Cloudflare 单边界架构设计](docs/RPGJS-Cloudflare架构设计.md)。

**已实现（当前仓库）**：M0 账号与课程下发、M1 剧情骨架、M2 双语言（JS 3 题 + Python 3 题）、
M2.5 Java（teavm-javac）、M3 C/C++ 浏览器内真编译、M4 Shell 真实容器常驻会话与 Bandit 式探索、M5 课程包格式。
**自由模式**（用户要求的优先功能）已实现：任选五语言、自定义测试点判题、草稿云端保存（见 [自由模式](docs/自由模式.md)）。
**管理面板第一版（M6.1）**已落地：教师/管理员可进行 CSV 预览与原子批量发号、24 小时一次性领取、学生账号管理、临时密码重置、课程上传/上下架、审计与概览；管理员额外管理教师账号和审计。学习端头部向教师/管理员显示“管理工作台”入口，默认 `/admin/`，可用 `ADMIN_URL` 指向独立子域（见 [管理面板说明](docs/管理面板.md)）。
**Container Shell** 已重新启用：课程列表独立入口运行 c2w 真实 Linux 容器，默认禁网；顶栏可选择 Shell / C/C++ / Java / Python / JavaScript 的 Alpine 开发环境，五种 wasm 工件均已生成并完成浏览器冒烟。Shell 启动实测约 2 秒；Java 环境内 `javac/java` 冒烟耗时更长。
**当前版本课程接口**已抽象为通用 `CourseProvider`，不绑定 WebGAL、剧本格式或课程包布局；默认实现固定无课——`GET /api/v1/courses` 返回空数组，课程详情/整包/单文件接口返回 404。课程包存储与 WebGAL 兼容引擎代码保留为后续实现，学习端与管理端 UI 暂不开放课程入口。
**数据库层**已抽象为 `Database` / `DbStatement` 契约，D1 只是适配器；业务路由不直接依赖 D1 类型。当前版本未发布，数据库结构以 `migrations/0001_init.sql` 为唯一基线，可直接用 `npm run db:reset` 删库重建。

现有剧情栈仍为历史 WebGAL 兼容子集，属于待删除代码；当前有效目标是 RPGJS Worker 房间 + 浏览器客户端。RPGJS 场景脚本的课程 API、无头判题、Worker 兼容包与 ScriptWorkbench 已落地，RPGJS v5 运行时依赖已固定安装；Cloudflare Durable Object、TMX/TSX 加载、编辑器 JSON 适配和真实世界 effect 提交尚未接通。内容类型见 [运行时基线](docs/RPGJS运行时与内容类型.md)，架构见 [RPGJS + Cloudflare 设计](docs/RPGJS-Cloudflare架构设计.md)，实现状态见 [实现说明](docs/实现说明.md)。

```bash
要求 Node.js >= 22.12.0。
npm install --registry https://registry.npmmirror.com
cp .dev.vars.example .dev.vars   # 填入 TOKEN_PEPPER
npm run db:migrate && npm run dev # http://localhost:8787
npm run dev:admin                 # 管理面板 http://localhost:5174（API 代理到 8787）
npm test                         # 判题 / 运行时 / 后端 / 剧情验收
npm run test:rpgjs               # RPGJS API / 判题 / 工作台 / fixture
C2W_BROWSER=/path/to/chromium npm run test:rpgjs:browser # 真实浏览器 Worker 烟测
npm run test:admin               # 管理面板 Chromium 交互验收
C2W_BROWSER=/path/to/chromium npm run test:web # 学习端显式路由 Chromium 验收
npm run container:list           # 列出五语言 Alpine 开发容器
npm run container -- all --test  # 构建并冒烟全部语言镜像
npm run container:c2w -- all --no-build # 转换为浏览器 WASM
npm run deploy                       # 自动构建/校验后发布；等价 wrangler deploy
npm run validate:course -- courses/demo
```

数据库迁移已压为单一 `migrations/0001_init.sql` 发布基线，并与 `db/schema.sql` 保持一致。新库直接执行 `npm run db:migrate`；已应用旧 `0001`–`0004` 的开发库需先备份并执行 `npm run db:reset`，再重新应用基线。

演示课程位于 `courses/demo/`（五语言 17 题 + Bandit 式令牌关），验收：`npm run validate:course`。
第三方工件许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 仓库布局

| 路径 | 内容 |
| --- | --- |
| `docs/` | 设计书（v0.9）、RPGJS/Cloudflare 架构、运行时内容类型、课程包格式、实现说明 |
| `src/` / `migrations/` | Workers 后端（Hono + D1 适配层）：登录、发号、进度；课程接口当前固定无课 |
| `apps/web` | 学习端 SPA（React + 剧情舞台 + Monaco 工作台 + shell 终端） |
| `apps/admin` | 管理面板 SPA（批量发号、账号、课程、审计）；构建产物发布到 `deploy/admin/` |
| `packages/judge` | 判题器（纯 TS，前后端共用同一实现） |
| `packages/i18n` | 学习端与管理面板共享的语言字典、locale 解析与 Provider |
| `packages/rpgjs-script` | RPGJS 课程 API、无头脚本判题与 Worker 边界 |
| `packages/runtime-*` | 各语言运行时（js / pyodide / clang / java / shell） |
| `courses/demo` | 可玩演示课程（五语言 17 题） |
| `scripts/` | 课程打包/验收、容器构建、浏览器验收 |
| `engine/` | 预留目录；当前 `apps/web/src/engine/` 是待删除的 WebGAL 兼容子集 |
| `apps/editor` | RPGJS 浏览器地图编辑器；事件/数据库/素材/发布能力待补齐 |

## 历史 fork（已废除）

以下仓库仅保存历史记录，不再是 CodeQuest 依赖：

- [HarukiTakehata/WebGAL](https://github.com/HarukiTakehata/WebGAL)
- [HarukiTakehata/WebGAL_Terre](https://github.com/HarukiTakehata/WebGAL_Terre)

## 补充文档

- [RPGJS 自造 API、部分世界判定与失败回滚（部分实现）](docs/补充设计-RPGJS自造API与回滚判题.md)（2026-11-28）
- [RPGJS v5 运行时与内容类型基线](docs/RPGJS运行时与内容类型.md)（2026-11-28）
- [RPGJS + Cloudflare 单边界架构设计](docs/RPGJS-Cloudflare架构设计.md)（2026-11-28）
- [美术资源 URL 清单（按许可三档排序）](docs/美术资源URL清单.md)（2026-11-28）
- [编辑器 / RPGJS 判题 / 美术素材实施分工](docs/实施分工-20261128.md)（2026-11-28）

## 协作约定

见 [AGENTS.md](AGENTS.md)。

## RPGJS 自建地图编辑器（M6d 最小切片）

`apps/editor` 是独立 React + Vite 应用，与 Terre/WebGAL 编辑器无关，不依赖 RPGJS Studio 或 SaaS。提供 20 × 15、32px 的网格地图，四种程序化占位图块，画笔/橡皮/矩形填充，碰撞层与事件层编辑，localStorage 自动保存，以及严格校验的 Tiled JSON 导入/导出下载。界面接入 `@codequest/i18n`，语言入口仅为单个图标菜单。

```bash
npm run dev:editor        # http://localhost:5175
npm run build:editor      # 独立产物 apps/editor/dist/
npm run build             # 同源嵌入产物 apps/web/dist/editor/
C2W_BROWSER=/path/to/chromium npm run test:editor
```

完整构建后，Worker 在 `/editor`、`/editor/*` 提供编辑器 HTML 深层回退，静态资源固定从 `/editor/assets` 读取；缺失资源返回 404，不会回退到学习端或管理端。当前仅实现地图切片，不包含事件块、数据库、素材库、TMX/TSX 与 Worker 发布；导出 JSON 声明 `media/codequest-placeholder.png` 路径，但本切片不生成该 PNG，完整 Tiled 可视素材需在后续素材工作流中补齐。v0.9 不开发 PC 壳。
