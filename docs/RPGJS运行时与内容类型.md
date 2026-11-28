# RPGJS v5 运行时与内容类型基线

> 日期：2026-11-28
> 设计事实源：`docs/编程学习系统设计书.md` §2.5
> 适用范围：CodeQuest 的 RPGJS 课程引擎、自建地图编辑器与美术素材流水线。

## 1. 运行时依赖基线

完整 RPGJS v5 运行时已于 2026-11-28 按以下版本直接固定安装，避免仅依赖 `@rpgjs/script` 的传递依赖：

| 包 | 版本 | 用途 |
|---|---|---|
| `@rpgjs/client` | `5.5.1` | 浏览器客户端、CanvasEngine/Pixi 渲染、GUI、音频与地图场景 |
| `@rpgjs/server` | `5.4.1` | 游戏服务端、地图/事件/战斗/房间；CodeQuest 部署于 Cloudflare Worker + Durable Object |
| `@rpgjs/tiledmap` | `5.0.3` | Tiled 地图、瓦片集、碰撞与事件集成 |
| `@rpgjs/script` | `5.3.0` | 沙箱化 JavaScript 子集解释器与无头判题 |
| `canvasengine` | `2.6.0` | RPGJS 客户端渲染与组件运行时 |
| `pixi.js` | `8.23.0` | WebGL/Canvas 纹理与精灵渲染 |
| `@canvasengine/presets` | `2.6.0` | CanvasEngine 预设组件与地图能力 |

构建工具另行固定为 `@rpgjs/vite@5.0.6` 与 `@canvasengine/compiler@2.5.0`。当前仓库学习端、管理端和编辑器仍使用 Vite 6；`@rpgjs/vite` 自身依赖 Vite 8，因此**仅安装构建工具，不在现有 Vite 配置中启用**。升级 Vite 并完成真实 Worker 房间/地图冒烟前，不把“依赖已安装”写成“引擎已接入”。

## 2. 支持的内容类型

RPGJS v5 核心是 2D 引擎。以下“支持”指官方运行时或构建插件具有对应路径；实际解码能力仍受浏览器限制。

| 内容 | 支持格式 / 形式 | HTTP MIME 建议 | 约束 |
|---|---|---|---|
| Tiled 地图 | `.tmx` | `application/xml` 或 `text/xml` | 默认地图 ID 与文件名一致 |
| Tiled 瓦片集 | `.tsx` | `application/xml` 或 `text/xml` | 可引用外部 PNG/JPEG/WebP/SVG 等图片 |
| Tiled 图片 | `.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`、`.svg` | 对应 `image/*` | 官方 `tiledMapFolderPlugin` 默认白名单 |
| 角色/道具/动画精灵图 | 推荐 `.png`；Pixi 纹理管线支持 JPEG、WebP、AVIF | 对应 `image/*` | 必须提供帧尺寸；GIF 不自动等于逐帧精灵动画 |
| 精灵图集 | PNG/JPEG/WebP/AVIF 等图片 + Atlas JSON | `image/*` + `application/json` | JSON 必须符合 Pixi spritesheet 结构 |
| 表情图 Faceset | 单张网格图片，推荐 PNG | `image/png` | 配置表达式帧坐标 |
| 音频/BGM/音效 | 推荐 `.mp3`、`.ogg`；WAV 可用 | `audio/mpeg`、`audio/ogg`、`audio/wav` | AAC/M4A/FLAC/Opus/WebM 音频取决于浏览器与 Howler 编码检测 |
| GUI 图片 | 图片 URL | 对应 `image/*` | 标题画面、背景、按钮等 |
| 脚本 | JavaScript 子集文本 | 通常 `application/json` 包装或 UTF-8 文本 | `@rpgjs/script` 解析字符串，不提供文件 MIME 白名单 |
| 数据库 | TypeScript/JavaScript 对象 | 不适用 | 物品、技能、职业、状态、自定义记录 |

默认 Tiled 构建插件的完整扩展名白名单为：

```text
.tmx .tsx .png .jpg .jpeg .gif .webp .svg
```

Tiled JSON 地图（`.json`）**不在默认白名单内**。可以使用 `provideLoadMap()` 自定义加载和渲染，但需要自行提供地图数据、碰撞与渲染组件；不能仅把扩展名加入白名单就视为已支持。

## 3. 非核心内容

