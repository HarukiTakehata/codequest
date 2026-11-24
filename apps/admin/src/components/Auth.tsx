import { useState, type FormEvent } from "react";
import { ArrowRight, Braces, CheckCircle2, KeyRound, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { api, errorMessage, requestIdOf, type AdminUser } from "../api";
import { displayNameOf } from "../lib/display-name";
import { Button } from "./ui";

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="CodeQuest 管理面板介绍">
        <a className="auth-brand" href="/overview"><span className="brand-mark"><Braces size={25} /></span><span><strong>CodeQuest</strong><small>ADMIN CONSOLE</small></span></a>
        <div className="auth-story-copy">
          <p className="eyebrow">LEARN · BUILD · GROW</p>
          <h1>让每一次学习，<br />都有迹可循。</h1>
          <p>在一个安静、清晰的控制台里，管理成员、发布课程，并安全地发放学习账号。</p>
        </div>
        <div className="auth-feature-list">
          <span><ShieldCheck size={18} />基于服务端会话的安全访问</span>
          <span><KeyRound size={18} />一次性凭证，不落本地存储</span>
          <span><CheckCircle2 size={18} />关键操作完整审计</span>
        </div>
        <div className="auth-orbit" aria-hidden="true"><span /><span /><span /></div>
      </section>
      <section className="auth-form-side">{children}</section>
    </main>
  );
}

export function LoginPage({ onAuthenticated }: { onAuthenticated: (user: AdminUser) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(identifier.trim(), password);
      setPassword("");
      onAuthenticated(result.user);
    } catch (reason) {
      setPassword("");
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <div className="auth-card">
        <div className="auth-card-icon"><LockKeyhole size={22} /></div>
        <p className="eyebrow">管理员访问</p>
        <h2>欢迎回来</h2>
        <p className="auth-subtitle">使用管理员或教师账号登录 CodeQuest 管理面板。</p>
        <form className="form-stack" onSubmit={submit}>
          <label htmlFor="login-identifier">用户名或邮箱
            <input id="login-identifier" className="field" type="text" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" placeholder="用户名或邮箱" required disabled={busy} />
          </label>
          <label htmlFor="login-password">密码
            <input id="login-password" className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="输入账号密码" required disabled={busy} />
          </label>
          {error && <div className="form-message error" role="alert"><span>{error}</span>{requestIdOf(error) && <small>请求编号：{requestIdOf(error)}</small>}</div>}
          <Button type="submit" loading={busy} className="button-wide">登录管理面板<ArrowRight size={17} /></Button>
        </form>
        <p className="auth-security"><LockKeyhole size={14} />会话由服务端 HttpOnly Cookie 维护，不会存储到浏览器本地。</p>
      </div>
    </AuthFrame>
  );
}

export function ChangePasswordPage({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCurrent("");
      setNext("");
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <div className="auth-card">
        <div className="auth-card-icon"><KeyRound size={22} /></div>
        <p className="eyebrow">安全验证</p>
        <h2>请先更新密码</h2>
        <p className="auth-subtitle"><strong>{displayNameOf(user)}</strong> 的账号需要修改初始密码，更新后需要重新登录。</p>
        <form className="form-stack" onSubmit={submit}>
          <label htmlFor="current-password">当前密码
            <input id="current-password" className="field" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required disabled={busy} />
          </label>
          <label htmlFor="new-password">新密码
            <input id="new-password" className="field" type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" minLength={10} maxLength={200} required disabled={busy} />
          </label>
          <p className="field-hint">至少 10 个字符，且不能与当前密码相同。</p>
          {error && <div className="form-message error" role="alert">{error}</div>}
          <Button type="submit" loading={busy} className="button-wide">更新密码<ArrowRight size={17} /></Button>
        </form>
      </div>
    </AuthFrame>
  );
}

export function ForbiddenPage({ user, onLogout, loggingOut }: {
  user: AdminUser;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const isStudent = user.role === "student";
  const isTeacher = user.role === "teacher";
  const currentRoleLabel = isStudent ? "学生" : isTeacher ? "教师" : "管理员";
  return (
    <AuthFrame>
      <div className="auth-card access-card" role="alert">
        <div className="auth-card-icon danger-icon"><ShieldCheck size={22} /></div>
        <p className="eyebrow">权限不足</p>
        <h2>{isStudent ? "学生账号不能访问管理面板" : isTeacher ? "教师账号不能访问此页面" : "当前账号不能访问此页面"}</h2>
        <p className="auth-subtitle">当前登录账号 <strong>{displayNameOf(user)}</strong> 是{currentRoleLabel}账号，{isStudent ? "不能进入管理工作台。" : "没有访问当前页面的权限。"}</p>
        <div className="notice notice-warning">{isStudent ? "学生账号仅用于学习端。请使用管理员或教师账号登录管理面板。" : isTeacher ? "教师可以管理概览、实例配置、批量发号、学生账号与课程；审计记录及教师账号管理仅限管理员。" : "当前账号没有访问此页面的权限，请联系管理员。"}</div>
        <Button variant="outline" className="button-wide" onClick={onLogout} loading={loggingOut}><LogOut size={17} />退出当前账号</Button>
      </div>
    </AuthFrame>
  );
}

export function AuthErrorPage({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <AuthFrame>
      <div className="auth-card access-card" role="alert">
        <div className="auth-card-icon danger-icon"><LockKeyhole size={22} /></div>
        <p className="eyebrow">连接异常</p>
        <h2>无法确认登录状态</h2>
        <p className="auth-subtitle">{errorMessage(error)}</p>
        {requestIdOf(error) && <p className="request-id">请求编号：{requestIdOf(error)}</p>}
        <Button className="button-wide" onClick={onRetry}>重新连接<ArrowRight size={17} /></Button>
      </div>
    </AuthFrame>
  );
}
