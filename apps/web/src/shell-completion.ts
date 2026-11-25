/** 构建期由教学镜像 `busybox --list` 固化到 public/shell-applets.txt（设计书 §6.1）。 */
export const FALLBACK_SHELL_APPLETS = [
  "ash", "awk", "basename", "cat", "chmod", "cp", "cut", "echo", "find", "grep",
  "head", "ls", "mkdir", "md5sum", "mv", "nc", "netstat", "pgrep", "ps", "pwd",
  "rm", "sed", "sort", "stat", "tail", "test", "touch", "tr", "uniq", "wc",
];

/** Shell 补全：命令名 + 课程镜像 applet 清单，按前缀过滤。 */
export function shellCompletions(applets: string[], prefix: string): string[] {
  const all = [...new Set([...FALLBACK_SHELL_APPLETS, ...applets])].sort();
  if (!prefix) return all;
  return all.filter((name) => name.startsWith(prefix));
}
