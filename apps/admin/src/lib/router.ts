import { useCallback, useEffect, useState } from "react";

export type AdminRoute = "overview" | "batches" | "accounts" | "courses" | "audit" | "notfound";

const paths: Record<AdminRoute, string> = {
  overview: "/overview",
  batches: "/batches",
  accounts: "/accounts",
  courses: "/courses",
  audit: "/audit",
  notfound: "/overview",
};

function routePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return "/";
  if (path.startsWith("/admin/")) return path.slice("/admin".length) || "/";
  return path;
}

function adminBase(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/admin" || path.startsWith("/admin/") ? "/admin" : "";
}

export function routeFromPath(pathname: string): AdminRoute {
  const path = routePath(pathname);
  if (path === "/" || path === "/overview") return "overview";
  if (path === "/batches") return "batches";
  if (path === "/accounts") return "accounts";
  if (path === "/courses") return "courses";
  if (path === "/audit") return "audit";
  return "notfound";
}

export function useAdminRoute() {
  const [route, setRoute] = useState<AdminRoute>(() => routeFromPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: AdminRoute, replace = false) => {
    const path = `${adminBase(window.location.pathname)}${paths[next]}`;
    if (window.location.pathname !== path) {
      window.history[replace ? "replaceState" : "pushState"](null, "", path);
    }
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return { route, navigate };
}
