# 补充设计：RPGJS 自造 API、部分世界判定与失败回滚（提案 → 部分实现）

> 日期：2026-11-28｜状态：**部分实现**｜关联：设计书 §4.2.2（学生场景脚本）、§5.3（判题器）、§4.4（素材与编辑器工作流）
> 2026-11-28 落地：`packages/rpgjs-script` 已固定依赖 `@rpgjs/script@5.3.0`，实现课程 API、core 薄封装、fresh-world 判题、attempt ledger 与 Worker；`ScriptWorkbench` 与 `oi | script` judge schema 已接入。真实 RPGJS 游戏世界的“影子试跑后提交”与 ledger 持久化仍未实现。

## 1. 背景与范围

设计书 §5.3 已有两条判题路径：OI 题走统一 `stdout/exitCode` diff；RPGJS 题走 `@rpgjs/script/testing` 的 `runTests` 行为断言。本文讨论两件事：

1. 是否能在 RPGJS 脚本里提供课程专属 API（目标是学生写 `game.player.move(way, 4)` 这类代码）；
2. 是否能按**部分 RPGJS 世界状态**判定，并在单次运行未达标时**回滚**。

另外对 container2wasm（c2w）交互方式做了对照，结论是**不作为本期方向**：c2w 暴露的是字节流 stdio 与 shell 命令协议，没有语义 API/事件层，与本提案不是同一抽象层；细节只保留第 2 节的差异摘要。

## 2. 与 c2w 交互模型的差异（对照，不展开）

| | c2w / shell 轨 | RPGJS 轨（本文） |
| --- | --- | --- |
| 编辑器产物 | shell 脚本文本 | `export function` 脚本 / AST |
| 控制对象 | 文件、进程、命令输出（OS 层） | 地图事件、GUI、玩家状态（语义层） |
| 通道 | stdin/stdout 字节流 + 随机 marker 协议 | `compileProgram` / `simulate` / `runTests` + 信号 + `$map.*` |
| 自定义 API | 只能做镜像内 helper 命令 + 课程清单 | core 层 `ApiDescription` / `ApiImpl` 可扩展 |
| 判定 | stdout 比对、exitCode、文件/进程状态 | `effects` / `state` 行为断言 |
| 确定性 | 弱：超时、输出体积、termios 都要兜底 | 强：解释器内执行，无外部副作用 |

结论：两轨只在适配层相似（编辑器文本 → 运行器输入 → 结构化结果 → 编辑器诊断），执行层不要混用。设计书 §5.5.1 写「9p 挂载初始文件系统」，但当前 dev 快照实现是 **base64 shell 写文件**注入；本文不依赖该说法。

## 3. 自造 API：可行，但分两层

### 3.1 官方高层入口只开放三件事

- 自定义信号：`new ScriptService({ signals: { "quests.start": { payload: {...} } } })`，脚本里 `on(...)` 监听，宿主 `service.emit(...)`；编辑器侧 `checkScript(source, catalog, { signals })`、`simulate({ signals })`、`runTests(..., signals)` 可校验。
- 信号绑定：`signalBinding({ signal, scope, hook, describe, emit })` + `provideScripts({ bindings: [...] })`，把引擎 hook 转成信号。
- 外部服务：`ScriptService({ http: { connections } })` → 脚本里 `$http`。

**限制（源码实证）**：`ScriptService` 构造函数把 `description` 硬编码为 `GAME_API_DESCRIPTION + signals/http`；`checkScript` 内部 `descriptionWith(...)` 也写死同一份描述。因此**没有官方选项**插入 `$quest`、`teach()`、`game` 这类新名字。

### 3.2 core 层可以扩展

`packages/script/src/core/api.ts` 暴露 `ApiDescription` / `ApiImpl` / `apiInfo` / `globalNames` / `hostFromApi` / `missingImplementations` / `describeApi`；配合 `compileProgram` 可自建薄封装：

