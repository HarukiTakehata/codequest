# RPGJS + Cloudflare 单边界架构设计

> 日期：2026-11-28
> 状态：当前有效设计，取代 v0.8 中关于 WebGAL、Terre、standalone、PC 客户端与 Docker 服务器版的决议。
> 设计事实源：`docs/编程学习系统设计书.md`；本文记录该决议的架构细节与验收边界。

## 1. 决策摘要

CodeQuest 采用以下唯一技术路线：

1. **游戏引擎只使用 RPGJS v5**，彻底废除 WebGAL 兼容层、WebGAL 剧本与 Terre 编辑器。
2. **不 fork RPGJS、CanvasEngine、PixiJS 或脚本解释器**，只使用官方 npm 包与公开扩展点。
3. **运行时只允许存在于 Cloudflare 与用户浏览器两端**：
   - Cloudflare Worker / Durable Object / R2 / D1 / Workers Static Assets；
   - 用户浏览器中的 React、RPGJS client、CanvasEngine/Pixi、Web Worker、WASM 与 IndexedDB/localStorage。
4. **不引入 VPS、独立游戏服务器、Electron/安装客户端、Docker 服务器版、RPGJS Studio 或其他运行时 SaaS**。
5. **RPGJS 使用 MMORPG 模式接入 Cloudflare Worker**，即使课程是单机内容，也由 Durable Object 持有权威房间状态。
6. **编辑器 UI 在浏览器运行**；地图模型、schema 校验、artifact 构建等纯逻辑由 Cloudflare Worker API 承担。
7. **学生代码只在浏览器专用 Worker/WASM 中执行**；Cloudflare Worker 只运行可信的引擎逻辑和教师课程逻辑，不执行学生代码。

## 2. 部署边界

```text
用户浏览器
 ├─ 学习端 React SPA
 ├─ 地图/事件/数据库编辑器 React SPA
 ├─ @rpgjs/client + CanvasEngine + PixiJS
 ├─ GUI、Monaco、xterm、音频、输入设备
 └─ 学生代码专用 Web Worker / WASM
        ↕ HTTPS / WebSocket
Cloudflare
 ├─ Worker：登录、权限、课程、进度、编辑器核心 API
 ├─ Durable Object：RPGJS 房间、地图、碰撞、事件、玩家状态
 ├─ R2：课程 artifact、TMX/TSX、PNG/OGG、运行时工件
 ├─ D1：账号、课程元数据、进度摘要、审计
 └─ Workers Static Assets：公开引擎壳与 vendored 运行时
```

边界之外不允许出现：

- VPS 或长期运行的自有服务器；
- 用户必须安装的桌面客户端；
- 第三方游戏服务器、RPGJS Studio、远程编辑器 SaaS；
- 运行时从 Kenney、itch、CDN、unpkg、jsDelivr 等第三方域名热链内容；
- 需要 Cloudflare 与浏览器之外的节点才能完成核心游戏流程。

构建期可以访问 npm 镜像、素材来源站点和 GitHub；这些内容必须打包、vendored 或登记后进入 Cloudflare，不能成为运行时依赖。

## 3. RPGJS 运行模式

### 3.1 客户端

浏览器使用官方 `@rpgjs/client`：

- `provideMmorpg()` 连接 Cloudflare Worker；
- `provideTiledMap()` 加载地图；
- `provideClientModules()` 注册精灵图、声音和 GUI；
- CanvasEngine/Pixi 负责渲染；
- React 工作台通过 GUI 适配层叠加到游戏场景。

### 3.2 服务端

Cloudflare Worker 使用官方 `@rpgjs/server/cloudflare`：

- `createRpgServerWorker()` 创建房间路由；
- `RpgServerDurableObject` 持有房间状态；
- `@rpgjs/tiledmap/server` 负责地图、碰撞、事件和属性；
- 玩家移动、NPC 状态机、变量、任务、战斗和地图切换在 Durable Object 内权威执行；
- 浏览器只发送输入并接收同步状态，不自行决定权威结果。

### 3.3 为什么不使用 standalone

`provideRpg(startServer)` 是浏览器进程内桥接，不是 Worker 隔离。为了满足“游戏流程在 Cloudflare 与浏览器两端运行”的统一边界，并复用官方 Cloudflare 适配器，所有课程统一使用 MMORPG 模式。单机课程只是房间中只有一名玩家，不改变协议和部署模型。

## 4. 编辑器架构

编辑器保留为浏览器 React SPA，不引入 Terre/Electron。

| 能力 | 运行位置 | 说明 |
|---|---|---|
| 地图绘制、事件摆点、数据库编辑、素材选择 | 浏览器 | React/DOM/Canvas 交互 |
| 地图模型与无损往返 | 浏览器 + Worker | 纯 TS 模型可在任一端执行 |
| schema、路径、尺寸、引用、许可校验 | Worker API | 上传和发布前强制校验 |
| TMX/TSX 生成、artifact 构建、哈希计算 | Worker API 或浏览器 Worker | 不在服务端执行学生代码 |
| 工程草稿 | 浏览器 localStorage/IndexedDB 或 D1/R2 | 第一版可先用浏览器本地草稿 |
| 预览 | 浏览器 RPGJS client | 连接同一个 Worker 房间 |

编辑器输出改为 RPGJS artifact：

```text
artifact.json
content/
  maps/*.tmx
  tilesets/*.tsx
  media/*.png
  sounds/*.ogg
  events/*.json
  database/*.json
challenges/*.json
judges/*.json
licenses/*
```

