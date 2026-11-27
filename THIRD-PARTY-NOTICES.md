# Third-Party Notices · CodeQuest

本仓库主代码使用 MIT 许可（见 `LICENSE`）。以下第三方组件按其原始许可分发，不并入主代码许可。

## 运行时工件（vendored）

### Java：`apps/web/public/java/`（来自 `@live-codes/java-wasm@0.1.0`）

- 包许可：Apache-2.0（`THIRD-PARTY-NOTICES-clang.md` 之外的原始声明见 `node_modules/@live-codes/java-wasm/LICENSE`）
- TeaVM / teavm-javac / Vsprocessing fork：Apache-2.0
- **内含 OpenJDK javac：GPLv2 + Classpath Exception**。完整声明、对应源码指针与许可全文见上游包的 `THIRD-PARTY-NOTICES.md`（本项目 vendored 副本：`node_modules/@live-codes/java-wasm/THIRD-PARTY-NOTICES.md`，发布物需随包携带）。
- 工件：`compiler.wasm` 5.2MB、`runtime-classlib-teavm.bin` 2.2MB、`compile-classlib-teavm.bin` 0.21MB、`compiler.wasm-runtime.js`、`compiler.wasm-deobfuscator.wasm`、`worker-java.js`、`java-wasm.iife.js`。
- 校验和：见 `scripts/spike-java.mjs` 实测记录与 `docs/spike-M3-M4.md`。

### C/C++：`apps/web/public/clang/`（来自 `@live-codes/clang-wasm@0.3.0`）

- 包许可：MIT；底层 `@wasm-idle/llvm-core`、`@bjorn3/browser_wasi_shim` 按各自许可。
- 工件：Clang 22 / lld / memfs / sysroot，共约 28MB（解压约 84MB）。
- 校验和随工件附带：`apps/web/public/clang/asset-receipts.json`。
- 完整声明见 `THIRD-PARTY-NOTICES-clang.md`。

### Material Icon Theme：`apps/web/public/vendor/material-icon-theme/`

- 版本 5.40.0，MIT；来源与固定 commit 见同目录 `SOURCE.json`，完整许可见 `LICENSE`。
- 仅 vendored c2w 文件管理器使用的文件/文件夹 SVG 子集，不引入 VS Code 扩展运行时或远程图标服务。

## 依赖与参考（通过 npm 安装，不 vendored）

| 组件 | 许可 | 用途 |
|---|---|---|
| WebGAL / WebGAL_Terre | MPL-2.0 | 剧情引擎参考（本仓库为自研兼容子集，未引入其代码） |
| container2wasm | Apache-2.0 | shell 容器会话路线（M4 spike 使用其 `c2w` 工具，不改源码） |
| Pyodide | MPL-2.0 | Python 运行时 |
| Monaco Editor | MIT | 代码编辑器 |
| React / Vite / Hono / zod / ulid | MIT | 前端与后端框架 |

Java 进阶篇若后来采用 container2wasm JDK 镜像，按补充选型文档 §7 使用 Eclipse Temurin/Adoptium（MIT-style）JDK，并继续排除 CheerpJ。

## 语言开发容器（`scripts/containers/`）

这些镜像用于本地开发、CI 和 container2wasm 转换，不在服务端执行学员代码。

| 组件 | 许可 | 来源 |
|---|---|---|
| Alpine Linux / apk | MIT | https://alpinelinux.org/about/ |
| BusyBox | GPL-2.0-only | https://busybox.net/ |
| OpenJDK 21 | GPL-2.0-with-classpath-exception | https://openjdk.org/legal/gplv2+ce.html |
| Node.js / npm | Node.js MIT + npm Artistic-2.0 / npm License | https://github.com/nodejs/node 、 https://github.com/npm/cli |
| CPython / pip | Python Software Foundation License | https://docs.python.org/3/license.html 、 https://github.com/pypa/pip |
| GCC / GDB / CMake | GPL-3.0-with-GCC-exception / GPL-2.0 / BSD-3-Clause | 各上游项目 |
| Git / Vim / Nano | GPL-2.0 / Vim License / GPL-3.0 | 各上游项目 |

发布容器工件时应保留各包的原始许可与源码获取指针；OpenJDK 的 GPL+Classpath Exception 声明需随
Java 镜像一起提供。
