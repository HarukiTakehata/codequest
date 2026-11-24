# AGENTS.md · CodeQuest 协作者规范

> 模板参照 March7thTeam/boardroom 的 AGENTS.md。本文件约束在此仓库内工作的 AI/人类协作者。

## 项目事实源

- 设计决策与排期的唯一事实源是 `docs/编程学习系统设计书.md`；改设计先改文档再动代码。
- 里程碑（M0-M7）与验收标准见设计书 §8；每个 PR 应注明所属里程碑。

## 命令约定（骨架建立后补充）

```bash
# npm install          # 安装依赖（Node 24+，镜像源见下）
# npm run dev          # 本地开发
```

依赖安装统一走国内镜像：`npm --registry https://registry.npmmirror.com`。

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