不再输出 `start.txt`，也不再实现 WebGAL 的 `say/choose/changeBg/changeFigure/bgm/-when` 解析器。

## 5. 课程与游戏流程

### 5.1 教师层

教师通过地图对象、事件块和数据库记录定义游戏流程：

- 对话、选项、分支；
- 条件变量、任务状态；
- 移动路线、传送、换图；
- 战斗、物品、技能；
- 挑战触发点与完成信号；
- 音乐、音效和天气。

这些内容由 Worker 中的 RPGJS server 权威执行。

### 5.2 学生层

学生脚本仍使用 `@rpgjs/script`：

- 编辑器声明、Worker 编译诊断、无头判题保持现有实现；
- 学生代码只在浏览器专用 Worker 中运行；
- 判题通过后，由挑战适配层把 effect 一次性提交给 Worker 房间；
- 失败 attempt 不进入权威世界；
- Cloudflare Worker 不执行学生源代码。

### 5.3 判题双轨

框架并行维护两条判题轨：

1. **stdio 轨**：JavaScript、Python、C/C++、Java、Shell 统一返回 `stdout/stderr/exitCode`，由纯 TS OI 判题器处理。
2. **世界状态轨**：RPGJS 学生脚本在浏览器 Worker 的 `SimWorld` 中断言 `state/effects/listeners/texts`。

两轨共享挑战 UI、goals、成绩和进度，但互不替代。c2w 只有 Shell/终端接口，因此 Shell 不提供结构化世界状态判题；文件、进程、端口检查必须写成 shell 探针并判定其 stdio/退出码。探索令牌通过 RPGJS GUI 输入，不读取容器内部状态。

### 5.4 挑战工作台

现有能力继续复用：

- `Workbench`：OI 与五语言运行时；
- `ScriptWorkbench`：RPGJS 场景脚本；
- `TerminalWorkbench`：container2wasm Shell；
- `GoalPanel` / `JudgePanel`。

承载方式从 WebGAL 的 `code/term/token/hint` 指令改为 RPGJS GUI/事件信号。

## 6. 内容、素材与存储

- 所有课程内容进入 Cloudflare R2，通过 Worker 鉴权下发；
- 所有运行时静态资源进入 Workers Static Assets 或 R2；
- Kenney 等素材下载后登记许可、SHA-256 和 MIME，再进入 R2；
- 运行时不得热链第三方素材地址；
- 隐藏判题数据继续进入 sealed 层，不提供读取路由；
- 引擎壳与课程内容分离，壳可公开缓存，内容必须鉴权。

## 7. 进度与存档

推荐进度结构：

```ts
{
  engine: "rpgjs",
  courseId: string,
  courseVersion: string,
  roomId: string,
  mapId: string,
  variables: Record<string, unknown>,
  challenges: Record<string, { passed: boolean; score: number }>,
  updatedAt: string
}
```

- Durable Object 持有当前房间权威状态；
- D1 保存课程级进度摘要；
- 浏览器可保留 RPGJS 本地存档用于恢复体验；
- 断线重连后以 Worker 状态为准，不接受客户端覆盖权威碰撞、任务或挑战结果。

## 8. 不 fork 框架的实现边界

允许的自研代码仅限：

- Cloudflare Worker 路由与 Durable Object 配置；
- React 编辑器与学习端 UI；
- 课程 artifact schema、构建器和校验器；
- RPGJS client/server 适配层；
- 挑战 GUI 与工作台桥接；
- `@rpgjs/script` 课程门面 API 与判题封装；
- 素材许可、哈希和分发流水线。

不允许通过修改 `node_modules`、patch 上游包或维护私有 fork 来绕过缺失能力。遇到 API 不满足时，优先使用公开 provider、resolver、GUI 组件和 transport 扩展点；确实无法实现的功能记录为上游阻塞项。

## 9. 当前实现与目标的差距

当前仓库已经完成：

- RPGJS v5 运行时依赖固定安装；
- `@rpgjs/script` Worker 判题与 ScriptWorkbench；
- 五语言浏览器运行时；
- Cloudflare Worker + D1/R2 基础；
- React 地图编辑器最小切片。

尚未完成：

- `createRpgServerWorker()` + Durable Object 真实房间；
- 浏览器 `provideMmorpg()` 连接；
- TMX/TSX 加载与编辑器 JSON 适配；
- 教师事件/数据库运行链路；
- 学生脚本 effect 提交真实世界；
- 管理端 artifact/媒体上传；
- WebGAL parser/executor/Stage 删除；
- Vite 6 与 `@rpgjs/vite` Vite 8 的统一。

## 10. 验收标准

1. 不安装任何客户端，使用现代浏览器即可编辑和学习。
2. 学习端、管理端、编辑器和 API 全部由 Cloudflare 提供。
3. 游戏连接 Cloudflare Durable Object；关闭浏览器后房间状态按策略保存或清理。
4. 地图、碰撞、事件、变量和挑战完成由 Worker 权威判定。
5. 学生代码只在浏览器 Worker/WASM 执行，服务端不接收可执行学生源码。
6. 课程素材与运行时工件均来自 Cloudflare，无第三方运行时热链。
7. 不依赖 WebGAL、Terre、RPGJS Studio 或框架 fork。
8. 完成「登录 → 编辑器创建地图 → 发布 → 学员进入 → 移动碰撞 → 打开挑战 → 脚本判题 → 效果提交 → 进度恢复」全链路烟测。
