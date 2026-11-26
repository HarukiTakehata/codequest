#!/usr/bin/env node
// 从 c2w v0.8.5 默认 Dockerfile 生成适合当前 Podman / 国内网络环境的转换模板。
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const c2w = process.env.C2W_BIN ?? "/tmp/opencode/c2w-v0.8.5/c2w";
const output = resolve(process.argv[2] ?? resolve(here, "Containerfile.c2w"));
const result = spawnSync(c2w, ["--show-dockerfile"], { encoding: "utf8" });
if (result.status !== 0) throw new Error(`c2w --show-dockerfile 失败: ${result.stderr || result.status}`);

let source = result.stdout;
const bochsCargoSetup = [
  "FROM rust:1.74.1-bookworm AS bochs-dev-common",
  "ENV RUSTUP_TOOLCHAIN=1.74.1 RUSTUP_DIST_SERVER=https://rsproxy.cn CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse",
  "RUN mkdir -p /usr/local/cargo && printf '%s\\n' '[source.crates-io]' 'replace-with = \"rsproxy-sparse\"' '[source.rsproxy-sparse]' 'registry = \"sparse+https://rsproxy.cn/index/\"' > /usr/local/cargo/config.toml",
  "RUN rustup target add wasm32-unknown-unknown wasm32-wasi",
].join("\n");
source = source.replace("FROM rust:1.74.1-bookworm AS bochs-dev-common", bochsCargoSetup);
const stageEnv = `ENV DEBIAN_FRONTEND=noninteractive \\
    GIT_CONFIG_COUNT=1 \\
    GIT_CONFIG_KEY_0=url.https://gh-proxy.org/https://github.com/.insteadOf \\
    GIT_CONFIG_VALUE_0=https://github.com/ \\
    GOPROXY=https://goproxy.cn,direct \\
    GOSUMDB=off`;
source = source.replace(/^FROM .+$/gm, (line) => `${line}\n${stageEnv}`);
source = source.split("\n").map((line) => {
  if (/\b(curl|wget)\b/.test(line)) {
    return line.replaceAll("https://github.com/", "https://gh-proxy.org/https://github.com/");
  }
  return line;
}).join("\n");
source = source.replaceAll(
  "https://ftp.gnu.org/gnu/grub/grub-2.06.tar.gz",
  "https://mirrors.aliyun.com/gnu/grub/grub-2.06.tar.gz",
);
source = source.replaceAll(
  "mknod /rootfs/dev/null c 1 3 && chmod 666 /rootfs/dev/null",
  "touch /rootfs/dev/null && chmod 666 /rootfs/dev/null",
);
source = source.replaceAll('CC="x86_64-linux-gnu-gcc -static" make &&', 'CC="x86_64-linux-gnu-gcc -static" make vmtouch &&');
source = source.replaceAll('CC="aarch64-linux-gnu-gcc -static" make &&', 'CC="aarch64-linux-gnu-gcc -static" make vmtouch &&');
source = source.replaceAll('CC="riscv64-linux-gnu-gcc -static" make &&', 'CC="riscv64-linux-gnu-gcc -static" make vmtouch &&');
source = source.replaceAll(
  "RUN git clone -b v0.19.0 https://github.com/krallin/tini",
  "RUN git clone -b v0.19.0 https://github.com/krallin/tini && \\\n    sed -i '1i #include <libgen.h>' /work/tini/src/tini.c && \\\n    sed -i 's/-Werror//g' /work/tini/CMakeLists.txt",
);
writeFileSync(output, source);
console.log(`已生成 c2w Dockerfile: ${output}`);
