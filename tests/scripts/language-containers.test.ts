import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("语言开发容器构建脚本", () => {
  it("五个 Alpine 镜像都包含 git/vim/nano 与学生工作目录", () => {
    for (const language of ["shell", "cpp", "java", "python", "javascript"]) {
      const source = read(`scripts/containers/Containerfile.${language}`);
      expect(source).toContain("docker.io/library/alpine:3.22");
      expect(source).toContain("git vim nano");
      expect(source).toContain("adduser -D -u 1000 student");
      expect(source).toContain("WORKDIR /workspace");
    }
  });

  it("选择器支持交互、单个语言与 all", () => {
    const selector = read("scripts/build-language-container.mjs");
    expect(selector).toContain("chooseLanguage");
    expect(selector).toContain('selected === "all"');
    expect(selector).toContain("printLanguageList");

    const config = read("scripts/containers/config.mjs");
    for (const language of ["shell", "cpp", "java", "python", "javascript"]) {
      expect(config).toContain(`id: "${language}"`);
    }
  });

  it("冒烟测试强制检查 git/vim/nano", () => {
    const common = read("scripts/containers/common.mjs");
    expect(common).toContain("command -v git && command -v vim && command -v nano");
  });

  it("Shell 镜像包含设计与进程/网络检查所需工具", () => {
    const dockerfile = read("scripts/containers/Containerfile.shell");
    const config = read("scripts/containers/config.mjs");
    expect(dockerfile).toContain("procps iproute2");
    expect(config).toContain("command -v ps && command -v ss && command -v ip");
  });

  it("浏览器清单与构建选择器使用相同语言 ID", () => {
    const manifest = JSON.parse(read("apps/web/public/container-environments.json")) as Array<{ id: string }>;
    expect(manifest.map((item) => item.id)).toEqual(["shell", "cpp", "java", "python", "javascript"]);
  });

  it("c2w 按语言分配 guest 内存", () => {
    const config = read("scripts/containers/config.mjs");
    const build = read("scripts/containers/build-c2w.mjs");
    expect(config).toContain("memoryMb: 512");
    expect(config).toContain("memoryMb: 256");
    expect(build).toContain("VM_MEMORY_SIZE_MB=${language.memoryMb}");
  });

  it("gzip 先校验临时文件再发布，浏览器冒烟要求真实成功退出码", () => {
    const build = read("scripts/containers/build-c2w.mjs");
    expect(build).toContain('run("gzip", ["-t", temporary])');
    expect(build.indexOf('run("gzip", ["-t", temporary])')).toBeLessThan(build.indexOf("renameSync(temporary, gzip)"));
    const smoke = read("scripts/test-c2w-environment.mjs");
    expect(smoke).toContain("set -e");
    expect(smoke).toContain("parsed.result?.code === 0");
  });

  it("上传前校验语言工件大小与 SHA-256", () => {
    const upload = read("scripts/upload-runtime-assets.mjs");
    expect(upload).toContain("createHash");
    expect(upload).toContain("item.bytes !== bytes.length");
    expect(upload).toContain("item.sha256 !== sha256");
    expect(upload).not.toContain("cq-minimal.wasm.gz");
  });
});
