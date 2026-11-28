import { useState, type MouseEvent, type ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Braces,
  CircleAlert,
  ExternalLink,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Send,
  Settings2,
  Users,
} from "lucide-react";
import { useI18n, type MessageKey } from "@codequest/i18n";
import type { AdminConfig, AdminUser } from "../api";
import { errorMessage } from "../api";
import { displayNameOf } from "../lib/display-name";
import { initials, safeExternalUrl } from "../lib/format";
import type { AdminRoute } from "../lib/router";
import { Modal } from "./ui";
import { LanguageSwitcher } from "./LanguageSwitcher";

const navItems = [
  { route: "overview" as const, href: "/overview", labelKey: "admin.nav.overview" as const, icon: LayoutDashboard },
  { route: "batches" as const, href: "/batches", labelKey: "admin.nav.batches" as const, icon: Send },
  { route: "accounts" as const, href: "/accounts", labelKey: "admin.nav.accounts" as const, icon: Users },
  { route: "courses" as const, href: "/courses", labelKey: "admin.nav.courses" as const, icon: BookOpen },
  { route: "audit" as const, href: "/audit", labelKey: "admin.nav.audit" as const, icon: FileClock },
];

const roleMessageKeys: Record<AdminUser["role"], MessageKey> = {
  student: "role.student",
  teacher: "role.teacher",
  admin: "role.admin",
};

const routeMessageKeys: Record<AdminRoute, MessageKey> = {
  overview: "admin.nav.overview",
  batches: "admin.nav.batches",
  accounts: "admin.nav.accounts",
  courses: "admin.nav.courses",
  audit: "admin.nav.audit",
  notfound: "admin.nav.notfound",
};

function routeClick(event: MouseEvent<HTMLAnchorElement>, navigate: (route: AdminRoute) => void, route: AdminRoute) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(route);
}

interface ShellProps {
  user: AdminUser;
  route: AdminRoute;
  navigate: (route: AdminRoute) => void;
  onProfile?: () => void;
  onLogout: () => void;
  loggingOut: boolean;
  config: AdminConfig | null;
  configLoading: boolean;
  configError: unknown;
  onReloadConfig: () => void;
  children: ReactNode;
}

