import type { RunRequest, RunResponse } from "@codequest/judge";
import {
  copy, exists, isDir, listDir, mkdir, normalizePath, readFile, remove, writeFile,
  type Vfs,
} from "./vfs";

export interface ShellState {
  vfs: Vfs;
  cwd: string;
  env: Record<string, string>;
}

export interface ShellRunResponse extends RunResponse {
  files: Vfs;
  cwd: string;
}

type CommandResult = { stdout: string; stderr: string; exitCode: number };
type Command = (args: string[], stdin: string, state: ShellState) => CommandResult;

const out = (stdout: string): CommandResult => ({ stdout, stderr: "", exitCode: 0 });
const err = (message: string): CommandResult => ({ stdout: "", stderr: `${message}\n`, exitCode: 1 });

function resolve(state: ShellState, path: string): string {
  const expanded = path.startsWith("~")
    ? `/home/student${path.slice(1)}`
    : path.replace(/\$(\w+)/g, (_, key: string) => state.env[key] ?? "");
  return normalizePath(state.cwd, expanded);
}

function readInputs(state: ShellState, args: string[], stdin: string): string | null {
  const files = args.filter((arg) => !arg.startsWith("-"));
  if (!files.length) return stdin;
  let combined = "";
  for (const file of files) {
    const content = readFile(state.vfs, resolve(state, file));
    if (content === null) return null;
    combined += content.endsWith("\n") || !content ? content : `${content}\n`;
  }
  return combined;
}

