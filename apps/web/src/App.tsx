import { useEffect, useState } from "react";
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
import "./styles.css";

type View = "loading" | "setup" | "login" | "password" | "courses" | "game" | "free" | "container";

export default function App() {
  return <CodeQuestApp />;
}

function CodeQuestApp() {
  const { t } = useI18n();
  const [view, setView] = useState<View>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [instanceName, setInstanceName] = useState("CodeQuest");
  const [adminUrl, setAdminUrl] = useState("/admin/");
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [pack, setPack] = useState<CoursePack | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const [authNotice, setAuthNotice] = useState<MessageKey | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const setup = await api.setupStatus();
        if (setup.instance_name) setInstanceName(setup.instance_name);
        setAdminUrl(setup.admin_url || "/admin/");
        if (setup.needs_setup) {
          if (location.pathname !== "/setup") history.replaceState(null, "", "/setup");
          setView("setup"); return;
        }
      } catch { /* 后端不可达时退到登录页 */ }
      try {
        const me = await api.me();
        setUser(me.user);
        setView(me.user.must_change_password ? "password" : "courses");
      } catch { setView("login"); }
    })();
  }, []);

  const onAuthDone = (next: User | null, nextInstanceName?: string) => {
    if (location.pathname === "/setup") history.replaceState(null, "", "/");
    if (!next) { setProfileOpen(false); setUser(null); setView("login"); return; }
    setAuthNotice(null);
    if (nextInstanceName) setInstanceName(nextInstanceName);
    setUser(next);
    setView(next.must_change_password ? "password" : "courses");
  };

  const logout = () => {
    void api.logout().catch(() => undefined);
    setProfileOpen(false);
    setAuthNotice(null);
    setUser(null);
    setCourse(null);
    setPack(null);
    setView("login");
  };

  const openCourse = async (info: CourseInfo) => {
    const [packResult, progressResult] = await Promise.all([api.pack(info.id), api.progress(info.id)]);
    setCourse(info);
    setPack(packResult.pack);
    setProgress(progressResult.progress);
    setView("game");
  };

  return (
    <AppShell
      appName={instanceName}
      user={user}
      adminUrl={adminUrl}
      onProfile={user && !user.must_change_password ? () => setProfileOpen(true) : undefined}
      onLogout={logout}
    >
      {profileOpen && user && (
        <ProfilePanel
          user={user}
          onClose={() => setProfileOpen(false)}
          onUpdated={(nextUser) => setUser(nextUser)}
        />
      )}
      {view === "loading" && <div className="loading-screen"><span className="loading-orbit" /><p>{t("app.connecting")}</p></div>}
      {view === "setup" && <SetupWizard onDone={onAuthDone} />}
      {view === "login" && <LoginPage onDone={onAuthDone} notice={authNotice ?? undefined} />}
      {view === "password" && user && (
        <ChangePasswordPage
          user={user}
          onDone={onAuthDone}
          onLoginNotice={() => setAuthNotice("password.changedNotice")}
        />
      )}
      {view === "courses" && user && (
        <CourseList
          user={user}
          onOpen={(c) => void openCourse(c)}
          onFree={() => setView("free")}
          onContainer={() => { if (canOpenView("container")) setView("container"); }}
        />
      )}
      {view === "free" && <FreeMode onBack={() => setView("courses")} />}
      {canOpenView(view) && view === "container" && <ContainerShell onBack={() => setView("courses")} />}
      {view === "game" && course && pack && (
        <Stage courseId={course.id} pack={pack} progress={progress} onBack={() => setView("courses")} />
      )}
      {view !== "loading" && !["setup", "login", "password", "courses", "free", "container", "game"].includes(view) && (
        <div className="loading-screen">{t("app.invalidState")}</div>
      )}
    </AppShell>
  );
}
