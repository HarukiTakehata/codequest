import { useCallback, useEffect, useState } from "react";

export type LearnerRoute =
  | { name: "setup" }
  | { name: "login" }
  | { name: "password" }
  | { name: "courses" }
  | { name: "course"; courseId: string }
  | { name: "free" }
  | { name: "container" }
  | { name: "notfound" };

export type NavigableLearnerRoute = Exclude<LearnerRoute, { name: "notfound" }>;

export const LEARNER_PATHS = {
  setup: "/setup",
  login: "/login",
  password: "/password",
  courses: "/courses",
  free: "/free",
  container: "/container",
} as const;

export function coursePath(courseId: string): string {
  return `${LEARNER_PATHS.courses}/${encodeURIComponent(courseId)}`;
}

export function routeFromPath(pathname: string): LearnerRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === LEARNER_PATHS.courses) return { name: "courses" };
  if (path === LEARNER_PATHS.setup) return { name: "setup" };
  if (path === LEARNER_PATHS.login) return { name: "login" };
  if (path === LEARNER_PATHS.password) return { name: "password" };
  if (path === LEARNER_PATHS.free) return { name: "free" };
  if (path === LEARNER_PATHS.container) return { name: "container" };

  const course = /^\/courses\/([^/]+)$/.exec(path)?.[1];
  if (course) {
    try {
      const courseId = decodeURIComponent(course);
      if (courseId && !courseId.includes("/")) return { name: "course", courseId };
    } catch {
      // Malformed percent-encoding is an unknown learner route.
    }
  }
  return { name: "notfound" };
}

export function pathForRoute(route: NavigableLearnerRoute): string {
  switch (route.name) {
    case "setup": return LEARNER_PATHS.setup;
    case "login": return LEARNER_PATHS.login;
    case "password": return LEARNER_PATHS.password;
    case "courses": return LEARNER_PATHS.courses;
    case "course": return coursePath(route.courseId);
    case "free": return LEARNER_PATHS.free;
    case "container": return LEARNER_PATHS.container;
  }
}

export function isProtectedRoute(route: LearnerRoute): route is Extract<LearnerRoute, { name: "courses" | "course" | "free" | "container" }> {
  return route.name === "courses" || route.name === "course" || route.name === "free" || route.name === "container";
}

export function useLearnerRoute() {
  const [route, setRoute] = useState<LearnerRoute>(() => routeFromPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: NavigableLearnerRoute, replace = false) => {
    const path = pathForRoute(next);
    if (window.location.pathname !== path) {
      window.history[replace ? "replaceState" : "pushState"](null, "", path);
    }
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return { route, navigate };
}
