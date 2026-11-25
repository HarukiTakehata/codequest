#!/usr/bin/env node
// 用 gh-proxy.org 拉取 busybox 源码，在 Alpine 容器里静态编译，产出最小 shell 根文件系统。
// 不使用 Ubuntu：构建环境与目标根文件系统都基于 Alpine/musl。
// 用法: node scripts/build-minimal-shell-cn.mjs [--work /tmp/cq-minimal-cn]
// apk 源使用清华镜像；GitHub 源码走 gh-proxy.org；全程不使用 Ubuntu。
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const workIndex = args.indexOf("--work");
const work = workIndex >= 0 ? resolve(args[workIndex + 1]) : "/tmp/cq-minimal-cn";
const BUSYBOX_URL = "https://gh-proxy.org/https://github.com/vda-linux/busybox_mirror/archive/refs/tags/1_38_0.tar.gz";
const ALPINE = "docker.io/library/alpine:3.22";
const BUILD_IMAGE = "cq-minimal-builder:local";

const run = (cmd, args, options = {}) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${cmd} failed with ${result.status}`);
};

mkdirSync(work, { recursive: true });

// 1. Alpine 基础镜像（如本地没有则从 1ms 镜像源拉取并 tag）。
if (!existsSync(`${work}/.alpine-ready`)) {
  run("podman", ["pull", "docker.1ms.run/library/alpine:3.22"]);
  run("podman", ["tag", "docker.1ms.run/library/alpine:3.22", ALPINE]);
  writeFileSync(`${work}/.alpine-ready`, "ok\n");
}

// 2. 构建容器：Alpine + build-base/musl，源码经 gh-proxy 下载，静态编译 busybox。
const APK_MIRROR = "https://mirrors.tuna.tsinghua.edu.cn/alpine";
const apkMirrorSetup = `sed -i 's|https://dl-cdn.alpinelinux.org/alpine|${APK_MIRROR}|g' /etc/apk/repositories`;

const buildScript = `
set -eux
${apkMirrorSetup}
apk add --no-cache build-base musl-dev linux-headers curl tar
mkdir -p /work
cd /work
curl -fsSL "${BUSYBOX_URL}" -o busybox.tar.gz
tar xzf busybox.tar.gz
SRC_DIR=$(find . -maxdepth 1 -type d -name 'busybox*' | head -1)
cd "$SRC_DIR"
make defconfig
# 教学所需 applet（含 loopback spike 用的 nc/netstat/ps/pgrep）
for opt in ASH AWK CAT CHMOD CP CUT ECHO FIND GREP HEAD LS MD5SUM MKDIR MV NC NETSTAT \
           PGREP PS PWD RM SED SORT STAT TAIL TEST TOUCH TR UNIQ WC VI SH; do
  scripts/config --enable "CONFIG_\${opt}" 2>/dev/null || true
done
scripts/config --disable CONFIG_DESKTOP 2>/dev/null || true
make -j\$(nproc) CONFIG_STATIC=y 2>&1 | tail -8
mkdir -p /out/rootfs/bin /out/rootfs/sbin /out/rootfs/usr/bin /out/rootfs/proc \\
         /out/rootfs/sys /out/rootfs/dev /out/rootfs/tmp /out/rootfs/home/student
cp busybox /out/rootfs/bin/busybox
chmod +x /out/rootfs/bin/busybox
for applet in sh ash awk cat chmod cp cut echo find grep head ls md5sum mkdir mv nc \\
              netstat pgrep ps pwd rm sed sort stat tail test touch tr uniq wc vi; do
  ln -sf /bin/busybox "/out/rootfs/bin/\${applet}" 2>/dev/null || true
done
ln -sf /bin/busybox /out/rootfs/sbin/init
printf 'root:x:0:0:root:/root:/bin/sh\\n' > /out/rootfs/etc_passwd_tmp
mkdir -p /out/rootfs/etc
mv /out/rootfs/etc_passwd_tmp /out/rootfs/etc/passwd
printf 'nameserver 8.8.8.8\\n' > /out/rootfs/etc/resolv.conf
echo done
`;
const containerfile = `FROM ${ALPINE}
RUN ${apkMirrorSetup} && apk add --no-cache bash
COPY build.sh /build.sh
RUN chmod +x /build.sh && /build.sh
`;
writeFileSync(`${work}/build.sh`, buildScript);
writeFileSync(`${work}/Containerfile`, containerfile);

run("podman", ["build", "--platform", "linux/amd64", "-t", BUILD_IMAGE, "-f", `${work}/Containerfile`, work]);
run("podman", ["create", "--name", "cq-minimal-extract", BUILD_IMAGE, "true"]);
run("podman", ["cp", "cq-minimal-extract:/out/rootfs", `${work}/rootfs`]);
run("podman", ["rm", "-f", "cq-minimal-extract"]);

console.log(`最小根文件系统已生成: ${work}/rootfs`);