function glob(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

const commands: Record<string, Command> = {
  echo: (args) => out(`${args.join(" ")}\n`),
  pwd: (_args, _stdin, state) => out(`${state.cwd}\n`),
  cd: (args, _stdin, state) => {
    const target = resolve(state, args[0] ?? "/home/student");
    if (!isDir(state.vfs, target)) return err(`cd: ${args[0]}: 目录不存在`);
    state.cwd = target;
    return out("");
  },
  ls: (args, _stdin, state) => {
    const target = resolve(state, args.find((a) => !a.startsWith("-")) ?? ".");
    const entries = listDir(state.vfs, target);
    if (!entries.length && !isDir(state.vfs, target)) return err(`ls: ${args[0]}: 不存在`);
    const long = args.includes("-l");
    const visible = args.includes("-a") ? entries : entries.filter((e) => !e.name.startsWith("."));
    if (long) {
      return out(visible.map((e) => `${e.dir ? "d" : "-"}rw-r--r--  ${e.name}`).join("\n") + (visible.length ? "\n" : ""));
    }
    return out(visible.map((e) => e.dir ? `${e.name}/` : e.name).join(" ") + (visible.length ? "\n" : ""));
  },
  cat: (args, stdin, state) => {
    const content = readInputs(state, args, stdin);
    return content === null ? err(`cat: ${args[0]}: 不存在`) : out(content);
  },
  head: (args, stdin, state) => {
    const nIndex = args.indexOf("-n");
    const n = nIndex >= 0 ? Number(args[nIndex + 1]) : 10;
    const content = readInputs(state, args.filter((a) => a !== "-n" && a !== String(n)), stdin) ?? "";
    return out(content.split("\n").slice(0, Number.isFinite(n) ? n : 10).join("\n").replace(/\n*$/, "") + "\n");
  },
  tail: (args, stdin, state) => {
    const nIndex = args.indexOf("-n");
    const n = nIndex >= 0 ? Number(args[nIndex + 1]) : 10;
    const content = readInputs(state, args.filter((a) => a !== "-n" && a !== String(n)), stdin) ?? "";
    const lines = content.replace(/\n$/, "").split("\n");
    return out(lines.slice(Math.max(0, lines.length - (Number.isFinite(n) ? n : 10))).join("\n") + "\n");
  },
  grep: (args, stdin, state) => {
    const insensitive = args.includes("-i");
    const invert = args.includes("-v");
    const numbered = args.includes("-n");
    const positional = args.filter((a) => !a.startsWith("-"));
    const pattern = positional.shift() ?? "";
    const content = readInputs(state, positional, stdin) ?? "";
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, insensitive ? "i" : "");
    } catch {
      return err(`grep: 无效正则: ${pattern}`);
    }
    const matches = content.replace(/\n$/, "").split("\n")
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => regex.test(line) !== invert)
      .map(({ line, i }) => (numbered ? `${i + 1}:${line}` : line));
    return out(matches.length ? matches.join("\n") + "\n" : "");
  },
  sort: (args, stdin, state) => {
    const reverse = args.includes("-r");
    const unique = args.includes("-u");
    const content = readInputs(state, args.filter((a) => !a.startsWith("-")), stdin) ?? "";
    let lines = content.replace(/\n$/, "").split("\n").filter(Boolean).sort((a, b) => a.localeCompare(b));
    if (reverse) lines = lines.reverse();
    if (unique) lines = lines.filter((line, i) => line !== lines[i - 1]);
    return out(lines.length ? lines.join("\n") + "\n" : "");
  },
  uniq: (args, stdin, state) => {
    const count = args.includes("-c");
    const content = readInputs(state, args.filter((a) => !a.startsWith("-")), stdin) ?? "";
    const lines = content.replace(/\n$/, "").split("\n").filter(Boolean);
    const groups: { line: string; n: number }[] = [];
    for (const line of lines) {
      if (groups[groups.length - 1]?.line === line) groups[groups.length - 1]!.n++;
      else groups.push({ line, n: 1 });
    }
    return out(groups.map((g) => count ? `${String(g.n).padStart(7)} ${g.line}` : g.line).join("\n") + (groups.length ? "\n" : ""));
  },
  wc: (args, stdin, state) => {
    const content = readInputs(state, args.filter((a) => !a.startsWith("-")), stdin) ?? "";
    const lines = content ? content.replace(/\n$/, "").split("\n").length : 0;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const bytes = new TextEncoder().encode(content).length;
    if (args.includes("-l")) return out(` ${lines}\n`);
    if (args.includes("-w")) return out(` ${words}\n`);
    if (args.includes("-c")) return out(` ${bytes}\n`);
    return out(` ${lines} ${words} ${bytes}\n`);
  },
  tr: (args, stdin) => {
    const [from, to] = args;
    if (!from || !to) return err("tr: 需要两个字符集");
    return out(stdin.replace(new RegExp(`[${from}]`, "g"), (ch) => to[from.indexOf(ch)] ?? ch));
  },
  cut: (args, stdin, state) => {
    const dIndex = args.indexOf("-d");
    const fIndex = args.indexOf("-f");
    const delimiter = dIndex >= 0 ? args[dIndex + 1]! : "\t";
    const field = fIndex >= 0 ? Number(args[fIndex + 1]) : 1;
    const content = readInputs(state, args.filter((a) => !["-d", "-f", delimiter, String(field)].includes(a)), stdin) ?? "";
    return out(content.replace(/\n$/, "").split("\n")
      .map((line) => line.split(delimiter)[field - 1] ?? "").join("\n") + "\n");
  },
  touch: (args, _stdin, state) => {
    for (const file of args) writeFile(state.vfs, resolve(state, file), readFile(state.vfs, resolve(state, file)) ?? "");
    return out("");
  },
  mkdir: (args, _stdin, state) => {
    const parent = args.includes("-p");
    for (const dir of args.filter((a) => !a.startsWith("-"))) {
      const target = resolve(state, dir);
      if (parent) {
        const parts = target.split("/").filter(Boolean);
        parts.forEach((_, i) => mkdir(state.vfs, "/" + parts.slice(0, i + 1).join("/")));
      } else mkdir(state.vfs, target);
    }
    return out("");
  },
  cp: (args, _stdin, state) => {
    const [from, to] = args.filter((a) => !a.startsWith("-"));
    if (!from || !to || !copy(state.vfs, resolve(state, from), resolve(state, to))) return err("cp: 源文件不存在");
    return out("");
  },
  mv: (args, _stdin, state) => {
    const [from, to] = args.filter((a) => !a.startsWith("-"));
    if (!from || !to || !copy(state.vfs, resolve(state, from), resolve(state, to))) return err("mv: 源文件不存在");
    remove(state.vfs, resolve(state, from));
    return out("");
  },
  rm: (args, _stdin, state) => {
    const recursive = args.includes("-r") || args.includes("-rf") || args.includes("-fr");
    for (const file of args.filter((a) => !a.startsWith("-"))) {
      if (!remove(state.vfs, resolve(state, file), recursive)) return err(`rm: ${file}: 不存在`);
    }
    return out("");
  },
  find: (args, _stdin, state) => {
    const nameIndex = args.indexOf("-name");
    const pattern = nameIndex >= 0 ? args[nameIndex + 1]! : "*";
    const root = resolve(state, args.find((a) => !a.startsWith("-") && a !== pattern) ?? ".");
    const matcher = glob(pattern);
    const results: string[] = [];
    const walk = (dir: string) => {
      for (const entry of listDir(state.vfs, dir)) {
        const path = `${dir === "/" ? "" : dir}/${entry.name}`;
        if (matcher.test(entry.name)) results.push(path);
        if (entry.dir) walk(path);
      }
    };
    if (exists(state.vfs, root)) walk(root);
    return out(results.length ? results.join("\n") + "\n" : "");
  },
  test: (args, _stdin, state) => {
    const flag = args[0];
    const path = resolve(state, args[1] ?? "");
    if (flag === "-f") return path in state.vfs ? out("") : err("");
    if (flag === "-d") return isDir(state.vfs, path) ? out("") : err("");
    if (flag === "-e") return exists(state.vfs, path) ? out("") : err("");
    return err("test: 不支持的运算符");
  },
  stat: (args, _stdin, state) => {
    const path = resolve(state, args[0] ?? "");
    if (!exists(state.vfs, path)) return err(`stat: ${args[0]}: 不存在`);
    return out(`  File: ${path}\n  Size: ${new TextEncoder().encode(readFile(state.vfs, path) ?? "").length}\n`);
  },
  md5sum: (args, _stdin, state) => {
    // 教学用确定性摘要（FNV-1a 64 位近似），仅用于「内容变化检测」类题目。
    const hash = (text: string) => {
      let h = 0xcbf29ce484222325n;
      for (const byte of new TextEncoder().encode(text)) {
        h = (h ^ BigInt(byte)) * 0x100000001b3n & 0xffffffffffffffffn;
      }
      return h.toString(16).padStart(16, "0");
    };
    return out(args.map((arg) => {
      const content = readFile(state.vfs, resolve(state, arg));
      return content === null ? `md5sum: ${arg}: 不存在` : `${hash(content)}  ${arg}`;
    }).join("\n") + "\n");
  },
  seq: (args) => {
    const [start, end] = args.map(Number);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return err("seq: 需要起止数字");
    const values = Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i);
    return out(values.join("\n") + "\n");
  },
  true: () => out(""),
  false: () => err(""),
};

