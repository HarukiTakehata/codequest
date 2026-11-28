# CodeQuest 学习端（apps/web）

React 19 + Vite 构建的浏览器学习端 SPA。账号、课程包、进度与自由模式草稿通过 Workers API 存取；用户代码由各语言 Worker/WASM 运行时执行，主线程不运行用户代码。当前版本课程接口固定返回空目录，课程详情/内容接口返回 404；剧情引擎与课程包代码保留为后续实现。

## 已实现能力

- 实例初始化、用户名或邮箱登录/登出、临时密码修改、课程列表与课程包拉取。
- 显式 History API 页面路由：支持课程/自由模式/Container Shell 深链接、刷新恢复、浏览器前进/后退和登录后返回原目标页。
- 自研 WebGAL 兼容剧本子集：对话、选项、变量与 `-when` 门控、背景/立绘演出、BGM 指令、标签跳转、代码/终端挑战、令牌门、提示与结束事件。
- 课程挑战工作台：Monaco 编辑、stdin、运行、逐测试点判题、加权分、首个失败点 diff、过程 goals 与进度保存。
- 五语言运行：JavaScript Worker、Pyodide、wasm-clang 在线编译、teavm-javac、container2wasm Shell 常驻容器。
- 自由模式：五语言独立草稿、自定义测试点与比对模式、运行/判题、按用户和语言云端保存。
- Container Shell：独立全屏 xterm 终端与五语言 Alpine 开发环境选择；课程探索终端和 Shell 脚本判题也复用同一套容器运行时。
- 中英文界面、明暗主题、容器下载/启动进度；clang/java 公共运行时资产由 Service Worker 预缓存。

剧情格式与挑战配置见 [课程包格式](../../docs/课程包格式.md)，自由模式见 [自由模式说明](../../docs/自由模式.md)，容器细节见 [Container Shell](../../docs/Container-Shell.md)。

## 入口与实现落点

| 路径 | 作用 |
|---|---|
| `src/main.tsx` | React 挂载、国际化/主题 Provider、Service Worker 注册 |
| `src/App.tsx` | 初始化/登录认证门禁、页面渲染、课程包与进度加载 |
| `src/router.ts` | 学习端 History API 路由解析、深链接与前进/后退 |
| `src/engine/parser.ts` / `executor.ts` | WebGAL 兼容子集解析与逐条剧情执行 |
| `src/components/Stage.tsx` | 课程剧情舞台与挑战/令牌门调度 |
| `src/components/Workbench.tsx` | 代码/Shell 脚本工作台、判题与 goals |
| `src/components/FreeMode.tsx` | 自由模式与草稿保存 |
| `src/components/ContainerShell.tsx` / `TerminalWorkbench.tsx` | 独立终端与课程探索终端 |
| `src/runners.ts` | 按语言懒加载运行时；Shell 必须走常驻容器会话 |
| `src/api.ts` | 学习端 API 与自由模式草稿接口 |
| `vite.config.ts` | 开发代理、跨源隔离头、ESM Worker 与 c2w 资产配置 |

运行时包位于 `packages/runtime-*`；Container Shell 的 wasm 工件存放在 R2，经 `/runtime/cq-dev-<language>.wasm` 提供，不能放入 `public/`（Workers Assets 单文件限制）。

## 页面路由

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | 学习端入口 | 按初始化/登录状态替换到 `/setup`、`/login` 或 `/courses` |
| `/setup` | 实例初始化 | 仅空实例使用 |
| `/login` | 登录 | 未登录使用；受保护深链接登录后返回原目标页 |
| `/password` | 首次登录强制改密 | 仅 `must_change_password=true` 的会话 |
| `/courses` | 课程与实验场列表 | 需登录 |
| `/courses/:courseId` | 课程剧情与挑战舞台 | 刷新时重新拉取课程包与进度 |
| `/free` | 自由模式 | 需登录 |
| `/container` | 独立 Container Shell | 需登录且功能开关允许 |
| `*` | 学习端 404 | 已登录用户显示提示与返回课程页链接 |

路由由 `src/router.ts` 的 History API 实现，不引入额外路由依赖。已知页面路径由 Worker 显式回退到学习端 `index.html`；个人资料继续使用弹窗，挑战 ID 到剧情指针映射稳定前不提供挑战级深链接。

## 本地开发

要求 Node.js >= 22.12.0。在仓库根目录执行：

```bash
npm install --registry https://registry.npmmirror.com
cp .dev.vars.example .dev.vars   # 填入 TOKEN_PEPPER
npm run db:migrate
npm run dev                       # 先构建学习端，再由 Wrangler 提供 http://localhost:8787
```

需要 Vite 热更新时，在两个终端分别运行：

```bash
npm run dev:api                   # http://localhost:8787
npm run dev:web                   # http://localhost:5173，代理 /api 与 /runtime 到 8787
```

Container Shell 需要本地 R2 中已有运行时工件；缺失时按 [Container Shell 文档](../../docs/Container-Shell.md) 的流程转换并上传。

教师和管理员登录后，头部会显示“管理工作台”入口；学生不显示。本地开发在 `.dev.vars` 设置 `ADMIN_URL=http://localhost:5174`，生产默认 `/admin/`，独立子域部署时设置为完整 HTTPS 地址。

## 构建与测试

```bash
npm run build:web                 # Vite 构建并 patch c2w workers
npm run build                     # 学习端 + 管理面板 + /admin 嵌入产物
npm run typecheck                 # 后端 + 学习端 + 管理面板
npm test                          # 判题、运行时、后端、剧情与前端守卫
npm run validate:course           # 演示课程包校验
C2W_BROWSER=/path/to/chromium npm run test:web # 学习端路由 Chromium 验收
```

常用定向测试：

```bash
npx vitest run tests/engine tests/frontend tests/acceptance
npx vitest run packages/judge/tests/judge.test.ts
npx vitest run packages/runtime-js/tests/exec.test.ts
npx vitest run packages/runtime-pyodide/tests/python.test.ts tests/frontend/pyodide-worker.test.ts
npx vitest run packages/runtime-clang/tests/template.test.ts tests/acceptance/cpp.test.ts
npx vitest run tests/frontend/shell-container-session.test.ts tests/frontend/c2w-runtime-cache.test.ts
```

真实浏览器验收需要本机 Chromium/Edge（可用 `C2W_BROWSER` 指定路径）与已生成的运行时工件：

```bash
npm run build:web
C2W_BROWSER=/path/to/chromium npm run test:terminal-vim
npm run test:shell-container -- /tmp/opencode/cq-dev-shell.wasm /path/to/chromium
C2W_BROWSER=/path/to/chromium npm run test:container-selector

# 先启动 npm run dev，并在本地 R2 上传 Shell 工件，再运行：
C2W_BROWSER=/path/to/chromium npm run test:runtime-route
```

`npm test` 中的 Container Shell 测试覆盖源码守卫、缓存与协议构造；真实 Bochs 容器行为以上述浏览器脚本为准。
