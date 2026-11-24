# CodeQuest 管理面板（M6.1）

独立 React 19 / Vite SPA，用于教师和管理员管理课程、学生账号、批量发号与审计。登录支持用户名或邮箱，用户邮箱可为空。学生账号不能进入管理面板。接口契约见仓库根目录 `docs/管理面板API.md`。当前版本学习端课程接口固定返回空目录，管理面板课程页仅展示说明，不提供上传/上下架入口；底层课程存储与接口保留给后续实现。

## 本地开发

Node.js >= 22.12.0。依赖安装遵循仓库约定，使用国内镜像：

```bash
npm --registry https://registry.npmmirror.com install
npm run dev:admin
```

- 开发地址：<http://localhost:5174>
- `/api` 开发代理目标：`http://localhost:8787`
- 生产构建：`apps/admin/dist/`（独立子域根路径产物）。
- 同源嵌入：`npm run build:admin:embedded` 生成 `apps/web/dist/admin/`，由 Worker 在 `/admin/` 提供；`npm run build` 与 `npm run dev` 会自动生成。
- 本地预览：`npm --workspace @codequest/admin run preview`

启动管理面板前，请先按仓库 README 启动 API（`npm run dev:api`）。空实例会跳转到学习端唯一初始化入口 `/setup`；独立学习端子域通过 `LEARNER_URL` 定位。教师和管理员可进入面板，学生会话会收到 403 提示。学习端头部仅向教师/管理员显示“管理工作台”入口，地址由 `ADMIN_URL` 配置，默认 `/admin/`。

## 脚本

```bash
npm --workspace @codequest/admin run dev
npm --workspace @codequest/admin run build
npm --workspace @codequest/admin run typecheck
npm --workspace @codequest/admin run preview
```

## 路由

| 路径 | 页面 |
|---|---|
| `/`、`/overview` | 概览统计与最近记录 |
| `/batches` | CSV 发号向导、批次历史与撤销 |
| `/accounts` | 学生/教师搜索、角色与状态筛选、分页、显示名、启停和密码重置；仅管理员可改角色 |
| `/courses` | 课程包上传、版本信息与上下架 |
| `/audit` | 管理审计记录（仅管理员） |

路由使用 History API。Vite dev/preview 支持深链接回退；`public/_redirects` 为兼容 Cloudflare Pages 的静态托管回退。VPS nginx 部署时仍应将非 `/api` 的未知路径回退到 `index.html`，并将 `/api/v1/*` 反代到 Worker。

## 认证与凭据安全

- 复用 `/api/v1/auth/status`、`/api/v1/auth/login`、`/api/v1/auth/logout`、`/api/v1/me` 与 `/api/v1/auth/password`。
- 管理接口严格使用 `/api/v1/admin`，请求携带同源 HttpOnly 会话 Cookie。
- 不在 localStorage/sessionStorage 中保存密码、会话、token、CSV 或一次性下载地址。
- CSV、指定密码与上传课程 JSON 仅保留在当前组件内存中；成功创建或关闭对应流程后立即清理。
- 发号下载地址与重置临时密码仅在响应到达后展示一次，不写入日志或分析事件；剪贴板复制只由用户主动操作触发。
- `public/_headers` 配置了 `no-referrer`、点击劫持防护、内容安全策略和静态资源缓存策略。

## 课程包上传

上传请求为 `{ "pack": Record<string, string> }`，例如：

```json
{
  "course.json": "{\"id\":\"demo\",\"slug\":\"demo\",\"title\":\"示例课程\"}",
  "start.txt": " dialogue:start\n欢迎来到 CodeQuest"
}
```

客户端只检查 JSON 外层结构、1.5 MB 编码大小上限和 `course.json` 是否存在；完整 schema、入口文件、挑战与判题配置均由服务端校验。相同 slug 上传会创建新版本并自动上架。服务端配置 R2 时将正文写入版本化对象、D1 仅保存元数据；本地未配置 R2 时使用 D1 正文列。
