# 创作端：PC 客户端与 Docker 服务器版（历史归档）

> **已废除（2026-11-28）**：v0.9 只保留浏览器 Web 编辑器，运行边界仅允许 Cloudflare 与用户浏览器。本文不再构成实现要求；当前设计见 [RPGJS + Cloudflare 单边界架构设计](RPGJS-Cloudflare架构设计.md)。

> 历史状态：v0.8 拍板（2026-11-27），已被 v0.9 取代。
> 编辑器源码在独立 fork 仓库的 **`dev` 分支**：**`HarukiTakehata/WebGAL_Terre@dev`**（Terre 派生，4.6.7，当前 `d155f41b`；已具备剧本/素材/预览等基础编辑功能）；codequest 主仓库只做登录、发布与两种交付形态的集成，不复制编辑器源码。
> 关联：`docs/编程学习系统设计书.md` §3 / §4.4 / §7.3 / §7.4 / §7.5 / §8。

## 1. 两种形态，一套系统

| 形态 | 运行位置 | 工程文件 | 登录方式 | 适用 |
|---|---|---|---|---|
| PC 客户端 | 用户桌面（Electron） | 本地目录 | Bearer（main 进程持有） | 个人/离线作者 |
| Docker 服务器版 | 学校/团队服务器（容器） | 服务器卷 `/data` | BFF 会话 cookie | 不能装客户端、多人共用一台服务器 |

两者加载**同一份编辑器构建**，共用同一套账号、课程、版本与发布 API；差别只在运行环境、工程存储位置和会话形态。

**首发范围**：Terre（WebGAL）课程创作。RPGJS 课程创作仍走 CLI / 自建编辑器（设计书 M6d），不在本文范围。

## 2. 编辑器源码在 fork 的 dev 分支

- 仓库/分支：`HarukiTakehata/WebGAL_Terre@dev`（fork 自 `OpenWebGAL/WebGAL_Terre`，MPL-2.0）。
- 基线：4.6.7，当前 `d155f41b3f36ced65fca4e35bcaa0d7fcd91d221`（2026-11-16）；`main` 不是开发基线，构建/镜像一律取 `dev` 并钉 SHA。
- 现状：`dev` 已含剧本编辑、素材管理、预览、模板/自定义引擎等能力；本次新增的是**登录、发布、打包与两种交付形态**。
- 同步策略：fork 的 `dev` 定期 merge 上游 `OpenWebGAL/dev`；登录/发布提交叠在 `dev` 之上，升级只改钉住的 SHA 并跑回归。
- 边界：codequest 主仓库只维护 `packages/publish-client`、认证 API 约定、Docker 编排与文档；编辑器 UI/业务改动进 fork，两边通过版本号与接口契约同步。
- 不做：Terre serverless 化、把 Terre 重写成浏览器 File System Access 形态。

## 3. 共同层：登录

| 端点 | 用途 |
|---|---|
| `POST /api/auth/login` | 账号密码 + 设备/实例名 → access（15 分钟）/ refresh（30 天） |
| `POST /api/auth/refresh` | 刷新并轮换 refresh token |
| `POST /api/auth/logout` | 注销当前设备会话 |
| `GET /api/auth/me` | 角色、可发布课程列表 |

- 账号、角色、`users` / `sessions` 与 Web 端同库；`sessions.kind = web | desktop | server`，可按设备/实例吊销。
- 首次登录强制改密、注册默认关闭、管理员批量发号规则沿用设计书 §7.1。
- 发布权限按 `publisher` / `admin` 校验，三端共用同一套中间件。
- **PC**：main 进程用 `safeStorage` 加密保存 refresh token；renderer 不接触 token，请求经 IPC 由 main 附带 Bearer。
- **Docker**：BFF 持有上游 token，浏览器只拿 HttpOnly + Secure + SameSite=Lax 的会话 cookie；写请求带 CSRF token。

## 4. 共同层：发布

`packages/publish-client` 是唯一实现，CLI、PC、Docker BFF、Web 管理端都调它：

```
hashTree(dir) → requestTickets(files) → uploadBlobs(concurrency) → publish(artifact) → verify()
```

- 端点复用设计书 §7.3.4：`POST /api/admin/upload-tickets`、`POST /api/admin/courses/:id/publish`、`GET /api/admin/courses/:id/version`。
- Node 侧流式 `sha256`、multipart（5MiB 分片）、断点续传；不受浏览器 100MB 请求体 / 128MB 内存限制。
- 预检三端一致：登录态、角色、`shellVersion` 兼容、素材许可、路径安全、隐藏用例分流。
- 客户端/BFF 不内置 R2 密钥，只用 15 分钟单 key 预签名 URL。

