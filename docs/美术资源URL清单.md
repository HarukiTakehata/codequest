# 美术资源 URL 清单（来自参考会话，按许可三档排序）

> 来源会话：`@session:default/2768c75dabf0`（2026-11-27 核查）；URL 复核：2026-11-28。
> 排序：**开源/可商用 > 需教育许可 > 不可用/仅参考**。本文只登记候选来源与 URL；实际入库前仍须按设计书 §4.4.1 / §4.4 的许可登记流程二次核验。
> 可达性图例：✅ 200；⚠️ 反爬/网络受限（会话内 `web_extract` 曾成功读取）；🔴 当前 404/失效。直连 `curl` 对 GitHub 偶发 000，不能据此判死链。

## 1. 第一档：开源 / 可商用（可直接入课程包，义务仅署名或无）

| 资源 | 详细 URL | 许可 / 义务 | 用途与处置 |
|---|---|---|---|
| RPGJS 引擎（v5） | 仓库 https://github.com/RSamaium/RPG-JS ；v5 分支 https://github.com/RSamaium/RPG-JS/tree/v5 ；许可 https://github.com/RSamaium/RPG-JS/blob/v5/LICENSE | MIT，无额外义务 | 引擎与官方示例代码可直接复用 |
| Davidvitas「RPG Music Pack」 | 原始署名页 🔴 https://www.davidvitas.com/portfolio/2016/5/12/rpg-music-pack （2026-11-28 直连 404，会话中由 v3 模板 README 提供） ；许可 https://creativecommons.org/licenses/by/4.0/deed.en ；v3 模板文件 https://github.com/rpgjs/template/blob/HEAD/src/modules/starter/client/sounds/assets/Town_Theme.ogg 、.../doorOpen_1.ogg | CC BY 4.0，署名（作者+包名+链接） | 可作 BGM/音效源；原始页面失效时保留原引用并注明，不擅自换源 |
| game-icons.net 图标 | 官网 https://game-icons.net/ ；许可 https://creativecommons.org/licenses/by/3.0/ | CC BY 3.0，署名 | v3 模板 README 署名图标来源 |
| Kenney 免费素材集（含 RPG tileset） | ✅ https://kenney.nl/assets （2026-11-28 有头 Edge 与网页提取成功；直连 curl 仍可能 403） | CC0，无义务 | 作为第二档 Pipoya 的干净替代源；运行时格式与选型建议见 `docs/RPGJS运行时与内容类型.md` |

## 2. 第二档：需教育许可（商用/自用均可，但「课程包向学员再分发素材原文件」需先取得书面许可）

### 2.1 官方模板与署名链

| 资源 | 详细 URL | 核查要点 |
|---|---|---|
| rpgjs/starter（官方 degit 模板，v5 分支） | 仓库 https://github.com/rpgjs/starter ；README https://github.com/rpgjs/starter/blob/v5/readme.md （注意文件名小写 `readme.md`，大写 `README.md` 为 404） | README「Credits for Sample package assets → Graphics: Pipoya」。会话内读取时间 2026-11-27，仓库 pushed_at 2026-11-25 |
| starter 小角色 sprite | https://github.com/rpgjs/starter/blob/v5/public/spritesheets/hero.png ；https://github.com/rpgjs/starter/blob/v5/public/spritesheets/female.png | 与 v3 模板 `Male 01-2.png` / `Female 13-2.png` 的 git blob sha 完全一致；但 Pipoya 本人声明 16x16 包截图角色非其制作（WOLF RPG Editor 生成），署名粒度存疑 → **不作课程素材依据**，角色图走自制或 CC0 替换 |
| starter tileset（pipo 系列） | https://github.com/rpgjs/starter/blob/v5/src/tiled/%5BA%5DDirt_pipo.png ；.../%5BA%5DFlower_pipo.png ；.../%5BA%5DGrass_pipo.png ；.../%5BA%5DWall-Up_pipo.png ；.../%5BA%5DWaterFall_pipo.png ；.../%5BA%5DWater_pipo.png ；.../%5BBase%5DBaseChip_pipo.png ；.../%5BBase%5DBaseChip_pipo3.png ；.../base.png | 9 个文件与 sample-dev、cloudflare-mmorpg 逐字节一致（blob sha 相同），官方署名「Graphics: Pipoya」覆盖它们 |
| rpgjs/template（v3 模板） | 仓库 https://github.com/rpgjs/template ；npm https://www.npmjs.com/package/@rpgjs/sample-game （⚠️ 403 反爬） | README 完整署名：Sounds=Davidvitas (CC BY 4.0)、Graphics=Pipoya、Icons=game-icons.net |
| cloudflare-mmorpg（主仓 MMO 示例） | https://github.com/RSamaium/RPG-JS/tree/v5/samples/cloudflare-mmorpg | 仅 4 张 pipo tileset（与 starter 逐字节一致）+ 自绘地图；可作为模板基座 |

### 2.2 Pipoya 许可与联系

