# CodeQuest · 剧情驱动的编程学习系统

> 设计书：[docs/编程学习系统设计书.md](docs/编程学习系统设计书.md)（v0.8，2026-11-27）

把剧情演出与 2D 场景（RPGJS 先行，WebGAL 推迟）作为课程载体，用 OI/竞赛常用的 **输入输出比对判题** 作为过关机制。学生在浏览器里登录后写代码、直接运行、直接判定；支持 **C/C++（wasm-clang）、Shell（container2wasm 真实容器）、JavaScript、Python（Pyodide）、Java（teavm-javac）** 五种语言，代码全部在浏览器 Worker/WASM 沙箱内执行。成品按「引擎壳公开 + 课程内容鉴权」三桶存储，判题答案不下发。

## 状态

**设计方向（v0.8，2026-11-27）**：首发只做 RPGJS；WebGAL 引擎型推迟、不排期；**Terre 不做 serverless 改造**；编辑器源码在 `HarukiTakehata/WebGAL_Terre` fork 的 **`dev` 分支**（4.6.7 / `d155f41b`），交付 **PC 客户端 + Docker 服务器版**，两者共用登录/发布系统（设计书 §7.4、`docs/创作端-PC与Docker.md`）。

**已实现（当前仓库）**：M0 账号与课程下发、M1 剧情骨架、M2 双语言（JS 3 题 + Python 3 题）、
M2.5 Java（teavm-javac）、M3 C/C++ 浏览器内真编译、M4 Shell 真实容器常驻会话与 Bandit 式探索、M5 课程包格式。
**自由模式**（用户要求的优先功能）已实现：任选五语言、自定义测试点判题、草稿云端保存（见 [自由模式](docs/自由模式.md)）。
**管理面板第一版（M6.1）**已落地：教师/管理员可进行 CSV 预览与原子批量发号、24 小时一次性领取、学生账号管理、临时密码重置、课程上传/上下架、审计与概览；管理员额外管理教师账号和审计。学习端头部向教师/管理员显示“管理工作台”入口，默认 `/admin/`，可用 `ADMIN_URL` 指向独立子域（见 [管理面板说明](docs/管理面板.md)）。
**Container Shell** 已重新启用：课程列表独立入口运行 c2w 真实 Linux 容器，默认禁网；顶栏可选择 Shell / C/C++ / Java / Python / JavaScript 的 Alpine 开发环境，五种 wasm 工件均已生成并完成浏览器冒烟。Shell 启动实测约 2 秒；Java 环境内 `javac/java` 冒烟耗时更长。
**当前版本课程接口**已抽象为通用 `CourseProvider`，不绑定 WebGAL、剧本格式或课程包布局；默认实现固定无课——`GET /api/v1/courses` 返回空数组，课程详情/整包/单文件接口返回 404。课程包存储与 WebGAL 兼容引擎代码保留为后续实现，学习端与管理端 UI 暂不开放课程入口。
**数据库层**已抽象为 `Database` / `DbStatement` 契约，D1 只是适配器；业务路由不直接依赖 D1 类型。当前版本未发布，数据库结构以 `migrations/0001_init.sql` 为唯一基线，可直接用 `npm run db:reset` 删库重建。

现有剧情栈为自研 WebGAL 兼容子集；RPGJS 引擎型、三桶成品存储与 PC/Docker 创作端是 v0.8 目标，尚未实现。详见 [实现说明](docs/实现说明.md) 与 [课程包格式](docs/课程包格式.md)，里程碑以设计书 §8 为准。

```bash
要求 Node.js >= 22.12.0。
npm install --registry https://registry.npmmirror.com
cp .dev.vars.example .dev.vars   # 填入 TOKEN_PEPPER
npm run db:migrate && npm run dev # http://localhost:8787
npm run dev:admin                 # 管理面板 http://localhost:5174（API 代理到 8787）
npm test                         # 判题 / 运行时 / 后端 / 剧情验收
npm run test:admin               # 管理面板 Chromium 交互验收
npm run container:list           # 列出五语言 Alpine 开发容器
npm run container -- all --test  # 构建并冒烟全部语言镜像
npm run container:c2w -- all --no-build # 转换为浏览器 WASM
```

数据库迁移已压为单一 `migrations/0001_init.sql` 发布基线，并与 `db/schema.sql` 保持一致。新库直接执行 `npm run db:migrate`；已应用旧 `0001`–`0004` 的开发库需先备份并执行 `npm run db:reset`，再重新应用基线。

演示课程位于 `courses/demo/`（五语言 17 题 + Bandit 式令牌关），验收：`npm run validate:course`。
第三方工件许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 仓库布局

| 路径 | 内容 |
| --- | --- |
| `docs/` | 设计书（v0.8）、管理/创作端、课程包格式、实现说明 |
| `src/` / `migrations/` | Workers 后端（Hono + D1 适配层）：登录、发号、进度；课程接口当前固定无课 |
| `apps/web` | 学习端 SPA（React + 剧情舞台 + Monaco 工作台 + shell 终端） |
| `apps/admin` | 管理面板 SPA（批量发号、账号、课程、审计）；构建产物发布到 `deploy/admin/` |
| `packages/judge` | 判题器（纯 TS，前后端共用同一实现） |
| `packages/runtime-*` | 各语言运行时（js / pyodide / clang / java / shell） |
| `courses/demo` | 可玩演示课程（五语言 17 题） |
| `scripts/` | 课程打包/验收、容器构建、浏览器验收 |
| `engine/` | 预留的 WebGAL 集成目录；当前剧情引擎位于 `apps/web/src/engine/`，为自研 WebGAL 兼容子集 |
| `apps/desktop`（规划） | PC 客户端壳（v0.8：Electron，登录/更新/加载 Terre 编辑器/发布） |
| `packages/publish-client`（规划） | 发布 SDK（CLI/PC/Docker BFF/Web 共用） |
| `deploy/docker/`（规划） | Docker 服务器版（Terre server + BFF + compose） |

## 相关 fork（同账号）

- [HarukiTakehata/WebGAL](https://github.com/HarukiTakehata/WebGAL) ← OpenWebGAL/WebGAL（MPL-2.0）
- [HarukiTakehata/WebGAL_Terre](https://github.com/HarukiTakehata/WebGAL_Terre) ← OpenWebGAL/WebGAL_Terre

## 协作约定

见 [AGENTS.md](AGENTS.md)。
