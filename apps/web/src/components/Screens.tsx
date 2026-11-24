import { useEffect, useState } from "react";
import { api, type CourseInfo, type User } from "../api";

interface AuthProps { onDone: (user: User | null) => void }

export function LoginPage({ onDone }: AuthProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { onDone((await api.login(email, password)).user); }
    catch (err) { setError(err instanceof Error ? err.message : "登录失败"); }
  };
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>CodeQuest</h1><p className="muted">剧情驱动的编程学习系统</p>
        <label>邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></label>
        <label>密码<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required /></label>
        {error && <p className="bad">{error}</p>}
        <button className="primary" type="submit">登录</button>
        <small className="muted">账号由管理员批量发放，暂不开放注册。</small>
      </form>
    </div>
  );
}

export function SetupWizard({ onDone }: AuthProps) {
  const [name, setName] = useState("CodeQuest");
  const [email, setEmail] = useState("");
  const [display, setDisplay] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { onDone((await api.setup(name, { email, display_name: display, password })).user); }
    catch (err) { setError(err instanceof Error ? err.message : "初始化失败"); }
  };
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>首次启动</h1><p className="muted">创建实例与管理员账号</p>
        <label>实例名称<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>管理员邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></label>
        <label>显示名<input value={display} onChange={(e) => setDisplay(e.target.value)} /></label>
        <label>密码（至少 10 位）<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required /></label>
        {error && <p className="bad">{error}</p>}
        <button className="primary" type="submit">完成初始化</button>
      </form>
    </div>
  );
}

export function ChangePasswordPage({ onDone }: AuthProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.changePassword(current, next);
      await api.logout();
      onDone(null);
    } catch (err) { setError(err instanceof Error ? err.message : "修改失败"); }
  };
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>修改初始密码</h1><p className="muted">首次登录必须修改管理员发放的临时密码</p>
        <label>当前密码<input value={current} onChange={(e) => setCurrent(e.target.value)} type="password" required /></label>
        <label>新密码（至少 10 位）<input value={next} onChange={(e) => setNext(e.target.value)} type="password" required /></label>
        {error && <p className="bad">{error}</p>}
        <button className="primary" type="submit">修改并重新登录</button>
      </form>
    </div>
  );
}

interface CourseProps {
  user: User;
  onOpen: (course: CourseInfo) => void;
  onLogout: () => void;
}

export function CourseList({ user, onOpen, onLogout }: CourseProps) {
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void api.courses().then((r) => setCourses(r.courses)).catch((err) => setError(String(err)));
  }, []);
  return (
    <div className="course-list">
      <header>
        <h1>CodeQuest</h1>
        <div><span className="muted">{user.display_name ?? user.email}</span>
          <button className="ghost" onClick={() => { void api.logout(); onLogout(); }}>退出</button></div>
      </header>
      <h2>我的课程</h2>
      {error && <p className="bad">{error}</p>}
      <div className="cards">
        {courses.map((course) => (
          <button key={course.id} className="course-card" onClick={() => onOpen(course)}>
            <span className="tag lang">{course.difficulty}</span>
            <h3>{course.title}</h3>
            <p>{course.summary}</p>
            <small>{course.langs.join(" · ")} · v{course.version}</small>
          </button>
        ))}
        {courses.length === 0 && <p className="muted">暂无已发布课程，请联系管理员上传课程包。</p>}
      </div>
    </div>
  );
}
