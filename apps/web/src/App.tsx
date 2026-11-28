import { useEffect, useRef, useState } from "react";
import { api, type CourseInfo, type CoursePack, type Progress, type User } from "./api";
import { canOpenView } from "./features";
import { Stage } from "./components/Stage";
import { FreeMode } from "./components/FreeMode";
import { ContainerShell } from "./components/ContainerShell";
import { ChangePasswordPage, CourseList, LoginPage, SetupWizard } from "./components/Screens";
import { AppShell } from "./components/AppShell";
import { ProfilePanel } from "./components/ProfilePanel";
import type { MessageKey } from "./i18n";
import { useI18n } from "./i18n/I18nProvider";
import {
  isProtectedRoute, LEARNER_PATHS, pathForRoute, useLearnerRoute,
  type NavigableLearnerRoute,
} from "./router";
import "./styles.css";

type AuthView = "loading" | "setup" | "login" | "password" | "ready";

export default function App() {
  return <CodeQuestApp />;
}

function CodeQuestApp() {
  const { t } = useI18n();
  const { route, navigate } = useLearnerRoute();
  const [view, setView] = useState<AuthView>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [instanceName, setInstanceName] = useState("CodeQuest");
  const [adminUrl, setAdminUrl] = useState("/admin/");
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [pack, setPack] = useState<CoursePack | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseError, setCourseError] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [authNotice, setAuthNotice] = useState<MessageKey | null>(null);
  const pendingRoute = useRef<NavigableLearnerRoute | null>(null);
  const knownCourse = useRef<CourseInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const setup = await api.setupStatus();
        if (cancelled) return;
        if (setup.instance_name) setInstanceName(setup.instance_name);
        setAdminUrl(setup.admin_url || "/admin/");
        if (setup.needs_setup) {
          setView("setup");
          return;
        }
      } catch {
        // 后端不可达时继续尝试会话，最终退到登录页。
      }
      try {
        const me = await api.me();
        if (cancelled) return;
        setUser(me.user);
        setView(me.user.must_change_password ? "password" : "ready");
      } catch {
        if (!cancelled) {
          setUser(null);
          setView("login");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (view === "loading") return;
    if (view === "setup") {
      if (route.name !== "setup") navigate({ name: "setup" }, true);
      return;
    }
    if (view === "login") {
      if (route.name !== "login") {
        if (isProtectedRoute(route)) pendingRoute.current = route;
        navigate({ name: "login" }, true);
      } else if (window.location.pathname !== pathForRoute(route)) {
        navigate(route, true);
      }
      return;
    }
    if (view === "password") {
      if (!user) return;
      if (route.name !== "password") {
        if (isProtectedRoute(route)) pendingRoute.current = route;
        navigate({ name: "password" }, true);
      } else if (window.location.pathname !== pathForRoute(route)) {
        navigate(route, true);
      }
      return;
    }
    if (view === "ready" && user && !user.must_change_password) {
      if (route.name === "setup" || route.name === "login" || route.name === "password") {
        navigate({ name: "courses" }, true);
        return;
      }
      if (route.name === "container" && !canOpenView("container")) {
        navigate({ name: "courses" }, true);
        return;
      }
      if (route.name !== "notfound" && window.location.pathname !== pathForRoute(route)) {
        navigate(route, true);
      }
    }
  }, [view, route, user, navigate]);

  useEffect(() => { setProfileOpen(false); }, [route]);

  useEffect(() => {
    if (view !== "ready" || route.name !== "course") return;
    let cancelled = false;
    const courseId = route.courseId;
    const info = knownCourse.current?.id === courseId ? knownCourse.current : null;
    knownCourse.current = null;
    setCourseLoading(true);
    setCourseError(false);

    const courseResult = info
      ? Promise.resolve(info)
      : api.courses().then((result) => {
        const match = result.courses.find((item) => item.id === courseId);
        if (!match) throw new Error("Course not found");
        return match;
      });

    void Promise.all([courseResult, api.pack(courseId), api.progress(courseId)])
      .then(([nextCourse, packResult, progressResult]) => {
        if (cancelled) return;
        setCourse(nextCourse);
        setPack(packResult.pack);
        setProgress(progressResult.progress);
      })
      .catch(() => {
        if (cancelled) return;
        setCourse(null);
        setPack(null);
        setCourseError(true);
      })
      .finally(() => {
        if (!cancelled) setCourseLoading(false);
      });

    return () => { cancelled = true; };
  }, [view, route, user?.id]);

  useEffect(() => {
    let title: string;
    if (view === "loading") title = t("app.connecting");
    else if (view === "setup") title = t("setup.title");
    else if (view === "login") title = t("login.title");
    else if (view === "password") title = t("password.title");
    else if (route.name === "course") title = courseError ? t("courses.loadFailed") : course?.id === route.courseId ? course.title : t("courses.loading");
    else if (route.name === "free") title = t("free.title");
    else if (route.name === "container") title = t("container.title");
    else if (route.name === "notfound") title = t("routes.notFoundTitle");
    else title = t("courses.heading");
    document.title = `${title} · ${instanceName}`;
    const frame = window.requestAnimationFrame(() => { document.title = `${title} · ${instanceName}`; });
    return () => window.cancelAnimationFrame(frame);
  }, [view, route, course, courseError, instanceName, t]);

  const onAuthDone = (next: User | null, nextInstanceName?: string) => {
    if (!next) {
      pendingRoute.current = null;
      setProfileOpen(false);
      setUser(null);
      setCourse(null);
      setPack(null);
      setView("login");
      navigate({ name: "login" }, true);
      return;
    }
    setAuthNotice(null);
    if (nextInstanceName) setInstanceName(nextInstanceName);
    setUser(next);
    if (next.must_change_password) {
      setView("password");
      return;
    }
    const destination: NavigableLearnerRoute = pendingRoute.current ?? { name: "courses" };
    pendingRoute.current = null;
    setView("ready");
    navigate(destination, true);
  };

  const logout = () => {
    void api.logout().catch(() => undefined);
    pendingRoute.current = null;
    setProfileOpen(false);
    setAuthNotice(null);
    setUser(null);
    setCourse(null);
    setPack(null);
    setView("login");
    navigate({ name: "login" }, true);
  };

  const openCourse = (info: CourseInfo) => {
    knownCourse.current = info;
    navigate({ name: "course", courseId: info.id });
  };

  return (
    <AppShell
      appName={instanceName}
      user={user}
      adminUrl={adminUrl}
      homeHref={view === "ready" ? LEARNER_PATHS.courses : undefined}
      onProfile={view === "ready" && user && !user.must_change_password ? () => setProfileOpen(true) : undefined}
      onLogout={logout}
    >
      {profileOpen && user && (
        <ProfilePanel
          user={user}
          onClose={() => setProfileOpen(false)}
          onUpdated={(nextUser) => setUser(nextUser)}
        />
      )}
      {view === "loading" && <div className="loading-screen" role="status"><span className="loading-orbit" /><p>{t("app.connecting")}</p></div>}
      {view === "setup" && <SetupWizard onDone={onAuthDone} />}
      {view === "login" && <LoginPage onDone={onAuthDone} notice={authNotice ?? undefined} />}
      {view === "password" && user && (
        <ChangePasswordPage
          user={user}
          onDone={onAuthDone}
          onLoginNotice={() => setAuthNotice("password.changedNotice")}
        />
      )}
      {view === "ready" && user && (
        <>
          {route.name === "courses" && (
            <CourseList
              user={user}
              onOpen={openCourse}
              onFree={() => navigate({ name: "free" })}
              onContainer={() => { if (canOpenView("container")) navigate({ name: "container" }); }}
            />
          )}
          {route.name === "free" && <FreeMode onBack={() => navigate({ name: "courses" })} />}
          {route.name === "container" && canOpenView("container") && <ContainerShell onBack={() => navigate({ name: "courses" })} />}
          {route.name === "course" && courseLoading && (
            <div className="loading-screen" role="status"><span className="loading-orbit" /><p>{t("courses.loading")}</p></div>
          )}
          {route.name === "course" && courseError && (
            <NotFoundPage title={t("courses.loadFailed")} description={t("routes.notFoundDescription")} onBack={() => navigate({ name: "courses" })} />
          )}
          {route.name === "course" && course?.id === route.courseId && pack && (
            <Stage key={course.id} courseId={course.id} pack={pack} progress={progress} onBack={() => navigate({ name: "courses" })} />
          )}
          {route.name === "notfound" && <NotFoundPage title={t("routes.notFoundTitle")} description={t("routes.notFoundDescription")} onBack={() => navigate({ name: "courses" })} />}
        </>
      )}
    </AppShell>
  );
}

function NotFoundPage({ title, description, onBack }: { title: string; description: string; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <div className="page-container">
      <section className="empty-state" aria-labelledby="not-found-title">
        <h1 id="not-found-title">{title}</h1>
        <p>{description}</p>
        <a className="button button-primary" href={LEARNER_PATHS.courses} onClick={(event) => {
          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            onBack();
          }
        }}>{t("stage.back")}</a>
      </section>
    </div>
  );
}
