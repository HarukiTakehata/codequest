import { describe, expect, it, vi } from "vitest";
import { api, type User } from "../../apps/web/src/api";

const user: User = {
  id: "usr_admin",
  username: "owner",
  email: null,
  display_name: null,
  role: "admin",
  must_change_password: false,
};

describe("学习端认证 API", () => {
  it("登录请求发送 identifier 与密码", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (path: string, options: RequestInit) => {
      requests.push({ path, body: JSON.parse(String(options.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ user }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    try {
      await api.login("owner", "owner-password-123");
      expect(requests).toEqual([{
        path: "/api/v1/auth/login",
        body: { identifier: "owner", password: "owner-password-123" },
      }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("初始化请求包含必填用户名与可空邮箱", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (path: string, options: RequestInit) => {
      requests.push({ path, body: JSON.parse(String(options.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ user, instance_name: "学习实例" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });
    try {
      await api.setup("学习实例", { username: "owner", email: null, password: "owner-password-123" });
      expect(requests).toEqual([{
        path: "/api/v1/setup",
        body: {
          instance_name: "学习实例",
          admin: { username: "owner", email: null, password: "owner-password-123" },
        },
      }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
