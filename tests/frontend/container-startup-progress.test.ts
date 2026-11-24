import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ContainerStartupProgress,
  formatRuntimeBytes,
  startupPercent,
  type ContainerStartupProgressState,
} from "../../apps/web/src/components/ContainerStartupProgress";
import { I18nProvider } from "../../apps/web/src/i18n/I18nProvider";

function renderProgress(progress: ContainerStartupProgressState) {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: "en" },
    createElement(ContainerStartupProgress, { progress }),
  ));
}

describe("Container Shell 启动进度计算", () => {
  it("按已传输 / 总大小计算百分比并限制在 0-100", () => {
    expect(startupPercent(0, 100)).toBe(0);
    expect(startupPercent(25, 100)).toBe(25);
    expect(startupPercent(150, 100)).toBe(100);
    expect(startupPercent(10, 0)).toBe(0);
  });

  it("以 MiB 显示运行时工件大小", () => {
    expect(formatRuntimeBytes(0)).toBe("0 MiB");
    expect(formatRuntimeBytes(1024 * 1024)).toBe("1.0 MiB");
    expect(formatRuntimeBytes(37_903_167)).toBe("36.1 MiB");
  });

  it("下载阶段渲染确定进度条与实际百分比", () => {
    const markup = renderProgress({ phase: "downloading", loaded: 25, total: 100 });
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="25"');
    expect(markup).toContain('class="container-startup-bar is-determinate"');
    expect(markup).toContain('style="width:25%"');
  });

  it("启动与失败阶段渲染不定进度条和可访问状态", () => {
    const starting = renderProgress({ phase: "starting" });
    expect(starting).toContain('class="container-startup-bar is-indeterminate"');
    expect(starting).toContain('aria-valuetext="Starting"');
    expect(starting).not.toContain('style="width:');

    const failed = renderProgress({ phase: "error", message: "Download failed" });
    expect(failed).toContain('class="container-startup-bar is-indeterminate"');
    expect(failed).toContain('aria-valuetext="Loading failed"');
    expect(failed).toContain("Download failed");
  });
});
