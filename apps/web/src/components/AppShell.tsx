import type { PropsWithChildren } from "react";
import { Code2, LogOut } from "lucide-react";
import type { User } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";

interface AppShellProps extends PropsWithChildren {
  appName?: string;
  user?: User | null;
  onLogout?: () => void;
}

export function AppShell({ children, appName = "CodeQuest", user, onLogout }: AppShellProps) {
  const { t } = useI18n();
  const accountName = user?.display_name || user?.email || "";
  const initial = accountName.trim().charAt(0).toUpperCase() || "CQ";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand" aria-label={appName}>
            <span className="brand-mark"><Code2 size={21} strokeWidth={2.2} aria-hidden="true" /></span>
            <span className="brand-copy">
              <strong>{appName}</strong>
              <small>{t("nav.brandTagline")}</small>
            </span>
          </div>
          <div className="header-actions">
            {user && (
              <div className="account-chip" title={accountName}>
                <span className="account-avatar">{initial}</span>
                <span className="account-name">{accountName}</span>
              </div>
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
