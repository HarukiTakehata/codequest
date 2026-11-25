import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Container Shell 模式：最小镜像快照已植入前端", () => {
  it("rootfs 快照包含 /etc/passwd 与教学文件", () => {
    const files = JSON.parse(read("apps/web/public/container-shell/rootfs.json")) as Record<string, string>;
    expect(files["/etc/passwd"]).toContain("root:x:0:0");
    expect(files["/etc/resolv.conf"]).toContain("nameserver");
    expect(files["/home/student/README.md"]).toContain("vi");
  });

  it("applet 清单包含 vi（满足 nano 或 vi 的要求）", () => {
    const applets = JSON.parse(read("apps/web/public/container-shell/applets.json")) as string[];
    expect(applets.length).toBeGreaterThan(300);
    expect(applets).toContain("vi");
    expect(applets).toContain("nc");
    expect(applets).toContain("netstat");
  });

  it("ContainerShell 独立组件使用 wasi-sh 执行，不进入剧情", () => {
    const source = read("apps/web/src/components/ContainerShell.tsx");
    expect(source).toContain("openShellSession");
    expect(source).toContain("vi");
    expect(source).not.toContain("Stage");
  });
});