export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; hasToken = true; continue; }
    if (ch === " " || ch === "\t") {
      if (hasToken) { tokens.push(current); current = ""; hasToken = false; }
      continue;
    }
    if (ch === "|" || ch === ">") {
      if (hasToken) { tokens.push(current); current = ""; hasToken = false; }
      if (ch === ">" && line[i + 1] === ">") { tokens.push(">>"); i++; }
      else tokens.push(ch);
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

function runCommand(tokens: string[], stdin: string, state: ShellState): CommandResult {
  const [name, ...args] = tokens;
  const command = commands[name!];
  if (!command) return err(`${name}: command not found`);
  try {
    return command(args, stdin, state);
  } catch (error) {
    return err(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runPipeline(tokens: string[], stdin: string, state: ShellState): CommandResult {
  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (token === "|") segments.push([]);
    else segments[segments.length - 1]!.push(token);
  }
  let currentStdin = stdin;
  let result: CommandResult = out("");
  for (const segment of segments) {
    result = runCommand(segment, currentStdin, state);
    if (result.stderr) return result;
    currentStdin = result.stdout;
  }
  return result;
}

/** Shell 运行时内核：支持教学子集（管道/重定向/文件操作），只在 Worker 内调用。 */
export function executeShell(request: RunRequest): ShellRunResponse {
  const state: ShellState = {
    vfs: { ...request.files },
    cwd: "/home/student",
    env: { HOME: "/home/student" },
  };
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  for (const rawLine of request.code.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const tokens = tokenize(line);
    const redirectIndex = tokens.findIndex((t) => t === ">" || t === ">>");
    let redirect: { path: string; append: boolean } | null = null;
    if (redirectIndex >= 0) {
      const path = tokens[redirectIndex + 1];
      if (!path) { stderr += "shell: 重定向缺少文件名\n"; exitCode = 1; continue; }
      redirect = { path, append: tokens[redirectIndex] === ">>" };
      tokens.splice(redirectIndex, 2);
    }
    const result = runPipeline(tokens, "", state);
    stderr += result.stderr;
    exitCode = result.exitCode;
    if (redirect) {
      const target = resolve(state, redirect.path);
      const previous = redirect.append ? (readFile(state.vfs, target) ?? "") : "";
      writeFile(state.vfs, target, previous + result.stdout);
    } else {
      stdout += result.stdout;
    }
  }
  return { stdout, stderr, exitCode, files: state.vfs, cwd: state.cwd, logs: [] };
}