| 资源 | 详细 URL | 用途 |
|---|---|---|
| Pipoya itch.io 主页 | ⚠️ https://pipoya.itch.io/ （会话内 `web_extract` 成功） | 作者/作品总入口 |
| FREE RPG Tileset 16x16（许可页） | ⚠️ https://pipoya.itch.io/free-rpg-tileset-16x16 | 许可原文：「For commercial or personal use. Use and edit freely. **Not redistribute or resell this assets.** It can be used for game development and other productions.」 |
| 16x16 包下载页 | ⚠️ https://pipoya.itch.io/free-rpg-tileset-16x16/purchase | 下载 `Pipoya RPG Tileset 16x16.zip` |
| 16x16 包评论（角色出处声明） | ⚠️ https://pipoya.itch.io/free-rpg-tileset-16x16/comments | 作者回复：截图角色非其制作，来自 WOLF RPG Editor 的 Graphic Synthesizer |
| FREE RPG Tileset 32x32 | ⚠️ https://pipoya.itch.io/pipoya-rpg-tileset-32x32 | 32x32 规格备选源 |
| 其他免费包（目录） | ⚠️ https://pipoya.itch.io/ （页面列出 world tileset 32/40/48、character sprites、VFX 等） | 课程素材扩展示意，逐个核许可后再用 |
| 许可申请 Contact Form | ⚠️ https://docs.google.com/forms/d/1NsvllQQ1H_ZnNXhqZGlXSpDt16PGPjAeK_DXNoaiRMU/ | 首选处置：申请教育课程再分发书面许可 |
| 作者网站 / 社交 | ⚠️ https://pipoya.net/sozai/ ；⚠️ https://twitter.com/pipohi | 署名与联系备用 |
| WOLF RPG Editor 英文下载（角色出处） | 🔴 https://widderune.wixsite.com/widderune/wolf-rpg-editor-english （2026-11-28 直连 000） | 仅用于解释「截图角色非 Pipoya 制作」的出处链 |
| 第三方同条款引用例 | https://mylittlewordland.com/legal | 证明该许可被公开用户按同样条款引用 |

**处置三选一（设计书 §11 待定项 9）**：① 用上表 Contact Form 申请教育再分发书面许可（推荐）；② 换第一档 Kenney CC0；③ 课程包不放裸 PNG，改内容寻址存储鉴权 URL 下发（贴合作者「第三方拿不到原文件即不算再分发」口径）。决出前，首课不携带 pipo 素材。

## 3. 第三档：不可用 / 仅参考（源出不可证，不得入课程包）

| 资源 | 详细 URL | 核查结论 |
|---|---|---|
| sample-dev 目录 | https://github.com/RSamaium/RPG-JS/tree/v5/samples/sample-dev | 2025-06-28 单次提交整体导入，无更早公开溯源 |
| hero.png | https://github.com/RSamaium/RPG-JS/blob/v5/samples/sample-dev/public/hero.png | 1.3MB；PNG 元数据仅 GIMP 重存时间戳 2024-10-18，无作者字段 |
| monster.png | https://github.com/RSamaium/RPG-JS/blob/v5/samples/sample-dev/public/monster.png | 无署名 |
| potion.png | https://github.com/RSamaium/RPG-JS/blob/v5/samples/sample-dev/public/potion.png | 无署名；元数据时间戳 2026-01-05 |
| exp.png | https://github.com/RSamaium/RPG-JS/blob/v5/samples/sample-dev/public/exp.png | 1.8MB，无署名 |
| wood.png | https://github.com/RSamaium/RPG-JS/blob/v5/samples/sample-dev/public/wood.png | 元数据时间戳 2025-07-01 |
| faceset.png | https://github.com/RSamaium/RPG-JS/blob/v5/samples/sample-dev/public/faceset.png | 3.5MB，无署名 |
| background.jpg | https://github.com/RSamaium/RPG-JS/blob/v5/samples/sample-dev/public/background.jpg | 元数据时间戳 2025-06-28 |
| music.mp3 | https://github.com/RSamaium/RPG-JS/blob/v5/samples/sample-dev/public/music.mp3 | 仅 LAME 编码器标签；疑为 Davidvitas 包重编码但编码不同、无指纹可验，**不升档** |
| cursor.wav / typewriter.wav | 早期核查记录为相同哈希；2026-11-28 固定 commit `5616eda1` 审计发现两者 Git blob SHA 不同但 bytes 同为 176478。因属第三档未下载内容，不能重新断言字节是否相同；两者均保持禁用 |

结论：以上素材与 v3 模板已署名素材及已知免费包哈希**零匹配**，仓库内无任何署名；仅其代码结构 / bundle 组织方式可参考，**素材全部替换**。

## 4. URL 可达性复核（2026-11-28，直连 curl）

| 状态 | URL | 说明 |
|---|---|---|
| ✅ 200 | https://github.com/RSamaium/RPG-JS/tree/v5 、https://github.com/rpgjs/starter 、https://github.com/rpgjs/template 、https://game-icons.net/ 、https://github.com/bma73/revolt-fx-examples 、https://mylittlewordland.com/legal 、https://creativecommons.org/licenses/by/4.0/deed.en 、https://creativecommons.org/licenses/by/3.0/ | 可直接访问 |
| ⚠️ 000/403 | ⚠️ https://pipoya.itch.io/ 、⚠️ https://pipoya.itch.io/free-rpg-tileset-16x16 、⚠️ https://pipoya.itch.io/free-rpg-tileset-16x16/purchase 、⚠️ https://pipoya.itch.io/free-rpg-tileset-16x16/comments 、⚠️ https://pipoya.itch.io/pipoya-rpg-tileset-32x32 、⚠️ https://docs.google.com/forms/d/1NsvllQQ1H_ZnNXhqZGlXSpDt16PGPjAeK_DXNoaiRMU/ 、⚠️ https://kenney.nl/assets 、⚠️ https://www.npmjs.com/package/@rpgjs/sample-game | 网络/反爬限制；会话内 `web_extract` 已成功读取其中 itch 与 Google Form 内容 |
| 🔴 404 | 🔴 https://www.davidvitas.com/portfolio/2016/5/12/rpg-music-pack ；🔴 https://github.com/rpgjs/starter/blob/v5/README.md | 前者站点可能迁移（保留会话原始引用）；后者正确小写路径为 `readme.md` |
| 说明 | 部分 GitHub `blob` URL 本次 curl 返回 000 | 同一时刻其他 GitHub URL 返回 200，判定为网络波动而非失效；以仓库树 API 结果为准 |
