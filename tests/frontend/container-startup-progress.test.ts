import { describe, expect, it } from "vitest";
import { formatRuntimeBytes, startupPercent } from "../../apps/web/src/components/ContainerStartupProgress";

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
});
