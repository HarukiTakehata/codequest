# CodeQuest TODOs

> 来源：2026-11-27 只读代码、测试与依赖审计。
> 本文记录待处理问题与修复进度；勾选项表示已完成并通过对应验收。设计决策仍以 `docs/编程学习系统设计书.md` 为事实源。

## P0：安全与正确性

- [x] **处理 Zod 高危漏洞**
  - 现状：`npm audit --omit=dev` 报告 `zod <4.6.6` 可因超大受限集合耗尽内存，公告 `GHSA-mrhx-c7xc-m3w5`。
  - 注意：不能直接运行 `npm audit fix --force`；Zod 4 为破坏性升级。
  - 处理：固定 `zod@4.6.7`，直接迁移到 Zod 4 core，并为 `z.record` 显式声明键和值 schema。
  - 验收：生产依赖审计无高危问题；现有 schema 与 API 测试全部通过。

- [x] **统一 `/me` 与临时改密门禁**
  - 现状：前端使用 `/api/v1/me`，但 `src/middleware/identity.ts` 只放行 `/auth/me`、`/auth/password`、`/auth/logout`。
  - 影响：`must_change_password=1` 的会话访问 `/me` 会返回 403；管理端可能进入连接异常页。
  - 相关：`apps/admin/src/api.ts`、`apps/web/src/api.ts`、`tests/backend/admin.test.ts`、`scripts/smoke-admin-api.mjs`。
  - 验收：临时密码会话可读取 `/me`，但仍不能访问课程/管理业务接口；前端能进入改密页。

- [x] **修正注册审计事件类型**
  - 现状：`src/routes/auth.ts` 的普通注册记录为 `"bootstrap"`。
  - 验收：注册记录为独立事件（如 `register`），bootstrap 仍记录为 `"bootstrap"`，并增加测试。

- [x] **统一初始化与课程包大小限制**
  - 现状：管理上传限制编码后 1.5 MB，但 `/api/v1/setup` 的 `course_pack` 没有相同限制。
  - 验收：初始化与管理上传使用同一大小校验；超限返回明确 4xx，不写库。

## P1：架构与测试一致性

- [x] **决定课程包主存储并消除 R2 漂移**
  - 现状：设计书称 D1 存元数据、R2 存包；实现却在 D1 保存完整 `pack_json`，再重复写 R2，读取始终走 D1。
  - 相关：`src/types.ts`、`src/lib/course.ts`、`src/routes/courses.ts`、`docs/编程学习系统设计书.md`、`docs/管理面板API.md`。
  - 验收：设计、schema、写入和读取路径一致；增加 R2/D1 两种路径测试；不再保留无读取者的重复数据。

- [x] **抽象数据库访问层**
  - 现状：路由与服务直接依赖 `D1Database` / `D1PreparedStatement`，SQL 与云厂商类型分散在业务代码中。
  - 处理：新增 `src/db` 的 `Database` / `DbStatement` 契约与 D1 适配器；请求上下文注入 `c.get("db")`，业务层不再引用 D1 类型；保留 Node SQLite 适配器测试。
  - 允许删库重建：当前未发布，`migrations/0001_init.sql` 与 `db/schema.sql` 是唯一基线，结构变化直接 `npm run db:reset`，不维护旧数据迁移。
  - 验收：`tests/backend/db-adapter.test.ts` 验证查询/写入/批量事务与源码守卫；全量测试与构建通过。

- [x] **抽象学习端课程接口并固定无课**
  - 现状：课程路由直接读取 `courses` 表与 WebGAL 兼容课程包，当前版本不再提供课程内容。
  - 处理：新增通用 `CourseProvider` / `AdminCourseProvider` 契约与默认空实现；学习端 `GET /api/v1/courses` 固定返回 `{ courses: [] }`，详情/整包/单文件固定 404；路由不再引用课程表、课程包读取或 WebGAL 类型。
  - 验收：`tests/backend/course-storage.test.ts` 校验默认 provider 与路由解耦；`m0` / `admin` 测试校验上传后学习端仍返回空目录；学习端空状态与管理端课程页提示当前版本不提供课程。

- [x] **统一初始化入口为 `/setup`**
  - 处理：删除管理面板初始化表单与 `/auth/bootstrap` 兼容路由，仅保留学习端四步向导和同一后端初始化服务。

- [x] **修复自由模式测试中的空断言**
  - 现状：`tests/backend/freeform.test.ts` 对非 Java 语言执行 `toContain("")`，断言恒为真。
  - 验收：每种语言都断言模板非空，并检查对应语言的有效代码标记。

