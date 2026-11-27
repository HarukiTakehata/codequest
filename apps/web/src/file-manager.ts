export type FileKind = "directory" | "file" | "symlink" | "other";

export interface ContainerFileEntry {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  modifiedAt: number;
  mode: number;
  executable: boolean;
  target?: string;
}

export interface ContainerListing {
  path: string;
  entries: ContainerFileEntry[];
}

export const FILE_MANAGER_ROOT = "/home/student";
export const MAX_TEXT_FILE_BYTES = 256 * 1024;

export function quotePosix(value: string): string {
  if (value.includes("\0")) throw new Error("Paths cannot contain NUL bytes");
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function validateEntryName(name: string): string {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
    throw new Error("Enter a single file or folder name");
  }
  return name;
}

export function normalizeContainerPath(value: string): string {
  if (!value.startsWith("/") || value.includes("\0")) throw new Error("Expected an absolute container path");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}` || "/";
}

export function joinContainerPath(parent: string, name: string): string {
  return normalizeContainerPath(`${normalizeContainerPath(parent)}/${validateEntryName(name)}`);
}

export function parentContainerPath(path: string): string {
  const normalized = normalizeContainerPath(path);
  if (normalized === "/") return "/";
  const index = normalized.lastIndexOf("/");
  return index === 0 ? "/" : normalized.slice(0, index);
}

export function containerBasename(path: string): string {
  const normalized = normalizeContainerPath(path);
  return normalized === "/" ? "/" : normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function buildListCommand(path: string): string {
  return `busybox ls -la -- ${quotePosix(normalizeContainerPath(path))}`;
}

export function buildWorkspaceSnapshotCommand(): string {
  return "pwd -P && busybox ls -la -- .";
}

function modeFromPermissions(permissions: string): number {
  let mode = 0;
  const special: Record<string, number> = { s: 0o4000, S: 0o4000, t: 0o1000, T: 0o1000 };
  for (let index = 0; index < 9; index++) {
    const char = permissions[index];
    const shift = (2 - Math.floor(index / 3)) * 3;
    const value = char === "r" ? 4 : char === "w" ? 2 : char === "x" ? 1 : 0;
    mode |= value << shift;
  }
  if (special[permissions[2]]) mode |= special[permissions[2]];
  if (special[permissions[5]]) mode |= special[permissions[5]];
  if (special[permissions[8]]) mode |= special[permissions[8]];
  return mode;
}

function parseModifiedAt(month: string, day: string, clockOrYear: string): number {
  const year = /^\d{4}$/.test(clockOrYear) ? clockOrYear : String(new Date().getFullYear());
  const time = /^\d{4}$/.test(clockOrYear) ? "00:00:00" : `${clockOrYear}:00`;
  const parsed = Date.parse(`${month} ${day} ${year} ${time}`);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseLsListing(path: string, output: string): ContainerListing {
  const root = normalizeContainerPath(path);
  const entries: ContainerFileEntry[] = [];
  const plainOutput = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const line of plainOutput.split(/\r?\n/)) {
    if (!line || line.startsWith("total ")) continue;
    const metadata = /^([bcdlps-][rwxStTs-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(.+)$/.exec(line);
    if (!metadata) continue;
    const [, permissions, sizeText, rest] = metadata;
    const traditionalDate = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}:\d{2}|\d{4})\s+(.+)$/.exec(rest);
    const isoDate = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/.exec(rest);
    let nameText: string;
    let modifiedAt = 0;
    if (traditionalDate) {
      nameText = traditionalDate[4];
      modifiedAt = parseModifiedAt(traditionalDate[1], traditionalDate[2], traditionalDate[3]);
    } else if (isoDate) {
      nameText = isoDate[3];
      modifiedAt = Date.parse(`${isoDate[1]} ${isoDate[2]}:00`) || 0;
    } else {
      nameText = rest;
    }
    const linkSeparator = nameText.indexOf(" -> ");
    const name = linkSeparator >= 0 ? nameText.slice(0, linkSeparator) : nameText;
    const target = linkSeparator >= 0 ? nameText.slice(linkSeparator + 4) : undefined;
    if (!name || name === "." || name === "..") continue;
    const type = permissions[0];
    const kind: FileKind = type === "d" ? "directory" : type === "l" ? "symlink" : "bcdps".includes(type) ? "other" : "file";
    const size = Number(sizeText);
    if (!Number.isFinite(size)) continue;
    entries.push({
      name,
      path: joinContainerPath(root, name),
      kind,
      size: Math.max(0, size),
      modifiedAt,
      mode: modeFromPermissions(permissions.slice(1)),
      executable: /[xs]/i.test(permissions.slice(1, 10)),
      ...(target !== undefined ? { target } : {}),
    });
  }
  entries.sort((left, right) => {
    const leftDirectory = left.kind === "directory" ? 0 : 1;
    const rightDirectory = right.kind === "directory" ? 0 : 1;
    return leftDirectory - rightDirectory || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
  return { path: root, entries };
}

export function parseWorkspaceSnapshot(output: string): { cwd: string; listing: ContainerListing } {
  const normalized = output.replace(/\r\n/g, "\n");
  const newline = normalized.indexOf("\n");
  const cwd = normalizeContainerPath((newline >= 0 ? normalized.slice(0, newline) : normalized).trim());
  return { cwd, listing: parseLsListing(cwd, newline >= 0 ? normalized.slice(newline + 1) : "") };
}

export function buildReadTextCommand(path: string, maxBytes = MAX_TEXT_FILE_BYTES): string {
  const file = quotePosix(normalizeContainerPath(path));
  const limit = Math.max(0, Math.floor(maxBytes));
  return [
    `CQ_FILE=${file}`,
    `CQ_LIMIT=${limit}`,
    'CQ_SIZE=$(busybox stat -c %s "$CQ_FILE") || exit 1',
    '[ "$CQ_SIZE" -le "$CQ_LIMIT" ] || exit 75',
    'busybox cat -- "$CQ_FILE"',
  ].join("; ");
}

export function buildWriteCommand(path: string, content: string): string {
  return `printf %s ${quotePosix(content)} > ${quotePosix(normalizeContainerPath(path))}`;
}

export function buildCreateDirectoryCommand(path: string): string {
  return `busybox mkdir ${quotePosix(normalizeContainerPath(path))}`;
}

export function buildRenameCommand(from: string, to: string): string {
  return `busybox mv ${quotePosix(normalizeContainerPath(from))} ${quotePosix(normalizeContainerPath(to))}`;
}

export function buildDeleteCommand(path: string): string {
  return `busybox rm -rf -- ${quotePosix(normalizeContainerPath(path))}`;
}

const EXACT_FILE_ICONS: Record<string, string> = {
  "dockerfile": "docker",
  "containerfile": "docker",
  "makefile": "makefile",
  "gnumakefile": "makefile",
  "readme": "readme",
  "readme.md": "readme",
  "license": "license",
  "license.md": "license",
  "copying": "license",
  "package.json": "npm",
  "package-lock.json": "npm",
  "tsconfig.json": "tsconfig",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  ".env": "settings",
};

const EXTENSION_FILE_ICONS: Record<string, string> = {
  c: "c", h: "h", cc: "cpp", cp: "cpp", cpp: "cpp", cxx: "cpp", "c++": "cpp", hh: "hpp", hpp: "hpp", hxx: "hpp",
  java: "java", class: "javaclass", jar: "javaclass", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript", py: "python", pyw: "python",
  sh: "console", bash: "console", zsh: "console", fish: "console", json: "json", md: "markdown", markdown: "markdown", mdx: "markdown",
  txt: "document", text: "document", yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", html: "html", htm: "html",
  css: "css", scss: "sass", sass: "sass", svg: "svg", png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", ico: "image",
  zip: "zip", gz: "zip", tgz: "zip", tar: "zip", bz2: "zip", xz: "zip", pdf: "pdf", log: "log", lock: "lock", vim: "vim",
};

const EXACT_FOLDER_ICONS: Record<string, string> = {
  src: "folder-src", source: "folder-src", docs: "folder-docs", doc: "folder-docs", test: "folder-test", tests: "folder-test",
  config: "folder-config", ".config": "folder-config", public: "folder-public", node_modules: "folder-node", python: "folder-python",
  java: "folder-java", javascript: "folder-javascript", js: "folder-javascript", ".git": "folder-git", images: "folder-images",
  image: "folder-images", assets: "folder-images", components: "folder-components",
};

export function materialIconName(entry: Pick<ContainerFileEntry, "name" | "kind">): string {
  if (entry.kind === "directory") return EXACT_FOLDER_ICONS[entry.name.toLowerCase()] ?? "folder";
  if (entry.kind !== "file") return "file";
  const lower = entry.name.toLowerCase();
  const exact = EXACT_FILE_ICONS[lower];
  if (exact) return exact;
  const dot = lower.lastIndexOf(".");
  return dot > 0 ? EXTENSION_FILE_ICONS[lower.slice(dot + 1)] ?? "file" : "file";
}

export function materialIconUrl(entry: Pick<ContainerFileEntry, "name" | "kind">, open = false): string {
  const name = materialIconName(entry);
  const asset = entry.kind === "directory" && open && name.startsWith("folder-") && name !== "folder-open" ? `${name}-open` : name;
  return `/vendor/material-icon-theme/icons/${asset}.svg`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