## 5. PC 客户端（Electron）

- 直接复用 fork 的 Electron 构建，新增登录窗口、发布面板、自动更新；编辑器主体不改。
- 工程 = 用户选择的本地目录（Terre 既有行为），不上传工程文件、不做云草稿；单实例锁 + 目录锁。
- main：认证、token、文件系统、哈希/打包、直传、更新；renderer：编辑器 + 登录/发布 UI；`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 更新：Windows NSIS / macOS dmg（签名+公证）/ Linux AppImage；`electron-updater` + 签名源；P0 可先内测未签名。

## 6. Docker 服务器版

**定位**：同一编辑器跑在容器里，浏览器打开即用，登录后才能在服务器卷上建工程、发布。

- **单容器单租户**：Terre 是单用户桌面架构，工程目录是全局状态；一个容器服务一个老师/一个团队，卷 `/data` 独立。多租户需要 Terre 做 per-user 根目录改造，不在本期。
- **进程模型**：
  - `editor`：fork 的 Terre NestJS 服务，只监听 `127.0.0.1:3000`，不对宿主机暴露；
  - `bff`：唯一对外端口（如 `8080`），负责登录页、会话 cookie、CSRF、静态资源与 `/api` 反向代理、`/publish` 调用 `publish-client`。
- **登录**：`/login` 表单 → BFF 调 `POST /api/auth/login` → 写会话 cookie；未登录访问任何编辑器路由都 302 到 `/login`；退出调 logout 并清 cookie。
- **工程存储**：`/data/projects` 挂卷；BFF 以固定 uid 运行，rootfs 只读；备份 = 卷快照/`tar`，升级只换镜像不动卷。
- **发布**：BFF 侧 Node 流式哈希与上传，浏览器不参与大文件传输，也不需要给 R2 配浏览器 CORS。
- **配置**（环境变量）：

| 变量 | 说明 |
|---|---|
| `CQ_API_BASE` | codequest API 地址 |
| `CQ_COOKIE_SECRET` | 会话 cookie 签名密钥 |
| `CQ_INSTANCE_NAME` | 实例名（写入 session/审计） |
| `CQ_PUBLISH_ROLE` | 允许发布的角色（默认 `publisher`） |

- **交付**：`deploy/docker/Dockerfile`（多阶段：`TERRE_REF=dev`、`TERRE_SHA=<pin>` 构建 → 运行镜像）+ `docker-compose.yml`；健康检查 `/healthz`；镜像钉 digest。
- **升级**：镜像 tag 与 fork commit 对应；数据卷不变；回滚 = 换回旧 tag。

## 7. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M6a 创作端公共层 | 认证端点（Bearer + 刷新轮换）、`packages/publish-client`、登录 UI 组件 | CLI 用同一 SDK 发布成功；三端登录拿到同一账号与角色 |
| M6b PC 客户端 | fork `dev`（`d155f41b`）的 Electron 构建 + 登录/发布/自动更新 | 登录后打开本地工程、发布成功；Web 端看到同一版本 |
| M6c Docker 服务器版 | fork `dev`（`d155f41b`）的 Terre server + BFF 镜像、登录页、卷、compose、备份说明 | `docker compose up` 后浏览器登录、建工程、发布全流程通过；未登录访问被拦截 |
| M6d RPGJS 自建编辑器 | Web 构建（可复用 PC 壳打包） | 按设计书 §4.4 验收 |

## 8. 风险

| 风险 | 对策 |
|---|---|
| Terre 单用户架构不适合多租户 | 明确单容器单租户；多租户列为后续改造，不在本期承诺 |
| Docker 里 Terre 依赖 Electron 专有 API | 启动参数走 server 模式；CI 冒烟覆盖登录/打开工程/预览/打包/发布；不支持的菜单项隐藏 |
| 会话与 CSRF | HttpOnly/Secure/SameSite=Lax + CSRF token；BFF 统一鉴权，Terre 不直接暴露 |
| 签名/公证成本 | P0 内测未签名并提示；公测前办证书；Docker 版不受影响 |
| PC 与 Docker 行为漂移 | 登录/发布只存在于共享 SDK 与 BFF，编辑器主体同源；CI 对同一 fixture 断言 |
| 卷数据丢失 | 文档化备份/恢复；升级不动卷；可选定时快照 |
