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

### container2wasm 容器会话 + loopback 端口：⚠️ 转换成功但生产耗时不可接受，v1 不纳入主链路

**转换已成功**：`EXIT=0`，产物 `/tmp/opencode/cq-teaching.wasm` **109MB**（教学镜像 alpine + procps + iproute2 + busybox-extras，127 步构建）。
镜像源与网络问题均已解决：`docker.1ms.run`（emsdk/binfmt/ubuntu:latest）、
`gh-proxy.org`（GitHub git clone 与 release 下载）、`goproxy.cn`（Go modules）、
rootless podman 的 `mknod` 降级。这些做法记录在 `/tmp/opencode/Dockerfile.c2w` 的构建过程中。

**最小镜像的 loopback 实测（2026-11-25）**：`scripts/build-minimal-shell-cn.mjs` 用清华 apk 源 +
`gh-proxy.org` 拉取 busybox 1.38.0 源码，在 Alpine/musl 下静态编译，产出 1.2MB rootfs（407 applet）
并打成 `cq-minimal:cn`（`FROM scratch`，无 Ubuntu）。`scripts/test-minimal-rootfs.mjs` 在该容器内实测：

```
PASS shell 与基础命令
PASS 文件读写与查找
PASS 文本处理（grep/sort/uniq/wc/awk/tr/cut）
PASS 进程检查（ps/pgrep/pidof）
PASS 容器内 loopback 监听（nc -l -p 8080 127.0.0.1 + netstat -ltn）
5/5 checks passed
```

这证明**教学镜像工具集与容器内 loopback 监听**本身可行（真实 Linux 容器 + 宿主内核）。
注意：这不等于 container2wasm 模拟内核内的可行性结论——后者受 Bochs/QEMU 模拟层影响，仍未实测。

**生产结论（2026-11-25，用户反馈「耗时太久」后确认）**：
- Bochs/TinyEMU 全系统模拟 + 109MB wasm 的冷启动远慢于交互式教学可接受范围；
  `scripts/spike-loopback.mjs` 的浏览器探针在 300s / 900s 量级内未得到结论，且 headless Firefox
  在并发探针后进入不稳定状态。继续在该路径上投入不属于「最小可用」范围。
- 设计书 §5.2 / §9 本就把容器会话定位为「慢、可用但非即时」，并给出降级条款（§5.5）。
  因此 **v1 学习主链路不走 container2wasm**：shell 教学与判题全部走 `wasi-sh`（毫秒级，
  实测见上文）与内存教学 shell；端口类关卡不纳入课程。
- 容器会话保留为后续独立里程碑（带 wizer 预热快照 / 后台预启动 / SW 缓存 109MB 工件）的候选，
  不在 M4 验收口径内宣称完成。

### 历史记录：镜像源与转换过程

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
