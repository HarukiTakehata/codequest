import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Braces, CheckCircle2, KeyRound, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { useI18n, type MessageKey } from "@codequest/i18n";
import { api, errorMessage, requestIdOf, type AdminUser } from "../api";
import { displayNameOf } from "../lib/display-name";
import { Button } from "./ui";

const roleMessageKeys: Record<AdminUser["role"], MessageKey> = {
  student: "role.student",
  teacher: "role.teacher",
  admin: "role.admin",
};

function AuthFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label={t("admin.auth.storyAria")}>
        <a className="auth-brand" href="/overview"><span className="brand-mark"><Braces size={25} /></span><span><strong>CodeQuest</strong><small>{t("admin.nav.console")}</small></span></a>
        <div className="auth-story-copy">
          <p className="eyebrow">{t("admin.auth.storyTagline")}</p>
          <h1>{t("admin.auth.storyTitle")}</h1>
          <p>{t("admin.auth.storyDescription")}</p>
        </div>
        <div className="auth-feature-list">
          <span><ShieldCheck size={18} />{t("admin.auth.feature.session")}</span>
          <span><KeyRound size={18} />{t("admin.auth.feature.credentials")}</span>
          <span><CheckCircle2 size={18} />{t("admin.auth.feature.audit")}</span>
        </div>
        <div className="auth-orbit" aria-hidden="true"><span /><span /><span /></div>
      </section>
      <section className="auth-form-side">{children}</section>
    </main>
  );
}

export function LoginPage({ onAuthenticated }: { onAuthenticated: (user: AdminUser) => void }) {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
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
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  const requestId = requestIdOf(error);

  return (
    <AuthFrame>
      <div className="auth-card">
        <div className="auth-card-icon"><LockKeyhole size={22} /></div>
        <p className="eyebrow">{t("admin.auth.accessEyebrow")}</p>
        <h2>{t("login.title")}</h2>
        <p className="auth-subtitle">{t("admin.auth.loginSubtitle")}</p>
        <form className="form-stack" onSubmit={submit}>
          <label htmlFor="login-identifier">{t("login.identifier")}
            <input id="login-identifier" className="field" type="text" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" placeholder={t("login.identifierPlaceholder")} required disabled={busy} />
          </label>
          <label htmlFor="login-password">{t("login.password")}
            <input id="login-password" className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder={t("admin.auth.passwordPlaceholder")} required disabled={busy} />
          </label>
          {error != null && <div className="form-message error" role="alert"><span>{errorMessage(error, t)}</span>{requestId && <small>{t("common.requestId", { id: requestId })}</small>}</div>}
          <Button type="submit" loading={busy} className="button-wide">{t("admin.auth.loginSubmit")}<ArrowRight size={17} /></Button>
        </form>
        <p className="auth-security"><LockKeyhole size={14} />{t("admin.auth.cookieSecurity")}</p>
      </div>
    </AuthFrame>
  );
}

export function ChangePasswordPage({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (reason) {
      setError(reason);
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
        <p className="eyebrow">{t("admin.auth.securityEyebrow")}</p>
        <h2>{t("admin.auth.passwordTitle")}</h2>
        <p className="auth-subtitle">{t("admin.auth.passwordSubtitle", { name: displayNameOf(user) })}</p>
        <form className="form-stack" onSubmit={submit}>
          <label htmlFor="current-password">{t("password.current")}
            <input id="current-password" className="field" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required disabled={busy} />
          </label>
          <label htmlFor="new-password">{t("password.next")}
            <input id="new-password" className="field" type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" minLength={10} maxLength={200} required disabled={busy} />
          </label>
          <p className="field-hint">{t("admin.auth.passwordHint")}</p>
          {error != null && <div className="form-message error" role="alert">{errorMessage(error, t)}</div>}
          <Button type="submit" loading={busy} className="button-wide">{t("admin.auth.passwordSubmit")}<ArrowRight size={17} /></Button>
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
  const { t } = useI18n();
  const isStudent = user.role === "student";
  const isTeacher = user.role === "teacher";
  const currentRoleLabel = t(roleMessageKeys[user.role]);
  const titleKey = isStudent ? "admin.auth.forbiddenStudentTitle" : isTeacher ? "admin.auth.forbiddenTeacherTitle" : "admin.auth.forbiddenOtherTitle";
  const descriptionKey = isStudent ? "admin.auth.forbiddenStudentDescription" : isTeacher ? "admin.auth.forbiddenTeacherDescription" : "admin.auth.forbiddenOtherDescription";
  const noticeKey = isStudent ? "admin.auth.forbiddenStudentNotice" : isTeacher ? "admin.auth.forbiddenTeacherNotice" : "admin.auth.forbiddenOtherNotice";
  return (
    <AuthFrame>
      <div className="auth-card access-card" role="alert">
        <div className="auth-card-icon danger-icon"><ShieldCheck size={22} /></div>
        <p className="eyebrow">{t("admin.auth.forbiddenEyebrow")}</p>
        <h2>{t(titleKey)}</h2>
        <p className="auth-subtitle">{t(descriptionKey, { name: displayNameOf(user), role: currentRoleLabel })}</p>
        <div className="notice notice-warning">{t(noticeKey)}</div>
        <Button variant="outline" className="button-wide" onClick={onLogout} loading={loggingOut}><LogOut size={17} />{t("admin.auth.signOutCurrent")}</Button>
      </div>
    </AuthFrame>
  );
}

export function AuthErrorPage({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  const requestId = requestIdOf(error);
  return (
    <AuthFrame>
      <div className="auth-card access-card" role="alert">
        <div className="auth-card-icon danger-icon"><LockKeyhole size={22} /></div>
        <p className="eyebrow">{t("admin.auth.errorEyebrow")}</p>
        <h2>{t("admin.auth.errorTitle")}</h2>
        <p className="auth-subtitle">{errorMessage(error, t)}</p>
        {requestId && <p className="request-id">{t("common.requestId", { id: requestId })}</p>}
        <Button className="button-wide" onClick={onRetry}>{t("admin.auth.retry")}<ArrowRight size={17} /></Button>
      </div>
    </AuthFrame>
  );
}
