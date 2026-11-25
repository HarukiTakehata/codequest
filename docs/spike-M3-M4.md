# M3 / M4 实测 spike 报告（2026-11-25）

> 对应设计书 v0.3 §8 M3/M4 验收与 §5.5.1 的 loopback 端口判定。
> 复现脚本：`node scripts/spike-m3m4.mjs`、`node scripts/spike-java.mjs`、`npm test`。

## M3 · C/C++ 浏览器内真编译：✅ 可行（已落地）

上游 `binji/wasm-clang` 仓库自 2023 年未更新且无 release 资产；改用同路线的
**`@live-codes/clang-wasm@0.3.0`（MIT）**——Clang 22 + lld + memfs + sysroot 编译为 WASM，
API `createCompiler(lang, {baseUrl}).run(code, input)` 直接返回 `stdout/stderr/errors/exitCode`。

实测（Node CLI，真实编译器，`tests/acceptance/cpp.test.ts`）：

```
OK   {"stdout":"sum=5\n","stderr":"","errors":[],"exitCode":0,"compileMs":1954,"runMs":3}
BAD  {"errors":["main.cpp:1:21: error: expected expression", ...],"exitCode":null}
```

- 参考解通过两道真实 C 题（HelloWorld、scanf 求和）判题，加权分 100。
- 编译错误含 `main.cpp:行:列` 与可读消息，已适配为 Monaco 行内诊断（`compileDiagnostics`）。
- 浏览器接入：资产 vendored 到 `apps/web/public/clang/`（28MB，`asset-receipts.json` 自带 SHA-256），
  编译执行放在独立 Worker（`online-worker.ts`），符合 AGENTS.md #4。
- 未完成：Service Worker 预缓存（首次加载需下载约 28MB；设计书要求二次进入秒开）。

## M2.5 · Java teavm-javac：✅ 可行（已落地）

`docs/补充选型-20261124-java.md` 选定的 `@live-codes/java-wasm@0.1.0` 可从 npm 镜像获取。

真实 headless Firefox 160 实测（`node scripts/spike-java.mjs`，页面内运行 vendored 资产）：

```
RESULT {"hello":{"ok":true,"stdout":"Hello from Java\n","stderr":"","exitCode":0,"compileMs":13,"generateMs":1004,"runMs":0},
        "stdin":{"ok":true,"stdout":"sum=5\n","stderr":"","exitCode":0,"compileMs":13,"generateMs":2764,"runMs":1},
        "bad":{"ok":false,"stderr":"Main.java:1: illegal start of expression","exitCode":1}}
M2.5_JAVA_SPIKE_PASS
```

- HelloWorld / Scanner 读 stdin / 编译错误行号三项均通过。
- 资产 vendored 到 `apps/web/public/java/`（7.8MB，校验和见报告附录），许可声明见 `THIRD-PARTY-NOTICES.md`。
- 未完成：同源码哈希的预编译缓存、Service Worker 预缓存、Java 补全（按设计仅高亮 + 编译诊断）。

## M4 · Shell：部分可行

### 轻量判题路径 wasi-sh：✅ 可行（已落地）

`wasi-sh@0.11.0`（ISC，busybox ash + coreutils 编译为 wasm32-wasi，fork-free）从 npm 获取并在 Node/浏览器均可运行：

```
grep -o "CQ{[^}]*}" /home/student/secret.txt  →  "CQ{bandit-one}\n"  exit 0
cat words.txt | sort | uniq -c               →  "      1 a\n      2 b\n"  exit 0
```

已作为 shell 脚本判题的默认运行时（`packages/runtime-shell/src/wasi-client.ts`），课程 `sh02_script` 参考解通过真实判题器（`tests/acceptance/shell-wasi.test.ts`）。
`goals` 的 `file-exists`/`command-stdout` 由内存教学 shell 会话回传的 `files` 求值（`TerminalWorkbench`）。

### container2wasm 容器会话 + loopback 端口：🔄 转换进行中（镜像源已解决）

