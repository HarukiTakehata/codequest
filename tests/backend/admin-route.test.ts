import { describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import type { Env } from "../../src/types";

const adminHtml = '<!doctype html><meta name="codequest-app" content="admin"><div id="root"></div>';
const webHtml = '<!doctype html><div id="root">learning app</div>';

function assets(files: Record<string, string>): Fetcher {
  return {
    async fetch(input: Request) {
      const path = new URL(input.url).pathname;
      const body = files[path];
      if (body === undefined) return new Response("missing", { status: 404 });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html" },
      });
    },
  } as unknown as Fetcher;
}

function call(path: string, fetcher?: Fetcher) {
  const env = { ...(fetcher ? { ASSETS: fetcher } : {}) } as Env;
  return createApp().fetch(new Request(`https://test.local${path}`), env, {
    waitUntil() {}, passThroughOnException() {},
  } as unknown as ExecutionContext);
}

describe("同源管理面板 /admin 路由", () => {
  it("/admin 跳转到 /admin/，管理端 HTML 与深层路由不会回退到学习端", async () => {
    const fetcher = assets({
      "/admin/index.html": adminHtml,
      "/admin/assets/app.js": "console.log('admin')",
      "/index.html": webHtml,
    });
    const redirect = await call("/admin", fetcher);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/admin/");
    expect(redirect.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(redirect.headers.get("strict-transport-security")).toBe("max-age=31536000");

    for (const path of ["/admin/", "/admin/overview", "/admin/accounts", "/admin/audit/"]) {
      const response = await call(path, fetcher);
      expect(response.status, path).toBe(200);
      expect(await response.text()).toContain('name="codequest-app" content="admin"');
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
      expect(response.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("管理端静态资源从 /admin/assets 读取，缺失资源不会返回学习端 HTML", async () => {
    const fetcher = assets({
      "/admin/index.html": adminHtml,
      "/admin/assets/app.js": "console.log('admin')",
      "/index.html": webHtml,
    });
    const script = await call("/admin/assets/app.js", fetcher);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect(script.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(script.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(await script.text()).toBe("console.log('admin')");

    const missing = await call("/admin/assets/missing.js", fetcher);
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain("learning app");
  });

  it("未构建管理面板时明确返回 404，而不是静默展示学习端主页", async () => {
    const response = await call("/admin/overview", assets({ "/index.html": webHtml }));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("管理面板未构建");
  });
});