- `ApiDescription` 描述名字、签名、文档，编译器据此拒绝未知名字，并生成编辑器补全声明；
- `ApiImpl` 由宿主实现，游戏与判题共用同一份描述；
- `missingImplementations(desc, impl)` 返回空数组可证明描述与实现严格对齐，适合进 CI。

已验证 spike：`API_PARITY []`；声明含自定义名字；脚本里自定义调用与原生 `$map.createDynamicEvent()` 混用可编译、可执行；拼错名字在编译期被拒。

### 3.3 目标 API：`game.player.move(way, times)`

原生脚本 API **没有** `$player.move(way, n)`：可用的是 `$player.teleport({x,y})`、`$player.moveRoutes(routes)`、`$map.moveEvent(id, pos, opts)`、`$player.canMove`。文档 `docs/guide/testing.md` 里的 `player.move({ x: 10, y: 0 })` 是引擎集成测试的 `client.player` 对象，不是脚本语言 API，不能照抄。

设计映射（嵌套句柄）：

```ts
// ApiDescription（节选）
game: { doc: "课程门面", members: { player: { handle: "gamePlayer" } } }
gamePlayer: { nested: true, methods: {
  move: { sig: "(way: string, times: number): void", doc: "朝 way 走 times 步" }
} }

// ApiImpl（节选）
move: (w, [way, times]) => {
  if (!ROUTE_STEPS.includes(way)) throw new Error(`bad way: ${way}`);
  if (!Number.isInteger(times) || times < 1 || times > 100) throw new Error(`bad times: ${times}`);
  w.engine.call("player.moveRoutes", [[{ [way]: times }]]);
}
```

- `ROUTE_STEPS` 沿用 RPGJS `server/world.ts` 的白名单（`up/down/left/right/tileUp/.../towardPlayer/...`），重复次数上限 100，与引擎一致；非法参数在宿主抛错，拼错名字在编译期拒绝。
- `w.engine.call("player.moveRoutes", ...)` 复用 RPGJS 自己的引擎效果名，真实游戏桥接与模拟世界看到同一个效果。
- `describeApi(api)` 已确认生成 `move(way: string, times: number)` 声明，可直接喂给 Monaco 的 extra lib。

**两个坑**：

1. `checkScript` / `runTests` 写死原生描述，不能直接校验 `game.*`；编辑器校验与判题必须用自建薄封装（core 层 API + 同一份 `ApiDescription`/`ApiImpl`）。
2. `SimWorld` 中 `moveRoutes` 只**记录效果**，不改 `player.x/y`；部分状态判定要断言 `effects` 里的 `player.moveRoutes` 参数（方向、步数），不是 `player.x/y`。真实游戏桥接才会改坐标。

## 4. 部分世界判定 + 失败回滚

### 4.1 可行性分层

| 层 | 是否可行 | 依据 |
| --- | --- | --- |
| 模拟判定（`simulate` / 自建 wrapper） | **可行且现成** | `execute()` 每次调用 `new SimWorld(init)`；失败尝试的世界直接丢弃；`runTests` 每个用例也重建世界（实测第一个用例扣 5 gold，第二个仍从 10 开始） |
| 运行中途断点回滚 | 需自建 | `snapshot()` 只读，无 restore；`WorldInit` 也不完整（脚本自建事件的 `made` 集合、事件计数器、已消耗骰子队列、effects 历史都不在快照里） |
| 真实游戏运行时回滚 | **不可原生实现** | `ScriptService` 直接写 RpgPlayer，没有事务；只能「影子试跑通过后再提交」，或写显式逆操作（反方向 + 同一步数），后者脆弱不推荐 |

### 4.2 判定模型：checkpoint = 不可变 `WorldInit` + 脚本版本

```
attempt(init, script, expect):
  world = new SimWorld(init)          // 每次全新，天然隔离
  run(script, world)
  verdict = judge(partial_view(world), expect)
  失败 → 丢弃 world；下一次从同一个 init 重建    // 回滚即重放
```

