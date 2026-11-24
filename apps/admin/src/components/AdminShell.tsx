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
import type { AdminConfig, AdminUser } from "../api";
import { errorMessage } from "../api";
import { displayNameOf } from "../lib/display-name";
import { initials, safeExternalUrl } from "../lib/format";
import type { AdminRoute } from "../lib/router";
import { Modal } from "./ui";

const navItems = [
  { route: "overview" as const, href: "/overview", label: "概览", icon: LayoutDashboard },
  { route: "batches" as const, href: "/batches", label: "批量发号", icon: Send },
  { route: "accounts" as const, href: "/accounts", label: "成员账号", icon: Users },
  { route: "courses" as const, href: "/courses", label: "课程管理", icon: BookOpen },
  { route: "audit" as const, href: "/audit", label: "审计记录", icon: FileClock },
];

const roleLabels: Record<AdminUser["role"], string> = {
  student: "学生",
  teacher: "教师",
  admin: "管理员",
};

const routeLabels: Record<AdminRoute, string> = {
  overview: "概览",
  batches: "批量发号",
  accounts: "成员账号",
  courses: "课程管理",
  audit: "审计记录",
  notfound: "页面未找到",
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const editorUrl = safeExternalUrl(props.config?.editor_url ?? null);
  const learnerUrl = safeExternalUrl(props.config?.learner_url ?? null);
  const instanceName = props.configLoading ? "正在加载实例…" : props.config?.instance_name?.trim() || "CodeQuest";
  const invalidConfig = Boolean(props.config?.editor_url && !editorUrl);
  const visibleNavItems = navItems.filter((item) => item.route !== "audit" || props.user.role === "admin");
  const roleLabel = roleLabels[props.user.role];
  const accountName = displayNameOf(props.user);

  const sidebar = (mobile = false) => (
    <>
      <div className="sidebar-brand">
        <span className="brand-mark"><Braces size={24} strokeWidth={2.2} /></span>
        <span><strong>CodeQuest</strong><small>管理控制台</small></span>
      </div>
      <div className="workspace-chip" aria-busy={props.configLoading}>
        <span className="workspace-icon"><Settings2 size={17} /></span>
        <span><small>当前工作区</small><strong>{instanceName}</strong></span>
        <span className="badge">{roleLabel}</span>
      </div>
      <p className="nav-section-label">工作台</p>
      <nav className="sidebar-nav" aria-label="主导航">
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
              <span>{item.label}</span>
              {item.route === "batches" && <span className="nav-shortcut">CSV</span>}
            </a>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="security-note">
          <span className="security-note-icon"><CircleAlert size={17} /></span>
          <div><strong>安全提醒</strong><p>发放链接与临时密码仅展示一次，请勿通过公共渠道分享。</p></div>
        </div>
        <div className="sidebar-user">
          {props.onProfile ? (
            <button type="button" className="sidebar-profile" onClick={props.onProfile} title="查看用户信息">
              <span className="avatar">{initials(props.user.display_name, props.user.username, props.user.email)}</span>
              <span className="sidebar-user-copy"><strong>{accountName}</strong><small>{props.user.email || "未设置邮箱"}</small></span>
            </button>
          ) : (
            <>
              <span className="avatar">{initials(props.user.display_name, props.user.username, props.user.email)}</span>
              <span className="sidebar-user-copy"><strong>{accountName}</strong><small>{props.user.email || "未设置邮箱"}</small></span>
            </>
          )}
          <button type="button" className="icon-button" onClick={props.onLogout} disabled={props.loggingOut} aria-label="退出登录" title="退出登录">
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
            <button type="button" className="icon-button mobile-menu-button" onClick={() => setDrawerOpen(true)} aria-label="打开导航菜单" aria-expanded={drawerOpen}>
              <Menu size={21} />
            </button>
            <div className="breadcrumb"><span>管理面板</span><span aria-hidden="true">/</span><strong>{routeLabels[props.route]}</strong></div>
          </div>
          <div className="topbar-actions">
            {learnerUrl && <a className="topbar-link" href={learnerUrl} target="_blank" rel="noreferrer">学员端<ArrowUpRight size={15} /></a>}
            {editorUrl ? (
              <a className="button button-outline button-small editor-link" href={editorUrl} target="_blank" rel="noreferrer">
                打开编辑器<ExternalLink size={15} />
              </a>
            ) : (
              <span className="editor-unavailable" title={invalidConfig ? "editor_url 格式无效" : "尚未配置 editor_url"}>
                编辑器未配置
              </span>
            )}
            <span className="topbar-divider" />
            {props.onProfile ? (
              <button type="button" className="topbar-profile" onClick={props.onProfile} title="查看用户信息">
                <span className="topbar-avatar avatar">{initials(props.user.display_name, props.user.username, props.user.email)}</span>
                <span className="topbar-user">{accountName}</span>
              </button>
            ) : (
              <>
                <span className="topbar-avatar avatar">{initials(props.user.display_name, props.user.username, props.user.email)}</span>
                <span className="topbar-user">{accountName}</span>
              </>
            )}
            <button type="button" className="icon-button topbar-logout" onClick={props.onLogout} disabled={props.loggingOut} aria-label="退出登录" title="退出登录">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {props.configLoading && <div className="config-loading" role="status">正在读取实例配置…</div>}
        {Boolean(props.configError) && (
          <div className="config-error" role="alert">
            <CircleAlert size={17} />
            <span>实例配置加载失败：{errorMessage(props.configError)}</span>
            <button type="button" onClick={props.onReloadConfig}><RefreshCw size={14} />重试</button>
          </div>
        )}
        {invalidConfig && (
          <div className="config-error" role="alert">
            <CircleAlert size={17} /><span>已配置的 editor_url 不是有效的 HTTP(S) 地址，请联系部署管理员。</span>
          </div>
        )}
        <main className="admin-main" id="main-content">{props.children}</main>
        <footer className="admin-footer"><span>CodeQuest Admin</span><span>M6.1 · 管理面板</span></footer>
      </div>
      <Modal open={drawerOpen} onClose={() => setDrawerOpen(false)} title="浏览管理面板" variant="drawer">
        <div className="mobile-sidebar-content">{sidebar(true)}</div>
      </Modal>
    </div>
  );
}
