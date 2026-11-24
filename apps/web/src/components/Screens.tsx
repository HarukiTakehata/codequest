import { useEffect, useState } from "react";
import {
  ArrowRight, ArrowUpRight, BookOpen, Braces, Check, Code2, Layers3, LockKeyhole,
  Terminal, Zap,
} from "lucide-react";
import { api, type CourseInfo, type User } from "../api";
import { displayNameOf } from "../display-name";
import { CONTAINER_SHELL_ENABLED } from "../features";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n";
import { errorMessageKey, localizeError } from "../i18n/errors";

const LANGUAGE_LABELS: Record<string, string> = {
  javascript: "JavaScript", python: "Python", java: "Java", cpp: "C / C++", shell: "Shell",
};
const DIFFICULTY_KEYS: Record<string, MessageKey> = {
  beginner: "difficulty.beginner", intermediate: "difficulty.intermediate", advanced: "difficulty.advanced",
};

interface AuthProps { onDone: (user: User | null, instanceName?: string) => void }

export function LoginPage({ onDone, notice }: AuthProps & { notice?: MessageKey }) {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onDone((await api.login(identifier.trim(), password)).user); }
    catch (err) { setError(errorMessageKey(err, "login.failed")); }
    finally { setBusy(false); }
  };
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-emblem"><Code2 size={25} aria-hidden="true" /></div>
        <div className="auth-heading">
          <span className="eyebrow">{t("login.eyebrow")}</span>
          <h1>{t("login.title")}</h1>
          <p className="muted">{t("login.subtitle")}</p>
        </div>
        <div className="form-stack">
          {notice && <p className="form-message is-success" role="status">{t(notice)}</p>}
          <label htmlFor="login-identifier">{t("login.identifier")}
            <input id="login-identifier" className="field" value={identifier} onChange={(e) => setIdentifier(e.target.value)} type="text" autoComplete="username" placeholder={t("login.identifierPlaceholder")} required />
          </label>
          <label htmlFor="login-password">{t("login.password")}
            <input id="login-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
          </label>
          {error && <p className="form-message is-error" role="alert">{t(error)}</p>}
          <button className="button button-primary button-wide" type="submit" disabled={busy}>
            {busy ? t("app.connecting") : t("login.submit")}<ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
        <p className="auth-notice"><LockKeyhole size={14} aria-hidden="true" />{t("login.notice")}</p>
      </form>
    </div>
  );
}

export function SetupWizard({ onDone }: AuthProps) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("CodeQuest");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [display, setDisplay] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const steps = [t("setup.step.instance"), t("setup.step.admin"), t("setup.step.review")];

  const next = () => {
    setError(null);
    if (step === 0 && !name.trim()) { setError("setup.error.nameRequired"); return; }
    if (step === 1) {
      if (!username.trim()) { setError("setup.error.usernameRequired"); return; }
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("setup.error.emailInvalid"); return; }
      if (password.length < 10) { setError("setup.error.passwordShort"); return; }
      if (password !== confirm) { setError("setup.error.passwordMismatch"); return; }
    }
    setStep((s) => Math.min(2, s + 1));
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const user = (await api.setup(name, {
        username: username.trim(),
        email: email.trim() || null,
        display_name: display.trim() || undefined,
        password,
      })).user;
      onDone(user, name);
    } catch (err) { setError(errorMessageKey(err, "setup.error.failed")); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth-screen setup-screen">
      <div className="auth-card setup-card">
        <div className="auth-heading">
          <span className="eyebrow">{t("setup.eyebrow")}</span>
          <h1>{t("setup.title")}</h1>
          <p className="muted">{t("setup.subtitle")}</p>
        </div>
        <ol className="setup-steps">
          {steps.map((label, i) => (
            <li key={`step-${i}`} className={i === step ? "current" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>
              <span>{i < step ? <Check size={13} aria-hidden="true" /> : i + 1}</span>{label}
            </li>
          ))}
        </ol>
        <div className="setup-content">
          {step === 0 && (
            <>
              <label htmlFor="setup-name">{t("setup.instanceName")}
                <input id="setup-name" className="field" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <p className="field-hint">{t("setup.instanceHint")}</p>
            </>
          )}
          {step === 1 && (
            <div className="form-stack">
              <label htmlFor="setup-username">{t("setup.adminUsername")}
                <input id="setup-username" className="field" value={username} onChange={(e) => setUsername(e.target.value)} type="text" autoComplete="username" minLength={3} maxLength={32} required />
              </label>
              <label htmlFor="setup-email">{t("setup.adminEmail")}
                <input id="setup-email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" maxLength={254} />
              </label>
              <label htmlFor="setup-display">{t("setup.displayName")}
                <input id="setup-display" className="field" value={display} onChange={(e) => setDisplay(e.target.value)} autoComplete="name" />
              </label>
              <label htmlFor="setup-password">{t("setup.password")}
                <input id="setup-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" required />
              </label>
              <label htmlFor="setup-confirm">{t("setup.confirmPassword")}
                <input id="setup-confirm" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" autoComplete="new-password" required />
              </label>
            </div>
          )}
          {step === 2 && (
            <div className="setup-summary">
              <p><span>{t("setup.reviewInstance")}</span><strong>{name}</strong></p>
              <p><span>{t("setup.reviewAdmin")}</span><strong>{username}{email ? ` · ${email}` : ""}{display ? ` · ${display}` : ""}</strong></p>
            </div>
          )}
          {error && <p className="form-message is-error" role="alert">{t(error)}</p>}
        </div>
        <div className="setup-actions">
          {step > 0 && <button type="button" className="button button-ghost" onClick={() => { setError(null); setStep((s) => s - 1); }} disabled={busy}>{t("setup.previous")}</button>}
          {step < 2
            ? <button type="button" className="button button-primary" onClick={next}>{t("setup.next")}<ArrowRight size={16} aria-hidden="true" /></button>
            : <button type="button" className="button button-primary" onClick={() => void submit()} disabled={busy}>
                {busy ? t("setup.submitting") : t("setup.submit")}<Check size={16} aria-hidden="true" />
              </button>}
        </div>
      </div>
    </div>
  );
}