2026-11-25 用户提供 `docker.1ms.run` 镜像源后，已从该源拉齐并 tag：
`emscripten/emsdk:3.1.40`、`:4.0.10`、`tonistiigi/binfmt:qemu-v6.1.0`（daocloud 白名单缺这三个）。
c2w 转换此前停在 10/127 步，原因是 Go 模块走 `proxy.golang.org` 超时；已在生成的 Dockerfile
的 golang stage 注入 `GOPROXY=https://goproxy.cn,direct`、`GOSUMDB=off`，转换重跑中。
转换完成后用 `scripts/spike-loopback.mjs` 在真实容器里跑
`nc -l 127.0.0.1 8080 & netstat -ltn`，结果写入 `docs/spike-loopback-result.json`。

### 历史记录：环境受限阶段（已被上面的镜像源进展取代）

实测记录（`node scripts/spike-m3m4.mjs` + podman）：

```
docker     MISSING ; podman  OK 6.2.0 ; c2w MISSING
raw.githubusercontent.com  -> 000（不可达）
github.com / api.github.com -> 200（可达）
c2w v0.8.5 linux-amd64 已从 GitHub release 下载可用
docker.io（Docker Hub）registry-1.docker.io -> 超时（不可达）
docker.m.daocloud.io 镜像 -> 可拉取 alpine:3.22 / ubuntu:22.04
自建教学镜像（alpine + procps + iproute2 + busybox-extras）→ podman build 成功（12.9MB）
```

`c2w` 转换过程在 podman builder 下遇到 `--platform` 不兼容（写 docker shim 剥离后继续），
随后其内置 Dockerfile 需要从 Docker Hub 拉 `ubuntu:22.04`、golang、gcc、rust、
**`emscripten/emsdk:3.1.40` / `:4.0.10`** 与 **`tonistiigi/binfmt:qemu-v6.1.0`**。
前四者可从 daocloud 镜像预拉并 tag 绕过；后两者**不在该镜像的白名单内**（镜像返回 `denied: 这镜像不在白名单`），
而 Docker Hub 本身超时不可达，因此构建在第 10/127 步后无法继续。即使镜像齐全，仍需在
workerd 之外克隆 6+ 个 GitHub 仓库并本地编译 Bochs/QEMU/TinyEMU（127 步 build）。
在本会话的网络与时间预算内无法完成该构建，因此：

- **容器内 `nc -l 127.0.0.1` + `netstat -ltn` 的 loopback 可行性尚无实测结论**（设计书 §5.5.1 要求 M4 必须实测）。
- 按设计书 §5.5 的降级条款，端口类关卡暂不纳入第一版；Bandit 式探索关只承诺**文件与文本**类判定（令牌在 `secret.txt` 中，`grep`/`cat` 可得），已由 wasi-sh 路径实测通过。
- 待具备完整 c2w 构建环境（docker + 可达的 Docker Hub 或可用镜像源 + 足够构建时间）后补跑 spike，再决定是否开放端口类关卡。

**需要用户拍板**：是否接受将 container2wasm 容器会话（真实 Linux 进程/端口状态检查）延期到 M4 后续迭代，
第一版只交付 wasi-sh 脚本判题 + 内存文件系统探索关（当前状态）？设计书 §5.5 已为该降级预留条款。

## 附录 · vendored 工件校验和

```
java/java-wasm.iife.js     0cf26b67734d559b25ead931e9a3937b140f7dacb9ccae8e85796971fdbfafc2
java/worker-java.js        b3c198b5f221da46b40725aeb835248428e7f2a8fc15d2d0eb71949a1fb92b14
java/teavm/compiler.wasm   bad2b9856e263d185d09bb377daa85f25a09598da8b2854111e3db5358dc3dc8
java/teavm/runtime-classlib-teavm.bin f677a5f6a2e9daa94a1438982737e7778777cf23ec93eca303e49aa9dee45a16
clang/*                    见 apps/web/public/clang/asset-receipts.json
```
