# @codequest/rpgjs-script

RPGJS 场景脚本的课程 API、无头判题与 Worker 边界薄封装。直接依赖钉死的
`@rpgjs/script@5.3.0`，不 fork RPGJS，也不使用 `eval`。

## 课程 API

学生只看到：

```ts
game.player.move(way: string, times: number): void;
```

- `game.player` 在内部映射到 `gamePlayer` 句柄；`gamePlayer` 不会进入编译器全局名、
  Host 全局对象或 Monaco 声明。
- `ROUTE_STEPS` 按 5.3.0 `dist/server/index.js` 的 `ROUTE_STEPS +
  ROUTE_PLAYER_STEPS` 核对。`wait` 是延迟而不是移动方向，因此不包含在 `way` 中。
- `times` 必须是 `1..100` 的整数。
- 实现复用 `world.engine.call("player.moveRoutes", ...)`。`SimWorld` 只记录效果，
  不更新玩家坐标，所以移动断言使用
  `effect:player.moveRoutes:args.0.0.up`。

`COURSE_API_DESCRIPTION` 同时服务编辑器、编译器与宿主。CI 可断言：

```ts
import { missingImplementations } from "@rpgjs/script/core";
import {
  COURSE_API_DESCRIPTION as courseDescription,
  COURSE_API_IMPL as courseImplementation,
  missingCourseImplementations,
} from "@codequest/rpgjs-script";

missingImplementations(courseDescription, courseImplementation); // []
missingCourseImplementations(); // []：上游 parity + 嵌套句柄 parity
```

`COURSE_API_DECLARATIONS` / `describeCourseApi()` 返回可直接放入 Monaco extra lib
的声明文本。`CourseGameApi`、`CoursePlayerApi` 是对应的 TypeScript 编辑器模型。

## 检查与判题

核心入口均为纯 TS：

```ts
import { checkScript, simulate, judgeScript } from "@codequest/rpgjs-script";

const checked = checkScript(source, { requiredExports: ["move"] });
const simulation = await simulate({ source, call: { fn: "move" }, world: init });
const report = await judgeScript({ source, init, cases });
```

`judgeScript` 也支持 `judgeScript(source, cases, options)`。每个 case 和每次调用都会
新建 `SimWorld`；case 的 `world` 合并覆盖顶层 `init`，不会修改传入对象。失败 attempt
的世界直接丢弃，下一次从相同 `init` 重放，不对真实游戏世界做逆操作。

`expect` 支持：

- 任意安全点分状态路径：`player.gold`、`vars.x`、`mapVars.x`、`state.x`、
  `events.guard.x`、`shared.x` 等；
- `{ min, max }` 数值范围；
- `returns`、`page`、`error`；
- `effects`、`effectsInclude`、`effectsExclude`；
- `texts`、`notifications`；
- `effect:<name>:<path>`，例如 `effect:player.moveRoutes:args.0.0.up: 4`。

每个 case 的 `ledger` 含 `initHash`、`scriptHash`、有序 `effects`、扁平点分路径的
`partialState` 与 `verdict`。哈希是纯 TS FNV-1a，用于确定性审计/重放标识，不是加密签名。

## Worker 边界

主线程只导入 client：

```ts
import { runScript } from "@codequest/rpgjs-script/client";

const report = await runScript({ source, init, cases, timeoutMs: 10_000 });
```

Client 为每次运行创建独立 module Worker，在完成、报错、超时或 `AbortSignal` 取消时
终止它。解释器与判题器不要从主线程入口导入；`./worker` 子路径只供 Worker 入口使用。

## 本地验收

```bash
npx vitest run packages/rpgjs-script/tests
npx tsc -p packages/rpgjs-script/tsconfig.json --noEmit
npx tsc -p tsconfig.json --noEmit
C2W_BROWSER=/path/to/chromium npm run test:rpgjs:browser
```