export function ChangePasswordPage({ user, onDone, onLoginNotice }: AuthProps & {
  user: User;
  onLoginNotice?: () => void;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.changePassword(current, next);
      // 改密会撤销旧会话；用新密码立即建立新会话，避免用户再手动登录一次。
      try {
        const result = await api.login(user.username, next);
        onDone(result.user);
      } catch {
        onLoginNotice?.();
        onDone(null);
      }
    } catch (err) { setError(localizeError(err, t, "password.failed")); }
    finally { setBusy(false); }
  };
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-emblem"><LockKeyhole size={24} aria-hidden="true" /></div>
        <div className="auth-heading">
          <span className="eyebrow">{t("password.eyebrow")}</span>
          <h1>{t("password.title")}</h1>
          <p className="muted">{t("password.subtitle")}</p>
        </div>
        <div className="form-stack">
          <label htmlFor="current-password">{t("password.current")}
            <input id="current-password" className="field" value={current} onChange={(e) => setCurrent(e.target.value)} type="password" autoComplete="current-password" required />
          </label>
          <label htmlFor="new-password">{t("password.next")}
            <input id="new-password" className="field" value={next} onChange={(e) => setNext(e.target.value)} type="password" autoComplete="new-password" minLength={10} required />
          </label>
          {error && <p className="form-message is-error" role="alert">{error}</p>}
          <button className="button button-primary button-wide" type="submit" disabled={busy}>{t("password.submit")}<ArrowRight size={17} aria-hidden="true" /></button>
        </div>
      </form>
    </div>
  );
}

interface CourseProps {
  user: User;
  onOpen: (course: CourseInfo) => void;
  onFree: () => void;
  onContainer: () => void;
}

export function CourseList({ user, onOpen, onFree, onContainer }: CourseProps) {
  const { t } = useI18n();
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    void api.courses().then((r) => setCourses(r.courses)).catch(() => setError(true));
  }, []);
  const name = displayNameOf(user);

  return (
    <div className="page-container course-list">
      <section className="page-hero">
        <div>
          <span className="eyebrow"><span className="status-dot" />{t("courses.eyebrow")}</span>
          <h1>{t("courses.welcome", { name })}<span className="gradient-text">.</span></h1>
          <p>{t("courses.subtitle")}</p>
        </div>
        <div className="hero-code-card" aria-hidden="true">
          <div className="hero-code-dots"><i /><i /><i /></div>
          <code><span>const</span> journey = <em>"start"</em>;</code>
          <code><span>while</span> (curious) &#123;</code>
          <code>&nbsp;&nbsp;learn(<b>build</b>(idea));</code>
          <code>&#125;</code>
        </div>
      </section>

      <section className="mode-section" aria-labelledby="mode-heading">
        <div className="section-heading">
          <div><span className="section-kicker">{t("courses.playgroundKicker")}</span><h2 id="mode-heading">{t("courses.playground")}</h2></div>
        </div>
        <div className="mode-entries">
          <button className="mode-card mode-card-primary" onClick={onFree}>
            <span className="mode-icon"><Zap size={23} aria-hidden="true" /></span>
            <span className="mode-copy"><strong>{t("courses.freeMode")}</strong><span>{t("courses.freeDescription")}</span></span>
            <ArrowUpRight className="mode-arrow" size={20} aria-hidden="true" />
          </button>
          {CONTAINER_SHELL_ENABLED && (
            <button className="mode-card mode-card-terminal" onClick={onContainer}>
              <span className="mode-icon"><Terminal size={23} aria-hidden="true" /></span>
              <span className="mode-copy"><strong>{t("courses.containerShell")}</strong><span>{t("courses.containerDescription")}</span></span>
              <ArrowUpRight className="mode-arrow" size={20} aria-hidden="true" />
            </button>
          )}
        </div>
      </section>

      <section className="courses-section" aria-labelledby="courses-heading">
        <div className="section-heading">
          <div><span className="section-kicker">{t("courses.chaptersKicker")}</span><h2 id="courses-heading">{t("courses.chapters")}</h2></div>
          <span className="count-badge"><BookOpen size={14} aria-hidden="true" />{t("courses.count", { count: courses.length })}</span>
        </div>
        {error && <p className="form-message is-error" role="alert">{t("courses.loadFailed")}</p>}
        <div className="cards">
          {courses.map((course) => (
            <button key={course.id} className="course-card" onClick={() => onOpen(course)}>
              <div className="course-card-top"><span className="course-symbol"><Braces size={21} aria-hidden="true" /></span><ArrowUpRight size={18} aria-hidden="true" /></div>
              <span className="tag lang">{DIFFICULTY_KEYS[course.difficulty] ? t(DIFFICULTY_KEYS[course.difficulty]) : course.difficulty}</span>
              <h3>{course.title}</h3>
              <p>{course.summary}</p>
              <div className="course-card-footer">
                <span title={course.langs.map((lang) => LANGUAGE_LABELS[lang] ?? lang).join(" · ")}><Layers3 size={14} aria-hidden="true" />{t("courses.languageCount", { count: course.langs.length })}</span>
                <small>v{course.version}</small>
              </div>
            </button>
          ))}
        </div>
        {!error && courses.length === 0 && <div className="empty-state"><BookOpen size={28} aria-hidden="true" /><p>{t("courses.empty")}</p></div>}
      </section>
    </div>
  );
}
