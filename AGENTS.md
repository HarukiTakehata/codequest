# AGENTS.md · CodeQuest 协作者规范

> 模板参照 March7thTeam/boardroom 的 AGENTS.md。本文件约束在此仓库内工作的 AI/人类协作者。

## 项目事实源

- 设计决策与排期的唯一事实源是 `docs/编程学习系统设计书.md`；改设计先改文档再动代码。
- 里程碑（M0-M7）与验收标准见设计书 §8；每个 PR 应注明所属里程碑。

## 命令约定

要求 Node.js >= 22.12.0。依赖安装统一走国内镜像：`npm --registry https://registry.npmmirror.com`。

```bash
npm install --registry https://registry.npmmirror.com
cp .dev.vars.example .dev.vars            # 填入 TOKEN_PEPPER
npm run db:migrate                        # 仅应用本地 D1 迁移
npm run dev                               # 构建学习端 + Wrangler：http://localhost:8787
```

需要前后端热更新时，分开运行：

```bash
npm run dev:api                           # Worker API：http://localhost:8787
npm run dev:web                           # 学习端 Vite：http://localhost:5173，代理 /api 与 /runtime
npm run dev:admin                         # 管理面板：http://localhost:5174，代理 /api 到 8787
```

### 构建、测试与课程验收

```bash
npm run typecheck
npm run build                             # 学习端 + 管理面板 + /admin 嵌入产物 + c2w worker patch
npm test                                  # 判题、运行时、后端、剧情与前端守卫
npm run validate:course
npm run test:admin                        # 管理面板 Chromium 交互验收；可用 CHROMIUM_PATH 指定浏览器
```

### Container Shell 浏览器验收

以下命令需要已生成的运行时工件、本地 R2 上传（仅 `test:runtime-route`）和 Chromium/Edge；用 `C2W_BROWSER` 指定可执行文件。

```bash
npm run container:list
npm run container:test                    # Podman 中五语言镜像真实编译/运行冒烟
npm run container:c2w -- all --no-build   # 转换为 runtime/cq-dev-<lang>.wasm.gz
npm run runtime:upload                    # 校验清单后上传本地 R2

npm run build:web
C2W_BROWSER=/path/to/chromium npm run test:terminal-vim
npm run test:shell-container -- /tmp/opencode/cq-dev-shell.wasm /path/to/chromium
C2W_BROWSER=/path/to/chromium npm run test:container-selector

# 另一个终端保持 npm run dev 运行：
C2W_BROWSER=/path/to/chromium npm run test:runtime-route
```

### 真实本地 D1 烟测

烟测会写入数据，只允许空数据库和本地 API。使用独立持久化目录，避免重置开发库：

```bash
npx wrangler d1 migrations apply codequest_local --local --persist-to /tmp/opencode/codequest-admin-smoke-db
npx wrangler dev --local --persist-to /tmp/opencode/codequest-admin-smoke-db --port 8787
# 另一个终端：
ADMIN_SMOKE_ALLOW_WRITE=1 npm run smoke:admin
```

脚本拒绝非本地 `ADMIN_API_URL`；不要把该写入开关用于远端或已有数据的数据库。

发布基线说明：`migrations/` 仅保留 `0001_init.sql`，与 `db/schema.sql` 完全一致。已应用旧 `0001`–`0004` 的本地开发库需先执行 `npm run db:reset`，再应用新基线；新库直接执行 `npm run db:migrate`。

## 边界与红线

1. **不修改第三方技能/上游仓库**：WebGAL / WebGAL_Terre / container2wasm 等上游的变更走各自 fork 仓库（HarukiTakehata/WebGAL、HarukiTakehata/WebGAL_Terre），主仓库只做依赖与集成。
2. **剧本格式保持 WebGAL 兼容子集**：`scenes/*.txt` 的语法与扩展指令（code/term/token/hint）一旦定型，任何破坏性变更需先更新设计书并征得仓库所有者同意。
3. **判题器是纯 TS 纯函数**：不引入浏览器/Node 专属 API，保证前端与 Worker 侧（防作弊回放）复用同一实现。
4. **用户代码只在 Worker/WASM 沙箱执行**：任何把用户代码放到主线程或服务端执行的改动直接拒绝。
5. **提交标注**：Agent 产生的提交在 commit message 末尾附一行 `🤖 自动提交：Hermes Agent`。
6. 提交署名：Haruki Takehata <haruki-takehata@yang-qwq.top>。

## 测试与验收

- 每个里程碑先写验收标准（设计书 §8），实现完成以**实测证据**验收，不采信自报。
- 判题/运行时相关的改动必须附带可复现的测试用例（挑战 + 判题配置 + 预期结果）。
