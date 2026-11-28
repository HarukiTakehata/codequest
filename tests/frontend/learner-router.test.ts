import { describe, expect, it } from "vitest";
import {
  coursePath, isProtectedRoute, LEARNER_PATHS, pathForRoute, routeFromPath,
} from "../../apps/web/src/router";

describe("学习端显式路由", () => {
  it("根路径、课程列表与尾斜杠映射到课程页", () => {
    expect(routeFromPath("/")).toEqual({ name: "courses" });
    expect(routeFromPath("/courses")).toEqual({ name: "courses" });
    expect(routeFromPath("/courses/")).toEqual({ name: "courses" });
  });

  it.each([
    ["/setup", "setup"],
    ["/login", "login"],
    ["/password", "password"],
    ["/free", "free"],
    ["/container", "container"],
  ] as const)("%s 映射到对应页面", (path, name) => {
    expect(routeFromPath(path)).toEqual({ name });
    expect(routeFromPath(`${path}/`)).toEqual({ name });
  });

  it("课程深链接解码课程 ID 并拒绝非法路径", () => {
    expect(routeFromPath("/courses/demo")).toEqual({ name: "course", courseId: "demo" });
    expect(routeFromPath("/courses/course%20one/")).toEqual({ name: "course", courseId: "course one" });
    expect(routeFromPath("/courses/%E0%A4%A")).toEqual({ name: "notfound" });
    expect(routeFromPath("/courses/demo/challenges/ch01")).toEqual({ name: "notfound" });
    expect(routeFromPath("/courses/a%2Fb")).toEqual({ name: "notfound" });
  });

  it("未知路径进入学习端 404，不静默回到课程页", () => {
    expect(routeFromPath("/missing")).toEqual({ name: "notfound" });
    expect(routeFromPath("/admin")).toEqual({ name: "notfound" });
  });

  it("可为所有可导航页面生成稳定路径", () => {
    expect(pathForRoute({ name: "setup" })).toBe(LEARNER_PATHS.setup);
    expect(pathForRoute({ name: "login" })).toBe(LEARNER_PATHS.login);
    expect(pathForRoute({ name: "password" })).toBe(LEARNER_PATHS.password);
    expect(pathForRoute({ name: "courses" })).toBe(LEARNER_PATHS.courses);
    expect(pathForRoute({ name: "free" })).toBe(LEARNER_PATHS.free);
    expect(pathForRoute({ name: "container" })).toBe(LEARNER_PATHS.container);
    expect(pathForRoute({ name: "course", courseId: "course one" })).toBe("/courses/course%20one");
    expect(coursePath("demo")).toBe("/courses/demo");
  });

  it("认证门禁只保护登录后页面", () => {
    expect(isProtectedRoute({ name: "courses" })).toBe(true);
    expect(isProtectedRoute({ name: "course", courseId: "demo" })).toBe(true);
    expect(isProtectedRoute({ name: "free" })).toBe(true);
    expect(isProtectedRoute({ name: "container" })).toBe(true);
    expect(isProtectedRoute({ name: "login" })).toBe(false);
    expect(isProtectedRoute({ name: "setup" })).toBe(false);
    expect(isProtectedRoute({ name: "password" })).toBe(false);
    expect(isProtectedRoute({ name: "notfound" })).toBe(false);
  });
});
