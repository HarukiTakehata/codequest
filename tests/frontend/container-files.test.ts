import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  buildCreateDirectoryCommand, buildDeleteCommand, buildListCommand, buildReadTextCommand, buildRenameCommand,
  buildWorkspaceSnapshotCommand, buildWriteCommand, containerBasename, joinContainerPath, materialIconName, materialIconUrl,
  normalizeContainerPath, parentContainerPath, parseLsListing, parseWorkspaceSnapshot, quotePosix, validateEntryName,
  type ContainerFileEntry,
} from "../../apps/web/src/file-manager";

function entry(name: string, kind: ContainerFileEntry["kind"] = "file"): Pick<ContainerFileEntry, "name" | "kind"> {
  return { name, kind };
}

describe("c2w 文件路径与可见命令", () => {
  it("POSIX 单引号转义可安全承载引号、空格、换行和 shell 元字符", () => {
    const path = "/home/student/a'b; touch /tmp/pwned";
    expect(quotePosix(path)).toBe("'/home/student/a'\\''b; touch /tmp/pwned'");
    expect(buildDeleteCommand(path)).toContain(quotePosix(path));
    expect(buildRenameCommand(path, "/home/student/next file")).toContain(quotePosix("/home/student/next file"));
    expect(buildWriteCommand("/home/student/a.txt", "hello\nworld's $HOME")).toContain(quotePosix("hello\nworld's $HOME"));
    expect(() => quotePosix("bad\0path")).toThrow("NUL");
  });

  it("规范绝对路径并拒绝目录穿越或非法新建名称", () => {
    expect(normalizeContainerPath("/home//student/../student/./a")).toBe("/home/student/a");
    expect(normalizeContainerPath("/../../")).toBe("/");
    expect(parentContainerPath("/home/student/a.txt")).toBe("/home/student");
    expect(containerBasename("/home/student/a.txt")).toBe("a.txt");
    expect(joinContainerPath("/home/student", "a b.txt")).toBe("/home/student/a b.txt");
    for (const invalid of ["", ".", "..", "a/b", "a\0b"]) expect(() => validateEntryName(invalid)).toThrow();
    expect(() => normalizeContainerPath("relative/path")).toThrow();
  });

  it("目录查看使用真实且可见的 ls -la 命令", () => {
    expect(buildListCommand("/home/student/a'b")).toBe("busybox ls -la -- '/home/student/a'\\''b'");
    expect(buildCreateDirectoryCommand("/home/student/new folder")).toBe("busybox mkdir '/home/student/new folder'");
  });

  it("自动刷新只用一条简洁的 pwd + ls 快照命令", () => {
    expect(buildWorkspaceSnapshotCommand()).toBe("pwd -P && busybox ls -la -- .");
    const snapshot = parseWorkspaceSnapshot("/home/student\ntotal 0\n");
    expect(snapshot.cwd).toBe("/home/student");
    expect(snapshot.listing).toEqual({ path: "/home/student", entries: [] });
  });

  it("解析 BusyBox ls -la 的目录、隐藏文件、空格文件名与符号链接", () => {
    const output = [
      "total 8",
      "drwxr-xr-x    2 root     root          4096 Nov 27 02:00 \x1b[1;34mdocs\x1b[m",
      "drwxr-xr-x    1 root     root          4096 Nov 27 01:00 ..",
      "-rw-r--r--    1 root     root            13 Nov 27 02:01 notes.txt",
      "-rwxr-xr-x    1 root     root             0 Nov 27 02:02 run.sh",
      "-rw-r--r--    1 root     root             7 Nov 27 02:03 a b.txt",
      "lrwxrwxrwx    1 root     root             7 Nov 27 02:04 link -> b.txt",
    ].join("\n");
    const listing = parseLsListing("/home/student", output);
    expect(listing.entries.map((item) => item.name)).toEqual(["docs", "a b.txt", "link", "notes.txt", "run.sh"]);
    expect(listing.entries[0]).toMatchObject({ kind: "directory", path: "/home/student/docs", size: 4096 });
    expect(listing.entries[2]).toMatchObject({ kind: "symlink", target: "b.txt" });
    expect(listing.entries[4]).toMatchObject({ executable: true, mode: 0o755 });
  });

  it("文本读取超限返回 75，写回使用真实 printf 且不改变文本内容", () => {
    expect(buildReadTextCommand("/home/student/big.txt", 1234)).toContain("CQ_LIMIT=1234");
    expect(buildReadTextCommand("/home/student/big.txt", 1234)).toContain("exit 75");
    expect(buildReadTextCommand("/home/student/big.txt", 1234)).toContain("busybox cat");
    expect(buildWriteCommand("/home/student/a'b.txt", "line 1\nline 2's")).toBe(
      "printf %s 'line 1\nline 2'\\''s' > '/home/student/a'\\''b.txt'",
    );
  });
});

describe("Material Icon Theme 文件图标", () => {
  it("按文件名、扩展名与目录类型匹配本地 Material 图标", () => {
    expect(materialIconName(entry("main.cpp"))).toBe("cpp");
    expect(materialIconName(entry("script.sh"))).toBe("console");
    expect(materialIconName(entry("README.md"))).toBe("readme");
    expect(materialIconName(entry("package.json"))).toBe("npm");
    expect(materialIconName(entry("tsconfig.json"))).toBe("tsconfig");
    expect(materialIconName(entry("src", "directory"))).toBe("folder-src");
    expect(materialIconName(entry("unknown.xyz"))).toBe("file");
    expect(materialIconUrl(entry("src", "directory"), true)).toBe("/vendor/material-icon-theme/icons/folder-src-open.svg");
  });

  it("所有使用的 SVG、版本来源和 MIT 许可都随站点本地部署", () => {
    const names = ["main.cpp", "a.h", "main.java", "Main.class", "app.js", "app.tsx", "main.py", "run.sh", "data.json", "README.md", "LICENSE", "Dockerfile", "Makefile", "a.yaml", "a.toml", "a.html", "a.css", "a.svg", "a.png", "a.zip", "a.pdf", "a.log", "package.json", "tsconfig.json", ".gitignore"];
    const folders = ["src", "docs", "tests", "node_modules", ".git", "images", "components", "other"];
    for (const item of [...names.map((name) => entry(name)), ...folders.map((name) => entry(name, "directory"))]) {
      for (const open of item.kind === "directory" ? [false, true] : [false]) {
        const url = materialIconUrl(item, open);
        expect(existsSync(new URL(`../../apps/web/public${url}`, import.meta.url)), url).toBe(true);
      }
    }
    const source = JSON.parse(readFileSync(new URL("../../apps/web/public/vendor/material-icon-theme/SOURCE.json", import.meta.url), "utf8"));
    expect(source).toMatchObject({ name: "Material Icon Theme", version: "5.40.0", license: "MIT" });
    expect(readFileSync(new URL("../../apps/web/public/vendor/material-icon-theme/LICENSE", import.meta.url), "utf8")).toContain("The MIT License");
  });
});
