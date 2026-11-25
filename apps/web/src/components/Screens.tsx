import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
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
  const [step, setStep] = useState(0);
  const [name, setName] = useState("CodeQuest");
  const [email, setEmail] = useState("");
  const [display, setDisplay] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pack, setPack] = useState<Record<string, string> | null>(null);
  const [packName, setPackName] = useState("");
  const [packError, setPackError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const steps = ["实例信息", "管理员账号", "首个课程包", "确认提交"];

  const next = () => {
    setError("");
    if (step === 0 && !name.trim()) { setError("请填写实例名称"); return; }
    if (step === 1) {
      if (!email.includes("@")) { setError("请填写有效邮箱"); return; }
      if (password.length < 10) { setError("密码至少 10 位"); return; }
      if (password !== confirm) { setError("两次密码不一致"); return; }
    }
    setStep((s) => Math.min(3, s + 1));
  };

  const loadPack = async (file: File | undefined) => {
    if (!file) return;
    setPackError("");
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, string>;
      if (!parsed || typeof parsed !== "object" || !parsed["course.json"]) throw new Error("缺少 course.json");
      setPack(parsed);
      setPackName(`${file.name}（${Object.keys(parsed).length} 个文件）`);
    } catch (e) { setPackError(`课程包解析失败: ${String(e)}`); }
  };

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const user = (await api.setup(name, { email, display_name: display, password }, pack ?? undefined)).user;
      onDone(user);
    } catch (err) { setError(err instanceof Error ? err.message : "初始化失败"); }
    setBusy(false);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>实例初始化</h1>
        <p className="muted">首次启动需要创建实例、管理员，并可一并导入首个课程包</p>
        <ol className="setup-steps">
          {steps.map((label, i) => <li key={label} className={i === step ? "current" : i < step ? "done" : ""}>
            {i + 1}. {label}
          </li>)}
        </ol>
        {step === 0 && (
          <>
            <label>实例名称<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <p className="muted">名称会展示在课程列表与登录页。</p>
          </>
        )}
        {step === 1 && (
          <>
            <label>管理员邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></label>
            <label>显示名<input value={display} onChange={(e) => setDisplay(e.target.value)} /></label>
            <label>密码（至少 10 位）<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required /></label>
            <label>确认密码<input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" required /></label>
          </>
        )}
        {step === 2 && (
          <>
            <label>课程包 JSON（可选）
              <input type="file" accept="application/json,.json" onChange={(e) => void loadPack(e.target.files?.[0])} />
            </label>
            <p className="muted">用 `node scripts/pack-course.mjs courses/demo` 生成。跳过也可在管理端后续上传。</p>
            {packName && <p className="ready">已选择：{packName}</p>}
            {packError && <p className="bad">{packError}</p>}
          </>
        )}
        {step === 3 && (
          <div className="setup-summary">
            <p><strong>实例：</strong>{name}</p>
            <p><strong>管理员：</strong>{email}{display ? `（${display}）` : ""}</p>
            <p><strong>课程包：</strong>{packName || "暂不导入"}</p>
          </div>
        )}
        {error && <p className="bad">{error}</p>}
        <div className="setup-actions">
          {step > 0 && <button className="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>上一步</button>}
          {step < 3
            ? <button className="primary" onClick={next}>下一步</button>
            : <button className="primary" onClick={() => void submit()} disabled={busy}>
                {busy ? "正在初始化…" : "完成初始化"}
              </button>}
        </div>
      </div>
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
  onFree: () => void;
  onLogout: () => void;
}

export function CourseList({ user, onOpen, onFree, onLogout }: CourseProps) {
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
      <button className="free-entry" onClick={onFree}>
        <strong className="icon-text"><Zap size={17} /> 自由模式</strong>
        <span>不进剧情，任选语言自由写代码、自定义测试点判题（草稿云端保存）</span>
      </button>
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