**部分状态来源**（现成，无需改引擎）：`SimulateResult.state`（`player.*`、`events.*`、`vars.*`、`mapVars.*`、`state.*`、`shared.*`）、`effects`（有序效果名+参数）、`value`、`listeners`、`uncovered`。原生 `expect` 支持 `effectsInclude/Exclude`、`texts`、`returns`、路径期望（`player.gold`、`events.guard.x`）、范围 `{min,max}`；自定义 wrapper 可扩展 `effect:<name>:<path>` 断言效果参数。

**建议**：把一次提交建模为**一个完整 attempt**，不要拆成互相依赖的中间状态；需要跨回合时，用确定性重放（`WorldInit.seed` + `dice`/`choices` 队列），而不是在运行中恢复世界。

### 4.3 实跑证据（2026-11-28）

spike 输出：

```
API_PARITY []
DECLARATION_HAS_GAME_MOVE true
BAD         pass:false  ["bad way: diagonal", "missing effect player.moveRoutes", "player.gold=10 expected 5"]
SUBTLE_BAD  pass:false  ["effect:player.moveRoutes:args.0.0.up=2 expected 4"]  gold:5
AFTER_ROLLBACK pass:true   effects:["player.moveRoutes","gold"]  gold:5
FRESH_WORLD_PER_TEST first gold:5, second gold:5
```

`SUBTLE_BAD` 特意让脚本**已经改了 gold 且发出了移动效果**，只是步数错；重放后得到干净正确状态，说明回滚丢弃的是真实部分副作用，而非空转。

### 4.4 提交层建议

- 学生脚本先在影子 `SimWorld` 试跑 → 判定 → **只提交通过的那次**到真实游戏/课程状态；
- 记 `AttemptLedger { initHash, scriptHash, effects, partialState, verdict }`，供复查/申诉与防作弊回放；
- 如后续确需中途 checkpoint，优先在自建 wrapper 里做 journal + 确定性重放，不改 RPGJS 上游；给 `SimWorld` 加 restore 属于 fork 行为，与设计书 §1.2「最小改动复用上游」冲突。

## 5. 落地清单与验收

1. 先只用原生 API + `simulate`/`runTests` 验证部分状态期望覆盖度（M1a 判题 spike）。
2. 再上 `game.*` 自定义句柄：编辑器声明、宿主实现、判题实现三处共用同一 `ApiDescription`；`missingImplementations` 进 CI。
3. 提交层实现「影子试跑 + ledger + 仅提交通过结果」；禁止对用户可见世界做直接 undo。
4. 验收标准：同一 `init` 下，失败 attempt 的 effects/state 不泄漏到下一次；非法 `way`/`times` 编译期或宿主期被拒；`game.player.move("up", 4)` 产生 `player.moveRoutes` 效果且参数可断言；`describeApi` 含自定义声明；`missingImplementations` 为空。

## 6. 实现状态（2026-11-28）

| 项 | 状态 | 落点 / 证据 |
| --- | --- | --- |
| 课程 API 与声明同源 | 已完成 | `packages/rpgjs-script/src/api.ts`、`editor.ts`；flat/nested parity 均为空 |
| core 薄封装与无头判题 | 已完成 | `judge.ts`；`call/fire/emit`、部分 state、effects 与 `effect:<name>:<path>` |
| fresh-world 失败重放 | 已完成 | 每个 case/attempt 新建 `SimWorld`；SUBTLE_BAD fixture 已验证无泄漏 |
| Worker 与编辑器工作台 | 已完成 | `client.ts`/`worker.ts`；`ScriptWorkbench` 只经 Worker 检查/运行/判题，Stage 按 `judge.kind` 分流 |
| attempt ledger | 部分完成 | 已在内存结果中记录 `initHash/scriptHash/effects/partialState/verdict`；尚未持久化或接后端申诉 |
| 真实游戏影子试跑与提交 | 未完成 | 需 Cloudflare RPGJS Worker/Durable Object 与浏览器客户端房间；不得对可见世界直接 undo |