- [x] **移除 c2w 测试的静默跳过与硬编码工件大小**
  - 现状：`tests/frontend/c2w-worker-bundle.test.ts` 在 dist/worker 不存在时直接返回，测试仍通过；硬编码 `59341603`。
  - 验收：无构建产物时明确 skip 或构建夹具；工件大小从当前 manifest 读取。

- [x] **统一后端测试迁移夹具**
  - 现状：`setup-page.test.ts` 只应用 0001/0002，`runtime-assets.test.ts` 只应用 0001，其他后端测试应用全部迁移。
  - 验收：共享“应用全部迁移”夹具；仅迁移兼容性测试保留显式旧版本迁移。

- [x] **减少脆弱测试**
  - 现状：部分测试精确匹配 CSS、skill 文档或历史性能文字，例如 `container-shell-enabled.test.ts` 断言 `"2.02s"`。
  - 验收：功能测试验证行为，源码守卫仅保留不可替代的安全约束；文档内容不参与功能测试通过判定。

- [x] **补齐缺失测试**
  - `/setup` 初始化。
  - 临时密码会话访问 `/me`。
  - 注册审计事件。
  - 课程包 R2 读写与失败回滚。
  - 初始化课程包超限。

## P2：文档、死代码与依赖清理

- [x] **更新已实现模块的 README**
  - `apps/web/README.md`。
  - `packages/judge/README.md`。
  - `packages/runtime-js/README.md`。
  - `packages/runtime-pyodide/README.md`。
  - `packages/runtime-clang/README.md`。
  - `packages/runtime-shell/README.md`。
  - 现状：均仍只写“规划中”。

- [x] **修正 Container Shell 过时说明**
  - 处理：删除旧 `cq-minimal` rootfs/spike 脚本与报告，当前只保留 `cq-dev-<language>` 五语言构建、转换和浏览器验收流程。

- [x] **更新协作者与运行环境说明**
  - `AGENTS.md` 的命令区仍是骨架状态，补充管理面板、浏览器验收、真实 D1 烟测命令。
  - 处理：`package.json`、`AGENTS.md`、学习端/管理面板 README 与维护 skill 统一为 Node.js `>=22.12.0`，满足 Wrangler 4 的引擎要求。
  - `README.md` 的“fork 自 WebGAL”描述与当前自研兼容子集实现不一致。

- [x] **清理确认无用的代码**
  - `src/routes/progress.ts`：未使用的 `HttpError` 导入。
  - `src/routes/admin.ts`：`bind()` 的未使用 `value` 参数。
  - `src/lib/session.ts`：无调用者的 `revokeUserSessions()`。
  - `apps/admin/src/components/ui.tsx`：无调用者的 `useDismissibleMessage()`。
  - 清理后启用严格的 `noUnusedLocals` / `noUnusedParameters` 检查。

- [x] **清理未使用依赖**
  - 根 `package.json` 的 `xterm-pty` 未使用；c2w Dockerfile 中的同包安装是独立链路。
  - 验收：`npm ls` 与代码引用检查通过，容器构建不受影响。

- [x] **修正过期运行提示**
  - `packages/runtime-clang/src/template.ts` 仍提示“尚未启用 wasm-clang 在线编译（M3）”。
  - 验收：错误文案准确描述当前模板模式缺少模板工件，不再引用未完成的 M3。

- [x] **移除管理面板占位状态**
  - `apps/admin/src/components/AdminShell.tsx` 的工作区名称“学习系统”和“在线”状态为硬编码。
  - 验收：显示真实实例名，或移除未经健康检查确认的在线状态。

- [x] **分批更新依赖**
  - 可先评估补丁/小版本：Hono、Wrangler、workers-types、lucide-react、React 类型等。
  - 主版本升级单独排期：Vite 8、Vitest 5、TypeScript 7、Monaco 0.58、ulid 3 等；Zod 4 已因 P0 安全修复完成迁移。
  - `@xterm/xterm@5.5.0` 是已知兼容性固定版本，不盲目升级。

## 总体验收清单

- [x] `npm audit --omit=dev` 无高危问题。
- [x] `npx tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters` 通过。
- [x] `npm test` 通过。
- [x] `npm run typecheck` 通过。
- [x] `npm run build` 通过。
- [x] `npm run test:admin` 通过。
- [x] 空本地 D1 上 `ADMIN_SMOKE_ALLOW_WRITE=1 npm run smoke:admin` 通过。
- [x] `npm run validate:course` 通过。
- [x] 文档不再将已实现模块标为规划中，也不再描述已移除的内存 Shell/R2 假回退行为。
