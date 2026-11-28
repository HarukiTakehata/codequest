import { describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import type { Env } from "../../src/types";

const editorHtml = '<!doctype html><meta name="codequest-app" content="editor"><div id="root"></div>';
const webHtml = '<!doctype html><div id="root">learning app</div>';

function assets(files: Record<string, string>, spaFallback = false): Fetcher {
  return {
    async fetch(input: Request) {
      const path = new URL(input.url).pathname;
      const body = files[path] ?? (spaFallback ? files["/index.html"] : undefined);
      if (body === undefined) return new Response("missing", { status: 404 });
      const usedFallback = files[path] === undefined;
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": usedFallback ? "text/html" : path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
        },
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

describe("同源 RPGJS 地图编辑器 /editor 路由", () => {
  it("/editor 跳转到 /editor/，HTML 与深层路由只回退到编辑器 index", async () => {
    const fetcher = assets({
      "/editor/index.html": editorHtml,
      "/editor/assets/app.js": "console.log('editor')",
      "/index.html": webHtml,
    });
    const redirect = await call("/editor", fetcher);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/editor/");
    expect(redirect.headers.get("content-security-policy")).toContain("default-src 'self'");

    for (const path of ["/editor/", "/editor/index.html", "/editor/maps/starter", "/editor/maps/starter/"]) {
      const response = await call(path, fetcher);
      const html = await response.text();
      expect(response.status, path).toBe(200);
      expect(html).toContain('name="codequest-app" content="editor"');
      expect(html).not.toContain("learning app");
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
      expect(response.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("静态资源从 /editor/assets 读取并带安全头，不会回退到学习端 HTML", async () => {
    const fetcher = assets({
      "/editor/index.html": editorHtml,
      "/editor/assets/app.js": "console.log('editor')",
      "/editor/assets/app.css": "body{}",
      "/index.html": webHtml,
    });
    for (const [path, contentType, body] of [
      ["/editor/assets/app.js", "text/javascript", "console.log('editor')"],
      ["/editor/assets/app.css", "text/css", "body{}"],
    ] as const) {
      const response = await call(path, fetcher);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(contentType);
      expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(await response.text()).toBe(body);
    }

    const missing = await call("/editor/assets/missing.js", fetcher);
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain("learning app");
  });

  it("即使 Assets SPA 回退返回学习端 HTML，缺失的编辑器资源仍明确 404", async () => {
    const fetcher = assets({
      "/editor/index.html": editorHtml,
      "/index.html": webHtml,
    }, true);
    const response = await call("/editor/assets/missing.js", fetcher);
    const body = await response.text();
    expect(response.status).toBe(404);
    expect(body).toContain("地图编辑器资源不存在");
    expect(body).not.toContain("learning app");
  });

  it("未构建或应用标记错误时明确返回 404，而不是静默展示学习端主页", async () => {
    const unbuilt = await call("/editor/maps/starter", assets({ "/index.html": webHtml }));
    expect(unbuilt.status).toBe(404);
    expect(await unbuilt.text()).toContain("地图编辑器未构建");

    const wrongApp = await call("/editor/", assets({
      "/editor/index.html": webHtml,
      "/index.html": editorHtml,
    }));
    expect(wrongApp.status).toBe(404);
    expect(await wrongApp.text()).toContain("地图编辑器未构建");
  });
});
