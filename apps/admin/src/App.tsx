import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Braces, LogOut } from "lucide-react";
import { api, errorMessage, setUnauthorizedHandler, type AdminConfig, type AdminUser } from "./api";
import { useAsyncData } from "./hooks/useAsyncData";
import { useAdminRoute } from "./lib/router";
import { AdminShell } from "./components/AdminShell";
import { ProfileDialog } from "./components/ProfileDialog";
import { AuthErrorPage, ChangePasswordPage, ForbiddenPage, LoginPage } from "./components/Auth";
import { useToast } from "./components/Toast";
import { Button } from "./components/ui";
import { OverviewPage } from "./pages/OverviewPage";
import { BatchesPage } from "./pages/BatchesPage";
import { AccountsPage } from "./pages/AccountsPage";
import { CoursesPage } from "./pages/CoursesPage";
import { AuditPage } from "./pages/AuditPage";

type AuthView = "loading" | "login" | "password" | "forbidden" | "error" | "ready";

export default function App() {
  const toast = useToast();
  const { route, navigate } = useAdminRoute();
  const routeRef = useRef(route);
  routeRef.current = route;
  const [authView, setAuthView] = useState<AuthView>("loading");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [authError, setAuthError] = useState<unknown>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const authRequest = useRef(0);

  const acceptUser = useCallback((nextUser: AdminUser) => {
    setUser(nextUser);
    setProfileOpen(false);
    setAuthNotice(null);
    if (nextUser.role !== "admin" && nextUser.role !== "teacher") {
      setAuthView("forbidden");
      return;
    }
    if (nextUser.must_change_password) {
      setAuthView("password");
      return;
    }
    setAuthView("ready");
    const requestedRoute = routeRef.current === "notfound" ? "overview" : routeRef.current;
    const destination = nextUser.role === "teacher" && requestedRoute === "audit" ? "overview" : requestedRoute;
    navigate(destination, true);
  }, [navigate]);

  const checkSession = useCallback(async () => {
    const request = ++authRequest.current;
    setAuthView("loading");
    setAuthError(null);
    try {
      const result = await api.me();
      if (request !== authRequest.current) return;
      acceptUser(result.user);
    } catch (reason) {
      if (request !== authRequest.current) return;
      if (reason instanceof Error && "status" in reason && reason.status === 401) {
        try {
          const status = await api.authStatus();
          if (request !== authRequest.current) return;
          setUser(null);
          if (status.needs_bootstrap) {
            try {
              const setupUrl = new URL(status.setup_url || "/setup", window.location.origin);
              if (setupUrl.protocol !== "http:" && setupUrl.protocol !== "https:") throw new Error("invalid setup URL");
              window.location.assign(setupUrl.href);
            } catch {
              setAuthError(new Error("初始化地址配置无效，请检查 LEARNER_URL。"));
              setAuthView("error");
            }
            return;
          }
          setAuthView("login");
        } catch (statusError) {
          if (request === authRequest.current) {
            setAuthError(statusError);
            setAuthView("error");
          }
        }
      } else {
        setAuthError(reason);
        setAuthView("error");
      }
    }
  }, [acceptUser]);

  useEffect(() => { void checkSession(); }, [checkSession]);

  useEffect(() => {
    if (authView === "ready" && user?.role === "teacher" && route === "audit") {
      navigate("overview", true);
    }
  }, [authView, navigate, route, user?.role]);

  useEffect(() => {
    if (authView !== "ready") {
      setUnauthorizedHandler(undefined);
      return;
    }
    setUnauthorizedHandler(() => {
      authRequest.current += 1;
      setUser(null);
      setAuthView("login");
      setAuthNotice("登录状态已失效，请重新登录。一次性凭证页面已关闭。");
    });
    return () => setUnauthorizedHandler(undefined);
  }, [authView]);

  useEffect(() => {
    const titles = { overview: "概览", batches: "批量发号", accounts: "成员账号", courses: "课程管理", audit: "审计记录", notfound: "页面未找到" };
    document.title = `${titles[route]} · CodeQuest 管理面板`;
  }, [route]);

  const config = useAsyncData<AdminConfig>(() => api.config(), [user?.id], authView === "ready");

  const logout = async () => {
    setLoggingOut(true);
    setProfileOpen(false);
    try {
      await api.logout();
      authRequest.current += 1;
      setUser(null);
      setAuthView("login");
      setAuthNotice("已安全退出管理面板。");
      navigate("overview", true);
      toast("已退出登录", "info");
    } catch (reason) {
      toast(`退出失败：${errorMessage(reason)}`, "error");
    } finally {
      setLoggingOut(false);
    }
  };

  const passwordChanged = () => {
    setProfileOpen(false);
    setUser(null);
    setAuthView("login");
    setAuthNotice("密码已更新，请使用新密码重新登录。");
    navigate("overview", true);
  };

  if (authView === "loading") {
    return <main className="connecting-page" role="status"><span className="brand-mark"><Braces size={25} /></span><span className="loading-orbit" /><h1>正在连接 CodeQuest</h1><p>确认用户会话与实例状态…</p></main>;
  }
  if (authView === "error") return <AuthErrorPage error={authError} onRetry={() => void checkSession()} />;
  if (authView === "login") return <><LoginPage onAuthenticated={acceptUser} />{authNotice && <div className="auth-notice" role="status"><span>{authNotice}</span><button type="button" onClick={() => setAuthNotice(null)} aria-label="关闭提示">×</button></div>}</>;
  if (authView === "password" && user) return <ChangePasswordPage user={user} onDone={passwordChanged} />;
  if (authView === "forbidden" && user) return <ForbiddenPage user={user} onLogout={() => void logout()} loggingOut={loggingOut} />;
  if (authView !== "ready" || !user) return null;
  const shellRoute = user.role === "teacher" && route === "audit" ? "overview" : route;

  return (
    <AdminShell
      user={user}
      route={shellRoute}
      navigate={navigate}
      onProfile={() => setProfileOpen(true)}
      onLogout={() => void logout()}
      loggingOut={loggingOut}
      config={config.data}
      configLoading={config.loading}
      configError={config.error}
      onReloadConfig={config.reload}
    >
      {profileOpen && (
        <ProfileDialog
          user={user}
          onClose={() => setProfileOpen(false)}
          onUpdated={(nextUser) => setUser(nextUser)}
        />
      )}
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      {shellRoute === "overview" && <OverviewPage role={user.role} config={config.data} configLoading={config.loading} configError={config.error} onReloadConfig={config.reload} navigate={navigate} />}
      {shellRoute === "batches" && <BatchesPage role={user.role} ttlHours={config.data?.download_link_ttl_hours ?? 24} />}
      {shellRoute === "accounts" && <AccountsPage role={user.role} />}
      {shellRoute === "courses" && <CoursesPage />}
      {shellRoute === "audit" && <AuditPage />}
      {shellRoute === "notfound" && (
        <section className="not-found panel" role="alert">
          <p className="eyebrow">404 · NOT FOUND</p><h1>这个页面不存在</h1><p>链接可能已变更，或地址输入有误。</p>
          <div><Button onClick={() => navigate("overview")}><ArrowLeft size={16} />返回概览</Button><Button variant="ghost" onClick={() => void logout()}><LogOut size={16} />退出登录</Button></div>
        </section>
      )}
    </AdminShell>
  );
}
