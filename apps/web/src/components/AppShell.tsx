import type { PropsWithChildren } from "react";
import { Code2, LogOut, ShieldCheck } from "lucide-react";
import type { User } from "../api";
import { displayNameOf } from "../display-name";
import { useI18n } from "../i18n/I18nProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";

interface AppShellProps extends PropsWithChildren {
  appName?: string;
  user?: User | null;
  adminUrl?: string | null;
  homeHref?: string;
  onProfile?: () => void;
  onLogout?: () => void;
}

const RELATIVE_URL_BASE = "https://codequest.invalid";

function safeAdminUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    if (candidate.startsWith("/")) {
      const parsed = new URL(candidate, RELATIVE_URL_BASE);
      return parsed.origin === RELATIVE_URL_BASE ? candidate : null;
    }
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

export function AppShell({ children, appName = "CodeQuest", user, adminUrl, homeHref, onProfile, onLogout }: AppShellProps) {
  const { t } = useI18n();
  const accountName = displayNameOf(user);
  const initial = accountName.trim().charAt(0).toUpperCase() || "CQ";
  const roleLabel = user ? t(`role.${user.role}`) : "";
  const canManage = user?.role === "teacher" || user?.role === "admin";
  const adminHref = canManage ? safeAdminUrl(adminUrl) : null;
  const brand = <>
    <span className="brand-mark"><Code2 size={21} strokeWidth={2.2} aria-hidden="true" /></span>
    <span className="brand-copy">
      <strong>{appName}</strong>
      <small>{t("nav.brandTagline")}</small>
    </span>
  </>;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          {homeHref ? <a className="brand" href={homeHref} aria-label={appName}>{brand}</a> : <div className="brand" aria-label={appName}>{brand}</div>}
          <div className="header-actions">
            {user && (onProfile ? (
              <button
                type="button"
                className="account-chip account-chip-button"
                title={t("nav.profile")}
                aria-label={t("nav.profile")}
                onClick={onProfile}
              >
                <span className="account-avatar">{initial}</span>
                <span className="account-name">{accountName}</span>
                <span className="account-role">{roleLabel}</span>
              </button>
            ) : (
              <div className="account-chip" title={roleLabel ? `${accountName} · ${roleLabel}` : accountName}>
                <span className="account-avatar">{initial}</span>
                <span className="account-name">{accountName}</span>
                <span className="account-role">{roleLabel}</span>
              </div>
            ))}
            {adminHref && (
              <a className="admin-workspace-link" href={adminHref} target="_blank" rel="noreferrer" aria-label={t("nav.adminWorkspace")}>
                <ShieldCheck size={17} aria-hidden="true" />
                <span className="admin-workspace-label">{t("nav.adminWorkspace")}</span>
              </a>
            )}
            <LanguageSwitcher />
            <ThemeToggle />
            {user && onLogout && (
              <button type="button" className="icon-button sign-out-button" onClick={onLogout} aria-label={t("nav.signOut")} title={t("nav.signOut")}>
                <LogOut size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">
        <span>{appName}</span>
        <span>{t("nav.footer")}</span>
      </footer>
    </div>
  );
}
