/** 功能开关：Container Shell 已启用（默认禁网，使用 c2w 真实容器终端）。 */
export const CONTAINER_SHELL_ENABLED = true;

export function canOpenView(view: string, containerShellEnabled = CONTAINER_SHELL_ENABLED): boolean {
  return view !== "container" || containerShellEnabled;
}
