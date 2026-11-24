/** 内存文件系统：路径 → 文件内容；目录由路径前缀隐式表示。 */
export type Vfs = Record<string, string>;

export function normalizePath(cwd: string, input: string): string {
  const raw = input.startsWith("/") ? input : `${cwd}/${input}`;
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return "/" + parts.join("/");
}

export function isDir(vfs: Vfs, path: string): boolean {
  if (path === "/") return true;
  const prefix = path === "/" ? path : `${path}/`;
  return Object.keys(vfs).some((key) => key.startsWith(prefix));
}

export function exists(vfs: Vfs, path: string): boolean {
  return path === "/" || path in vfs || isDir(vfs, path);
}

export function readFile(vfs: Vfs, path: string): string | null {
  return path in vfs ? vfs[path]! : null;
}

export function writeFile(vfs: Vfs, path: string, content: string): void {
  vfs[path] = content;
}

export function mkdir(vfs: Vfs, path: string): void {
  vfs[normalizePath("/", path) + "/"] = "";
}

export function listDir(vfs: Vfs, path: string): { name: string; dir: boolean }[] {
  const prefix = path === "/" ? "/" : `${path}/`;
  const entries = new Map<string, boolean>();
  for (const key of Object.keys(vfs)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length).replace(/\/.*$/, "");
    if (!rest) continue;
    const child = prefix + rest;
    entries.set(rest, isDir(vfs, child));
  }
  return [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, dir]) => ({ name, dir }));
}

export function remove(vfs: Vfs, path: string, recursive = false): boolean {
  let removed = false;
  for (const key of Object.keys(vfs)) {
    if (key === path || key.startsWith(`${path}/`)) {
      if (key !== path && !recursive) continue;
      delete vfs[key];
      removed = true;
    }
  }
  return removed;
}

export function copy(vfs: Vfs, from: string, to: string): boolean {
  const content = readFile(vfs, from);
  if (content === null) return false;
  writeFile(vfs, to, content);
  return true;
}