export function AdminShell(props: ShellProps) {
  const { t } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const editorUrl = safeExternalUrl(props.config?.editor_url ?? null);
  const learnerUrl = safeExternalUrl(props.config?.learner_url ?? null);
  const instanceName = props.configLoading ? t("admin.nav.loadingInstance") : props.config?.instance_name?.trim() || "CodeQuest";
  const invalidConfig = Boolean(props.config?.editor_url && !editorUrl);
  const visibleNavItems = navItems.filter((item) => item.route !== "audit" || props.user.role === "admin");
  const roleLabel = t(roleMessageKeys[props.user.role]);
  const accountName = displayNameOf(props.user);

  const sidebar = (mobile = false) => (
    <>
      <div className="sidebar-brand">
        <span className="brand-mark"><Braces size={24} strokeWidth={2.2} /></span>
        <span><strong>CodeQuest</strong><small>{t("admin.nav.console")}</small></span>
      </div>
      <div className="workspace-chip" aria-busy={props.configLoading}>
        <span className="workspace-icon"><Settings2 size={17} /></span>
        <span><small>{t("admin.nav.currentWorkspace")}</small><strong>{instanceName}</strong></span>
        <span className="badge">{roleLabel}</span>
      </div>
      <p className="nav-section-label">{t("admin.nav.section")}</p>
      <nav className="sidebar-nav" aria-label={t("admin.nav.section")}>
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.route}
              href={item.href}
              className={props.route === item.route ? "is-active" : ""}
              aria-current={props.route === item.route ? "page" : undefined}
              onClick={(event) => {
                routeClick(event, props.navigate, item.route);
                if (mobile) setDrawerOpen(false);
              }}
            >
              <Icon size={19} strokeWidth={1.9} />
              <span>{t(item.labelKey)}</span>
              {item.route === "batches" && <span className="nav-shortcut">CSV</span>}
            </a>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="security-note">
          <span className="security-note-icon"><CircleAlert size={17} /></span>
          <div><strong>{t("admin.security.title")}</strong><p>{t("admin.security.description")}</p></div>
        </div>
        <div className="sidebar-user">
          {props.onProfile ? (
            <button type="button" className="sidebar-profile" onClick={props.onProfile} title={t("profile.title")}>
              <span className="avatar">{initials(props.user.display_name, props.user.username, props.user.email)}</span>
              <span className="sidebar-user-copy"><strong>{accountName}</strong><small>{props.user.email || t("profile.noEmail")}</small></span>
            </button>
          ) : (
            <>
              <span className="avatar">{initials(props.user.display_name, props.user.username, props.user.email)}</span>
              <span className="sidebar-user-copy"><strong>{accountName}</strong><small>{props.user.email || t("profile.noEmail")}</small></span>
            </>
          )}
          <button type="button" className="icon-button" onClick={props.onLogout} disabled={props.loggingOut} aria-label={t("nav.signOut")} title={t("nav.signOut")}>
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="admin-layout">
      <aside className="sidebar desktop-sidebar">{sidebar()}</aside>
      <div className="admin-workspace">
        <header className="topbar">
          <div className="topbar-leading">
            <button type="button" className="icon-button mobile-menu-button" onClick={() => setDrawerOpen(true)} aria-label={t("nav.openMenu")} aria-expanded={drawerOpen}>
              <Menu size={21} />
            </button>
            <div className="breadcrumb"><span>{t("admin.nav.console")}</span><span aria-hidden="true">/</span><strong>{t(routeMessageKeys[props.route])}</strong></div>
          </div>
          <div className="topbar-actions">
            {learnerUrl && <a className="topbar-link" href={learnerUrl} target="_blank" rel="noreferrer">{t("admin.nav.learner")}<ArrowUpRight size={15} /></a>}
            {editorUrl ? (
              <a className="button button-outline button-small editor-link" href={editorUrl} target="_blank" rel="noreferrer">
                {t("admin.nav.openEditor")}<ExternalLink size={15} />
              </a>
            ) : (
              <span className="editor-unavailable" title={t(invalidConfig ? "admin.nav.editorInvalid" : "admin.nav.editorNotConfigured")}>
                {t("admin.nav.editorUnavailable")}
              </span>
            )}
            <span className="topbar-divider" />
            <LanguageSwitcher />
            {props.onProfile ? (
              <button type="button" className="topbar-profile" onClick={props.onProfile} title={t("profile.title")}>
                <span className="topbar-avatar avatar">{initials(props.user.display_name, props.user.username, props.user.email)}</span>
                <span className="topbar-user">{accountName}</span>
              </button>
            ) : (
              <>
                <span className="topbar-avatar avatar">{initials(props.user.display_name, props.user.username, props.user.email)}</span>
                <span className="topbar-user">{accountName}</span>
              </>
            )}
            <button type="button" className="icon-button topbar-logout" onClick={props.onLogout} disabled={props.loggingOut} aria-label={t("nav.signOut")} title={t("nav.signOut")}>
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {props.configLoading && <div className="config-loading" role="status">{t("admin.config.loading")}</div>}
        {Boolean(props.configError) && (
          <div className="config-error" role="alert">
            <CircleAlert size={17} />
            <span>{t("admin.config.error", { message: errorMessage(props.configError, t) })}</span>
            <button type="button" onClick={props.onReloadConfig}><RefreshCw size={14} />{t("common.retry")}</button>
          </div>
        )}
        {invalidConfig && (
          <div className="config-error" role="alert">
            <CircleAlert size={17} /><span>{t("admin.config.invalidEditor")}</span>
          </div>
        )}
        <main className="admin-main" id="main-content">{props.children}</main>
        <footer className="admin-footer"><span>{t("admin.footer.brand")}</span><span>{t("admin.footer.version")}</span></footer>
      </div>
      <Modal open={drawerOpen} onClose={() => setDrawerOpen(false)} title={t("admin.nav.drawer")} variant="drawer">
        <div className="mobile-sidebar-content">{sidebar(true)}</div>
      </Modal>
    </div>
  );
}
