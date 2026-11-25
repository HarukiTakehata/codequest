import { useEffect, useState } from "react";
import { api, type CourseInfo, type CoursePack, type Progress, type User } from "./api";
import { Stage } from "./components/Stage";
import { FreeMode } from "./components/FreeMode";
import { ContainerShell } from "./components/ContainerShell";
import { ChangePasswordPage, CourseList, LoginPage, SetupWizard } from "./components/Screens";
import "./styles.css";

type View = "loading" | "setup" | "login" | "password" | "courses" | "game" | "free" | "container";

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [pack, setPack] = useState<CoursePack | null>(null);
  const [progress, setProgress] = useState<Progress>({});

  useEffect(() => {
    (async () => {
      try {
        const setup = await api.setupStatus();
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

  const onAuthDone = (next: User | null) => {
    if (location.pathname === "/setup") history.replaceState(null, "", "/");
    if (!next) { setUser(null); setView("login"); return; }
    setUser(next);
    setView(next.must_change_password ? "password" : "courses");
  };

  const openCourse = async (info: CourseInfo) => {
    const [packResult, progressResult] = await Promise.all([api.pack(info.id), api.progress(info.id)]);
    setCourse(info);
    setPack(packResult.pack);
    setProgress(progressResult.progress);
    setView("game");
  };

  if (view === "loading") return <div className="loading">正在连接 CodeQuest…</div>;
  if (view === "setup") return <SetupWizard onDone={onAuthDone} />;
  if (view === "login") return <LoginPage onDone={onAuthDone} />;
  if (view === "password") return <ChangePasswordPage onDone={onAuthDone} />;
  if (view === "courses" && user) {
    return <CourseList
      user={user}
      onOpen={(c) => void openCourse(c)}
      onFree={() => setView("free")}
      onContainer={() => setView("container")}
      onLogout={() => { setUser(null); setView("login"); }}
    />;
  }
  if (view === "free") return <FreeMode onBack={() => setView("courses")} />;
  if (view === "container") return <ContainerShell onBack={() => setView("courses")} />;
  if (view === "game" && course && pack) {
    return <Stage courseId={course.id} pack={pack} progress={progress} onBack={() => setView("courses")} />;
  }
  return <div className="loading">状态异常，请刷新页面。</div>;
}
