import { describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import type { Env } from "../../src/types";

const learnerHtml = '<!doctype html><meta name="codequest-app" content="learner"><div id="root"></div>';
const adminHtml = '<!doctype html><meta name="codequest-app" content="admin"><div id="root"></div>';

function assets(files: Record<string, string>, spaFallback = false): Fetcher {
  return {
    async fetch(input: Request) {
      const path = new URL(input.url).pathname;
      const body = files[path] ?? (spaFallback ? files["/index.html"] : undefined);
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

describe("学习端显式页面路由", () => {
  it("已知页面与课程深链接统一返回学习端 index，并使用 no-cache", async () => {
    const fetcher = assets({ "/index.html": learnerHtml, "/admin/index.html": adminHtml });
    for (const path of ["/setup", "/login", "/password", "/courses", "/courses/", "/courses/demo", "/free", "/container"]) {
      const response = await call(path, fetcher);
      const html = await response.text();
      expect(response.status, path).toBe(200);
      expect(html, path).toContain('name="codequest-app" content="learner"');
      expect(html, path).not.toContain('name="codequest-app" content="admin"');
      expect(response.headers.get("cache-control"), path).toBe("no-cache");
    }
  });

  it("未知导航路径仍由 SPA fallback 返回学习端 HTML，由前端渲染 404", async () => {
    const response = await call("/missing-page", assets({ "/index.html": learnerHtml }, true));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('name="codequest-app" content="learner"');
  });

  it("API 未知路径保持 JSON 鉴权错误，不回退到学习端 HTML", async () => {
    const response = await call("/api/v1/missing", assets({ "/index.html": learnerHtml }, true));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("缺失或错误应用标记的学习端产物明确返回 404", async () => {
    const missing = await call("/courses", assets({}));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("学习端未构建");

    const wrongApp = await call("/free", assets({ "/index.html": adminHtml }));
    expect(wrongApp.status).toBe(404);
    expect(await wrongApp.text()).toContain("学习端未构建");
  });

  it("静态资源仍按原路径读取，缺失资源不会进入页面路由", async () => {
    const fetcher = assets({ "/assets/app.js": "console.log('learner')" });
    const response = await call("/assets/app.js", fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(await response.text()).toBe("console.log('learner')");

    const missing = await call("/assets/missing.js", fetcher);
    expect(missing.status).toBe(404);
  });
});