- **3D 模型**：`.gltf`、`.fbx`、`.obj` 等没有内置运行时支持。
- **视频**：没有核心视频内容管线；WebM 仅在音频路径中可能出现。
- **字体文件**：可通过 CanvasEngine 文本样式或 CSS 使用，但不是 RPGJS 的独立资产类型。
- **GIF 动画**：Pixi 提供 GIF 组件，但 RPGJS 的 spritesheet 动画不会自动读取 GIF 帧。

## 4. CodeQuest 接入建议

1. **统一使用 MMORPG 房间模式**。浏览器 `provideMmorpg()` 连接 Cloudflare `createRpgServerWorker()` + Durable Object；单机课程只是单玩家房间，不再使用 standalone 进程内桥接。
2. **保留脚本判题与完整引擎的边界**。`@rpgjs/script/testing` 继续在浏览器 Worker 负责确定性判题；Cloudflare 只运行可信引擎和教师事件逻辑，不执行学生源码。判题通过后再由适配层向 Worker 房间提交 effect。
3. **明确编辑器 JSON 的适配方案**。当前 `apps/editor` 导出 Tiled JSON。接入默认 Tiled 运行时前，必须二选一：
   - 在导出/发布前转换为 TMX + TSX；或
   - 实现 `provideLoadMap()` 适配层，并补齐碰撞、事件和渲染契约。
4. **素材流水线采用分级白名单**。第一档仅接受许可明确的 PNG 瓦片/精灵图和 OGG/MP3 音频；Atlas JSON 必须与图片一起登记哈希和许可。不要用“浏览器能打开”替代“运行时已验证”。
5. **HTTP 层返回正确 MIME**。R2/Worker 静态分发应使用本文 MIME 建议，尤其是 SVG、XML、OGG 和 WAV；不得把所有媒体都返回 `application/octet-stream`。
6. **构建升级单独排期**。现有 Vite 6 与 `@rpgjs/vite` 的 Vite 8 依赖尚未对齐。启用 `rpgjs()` / `tiledMapFolderPlugin()` 前，需先升级并验证学习端、管理端、编辑器和 Worker 构建。

## 5. Kenney 素材选用建议

- **Tiny Town / Tiny Farm / Tiny City**：使用 PNG 瓦片；地图改用 TMX，或为编辑器 JSON 实现适配层。
- **UI Pack**：PNG 适合 GUI 与精灵图。
- **音频包**：优先 OGG，MP3 作为兼容备选；WAV 仅用于短音效。
- **像素素材**：保持最近邻缩放，避免 JPEG 压缩和模糊滤波。
- **3D 素材包**：当前 RPGJS 2D 运行时不可直接使用。
- **许可**：Kenney 资产页标为 CC0，可商用且无需署名；不要单独分发 Kenney Logo。实际入库仍按项目许可登记流程保存来源、版本和哈希证据。

## 6. 官方依据

- Spritesheets：<https://v5.rpgjs.dev/guide/spritesheets>
- Sounds：<https://v5.rpgjs.dev/guide/sounds>
- TiledMap：<https://v5.rpgjs.dev/tiled>
- 自定义地图加载：<https://v5.rpgjs.dev/advanced/provide-load-map>
- 项目结构：<https://v5.rpgjs.dev/guide/structure>
- Quick Start：<https://v5.rpgjs.dev/guide/quick-start>

## 7. 安装与验收状态（2026-11-28）

- `npm ls`：运行时与构建工具版本均符合 §1 基线。
- `npm test`：56 个文件、324 项通过。
- `npm run test:rpgjs`：7 个文件、43 项通过。
- `npx tsc -p packages/rpgjs-script/tsconfig.json --noEmit`：通过。
- `npm run build`：学习端、管理端、编辑器及内嵌产物构建通过。
- `C2W_BROWSER=/usr/bin/microsoft-edge npm run test:rpgjs:browser`：通过，输出 `RPGJS_WORKER_BROWSER_PASS`。
- 全量 `npm run typecheck` 仍被既有管理端改动阻断：`apps/admin/src/lib/browser.ts` 缺少 `./api`、`AccountsPage.tsx` 存在未使用变量/`unknown` 渲染类型错误、`packages/i18n/src/zh.ts` 存在未声明 i18n 键。本次未修改这些文件。
- **尚未完成**：Cloudflare Durable Object 房间、`provideMmorpg()`、Tiled TMX 加载、编辑器 JSON 适配、effect 提交、Vite 8 构建升级和真实地图浏览器冒烟。整体边界见 [RPGJS + Cloudflare 单边界架构设计](RPGJS-Cloudflare架构设计.md)。
