import { useState, type FormEvent } from "react";
import {
  Ban,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserRoundX,
  Users,
} from "lucide-react";
import { api, errorMessage, type AccountRole, type AdminAccount, type AdminUser } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { copyText } from "../lib/browser";
import { displayNameOf, isPlaceholderDisplayName } from "../lib/display-name";
import { formatDate, initials } from "../lib/format";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  InlineFieldError,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  SearchEmptyState,
} from "../components/ui";

const limit = 20;

function roleLabel(role: AccountRole) {
  return role === "teacher" ? "教师" : "学生";
}

function accountName(account: AdminAccount): string {
  return displayNameOf(account);
}

function accountIdentity(account: AdminAccount): string {
  return account.email ? `${account.username} · ${account.email}` : account.username;
}

export function AccountsPage({ role }: { role: AdminUser["role"] }) {
  const toast = useToast();
  const canManageTeachers = role === "admin";
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | AccountRole>("");
  const effectiveRole = canManageTeachers ? roleFilter : "student";
  const [status, setStatus] = useState<"" | "active" | "disabled">("");
  const [passwordState, setPasswordState] = useState<"" | "required" | "ready">("");
  const [offset, setOffset] = useState(0);
  const accounts = useAsyncData(
    () => api.accounts({ query, role: effectiveRole || undefined, status: status || undefined, passwordState: passwordState || undefined, limit, offset }),
    [query, effectiveRole, status, passwordState, offset],
  );

  const [editTarget, setEditTarget] = useState<AdminAccount | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [editRole, setEditRole] = useState<AccountRole>("student");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [statusTarget, setStatusTarget] = useState<AdminAccount | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminAccount | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [temporary, setTemporary] = useState<{ account: AdminAccount; password: string } | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const replaceAccount = (updated: AdminAccount) => {
    accounts.updateData((current) => current ? {
      ...current,
      accounts: current.accounts.map((account) => account.id === updated.id ? updated : account),
    } : current);
  };

  const openEdit = (account: AdminAccount) => {
    setEditTarget(account);
    setUsername(account.username);
    setEmail(account.email ?? "");
    setDisplayName(isPlaceholderDisplayName(account.display_name) ? "" : account.display_name ?? "");
    setEditRole(account.role);
    setEditError(null);
  };

  const saveAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!editTarget || !username.trim() || !displayName.trim()) return;
    setSavingName(true);
    setEditError(null);
    try {
      const roleChanged = canManageTeachers && editRole !== editTarget.role;
      const result = await api.updateAccount(editTarget.id, {
        username: username.trim(),
        email: email.trim() || null,
        display_name: displayName.trim(),
        ...(roleChanged ? { role: editRole } : {}),
      });
      replaceAccount(result.account);
      setEditTarget(null);
      toast("账号信息已更新");
      if (roleChanged) accounts.reload();
    } catch (reason) {
      setEditError(errorMessage(reason));
    } finally {
      setSavingName(false);
    }
  };

  const changeStatus = async () => {
    if (!statusTarget) return;
    setSavingStatus(true);
    setStatusError(null);
    try {
      const nextStatus = statusTarget.status === "active" ? "disabled" : "active";
      const result = await api.updateAccount(statusTarget.id, { status: nextStatus });
      replaceAccount(result.account);
      toast(nextStatus === "active" ? "成员账号已启用" : "成员账号已停用，现有会话已失效");
      setStatusTarget(null);
      accounts.reload();
    } catch (reason) {
      setStatusError(errorMessage(reason));
    } finally {
      setSavingStatus(false);
    }
  };

  const resetPassword = async () => {
    if (!resetTarget) return;
    setResetting(true);
    setResetError(null);
    try {
      const result = await api.resetPassword(resetTarget.id);
      replaceAccount({ ...resetTarget, must_change_password: true });
      setTemporary({ account: resetTarget, password: result.temporary_password });
      setResetTarget(null);
      setCopyMessage(null);
    } catch (reason) {
      setResetError(errorMessage(reason));
    } finally {
      setResetting(false);
    }
  };

  const copyTemporary = async () => {
    if (!temporary) return;
    try {
      await copyText(temporary.password);
      setCopyMessage("临时密码已复制");
    } catch (reason) {
      setCopyMessage(errorMessage(reason));
    }
  };

  const resetFilters = () => {
    setQueryInput("");
    setQuery("");
    setRoleFilter("");
    setStatus("");
    setPasswordState("");
    setOffset(0);
  };

  const hasFilters = Boolean(query || roleFilter || status || passwordState);
  const rows = (accounts.data?.accounts ?? []).filter((account) => canManageTeachers || account.role === "student");

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="MEMBER DIRECTORY"
        title="成员账号"
        description={canManageTeachers ? "搜索学生与教师账号、调整用户名/邮箱/显示名称和角色、控制登录状态，并安全重置初始密码。" : "搜索学生、调整用户名/邮箱/显示名称、控制登录状态，并安全重置初始密码；不可查看或管理教师账号。"}
        actions={<Button variant="outline" size="small" onClick={accounts.reload} disabled={accounts.loading}><RefreshCw size={15} />刷新</Button>}
      />

      <section className="panel accounts-panel" aria-labelledby="accounts-table-title">
        <div className="panel-heading accounts-heading">
          <div><p className="eyebrow">ACCOUNTS</p><h2 id="accounts-table-title">成员列表</h2><p>{canManageTeachers ? "展示学生与教师账号；管理员账号不会出现在此列表中。" : "仅展示学生账号；教师不能查看或管理教师与其他管理员账号。"}</p></div>
          <Badge tone="info"><Users size={13} />{accounts.data?.total ?? "—"} 位{canManageTeachers ? "账号" : "学生"}</Badge>
        </div>
        <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()); setOffset(0); }}>
          <label className="search-field" htmlFor="account-search"><Search size={17} /><span className="sr-only">搜索成员</span>
            <input id="account-search" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索用户名、邮箱或显示名称" autoComplete="off" maxLength={120} />
          </label>
          <label htmlFor="account-role-filter">账号角色
            <select
              id="account-role-filter"
              className="field"
              value={effectiveRole}
              disabled={!canManageTeachers}
              onChange={(event) => { setRoleFilter(event.target.value as typeof roleFilter); setOffset(0); }}
            >
              {canManageTeachers && <option value="">全部角色</option>}
              <option value="student">学生</option>
              {canManageTeachers && <option value="teacher">教师</option>}
            </select>
          </label>
          <label htmlFor="account-status">账号状态
            <select id="account-status" className="field" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setOffset(0); }}>
              <option value="">全部状态</option><option value="active">活跃</option><option value="disabled">已停用</option>
            </select>
          </label>
          <label htmlFor="password-state">改密状态
            <select id="password-state" className="field" value={passwordState} onChange={(event) => { setPasswordState(event.target.value as typeof passwordState); setOffset(0); }}>
              <option value="">全部状态</option><option value="required">待改密</option><option value="ready">已就绪</option>
            </select>
          </label>
          <Button type="submit" variant="outline" disabled={accounts.loading}><Search size={16} />搜索</Button>
          {hasFilters && <Button variant="ghost" onClick={resetFilters}>清除</Button>}
        </form>

        {accounts.loading ? <LoadingState label="正在加载成员账号" /> : accounts.error ? <ErrorState error={accounts.error} onRetry={accounts.reload} /> : (
          <>
            {rows.length === 0 ? (
              hasFilters ? <SearchEmptyState onReset={resetFilters} /> : <EmptyState title="还没有成员账号" description="前往「批量发号」导入 CSV 名单，创建第一批成员。" />
            ) : (
              <div className="table-wrap">
                <table className="data-table accounts-table">
                  <caption className="sr-only">成员账号列表</caption>
                  <thead><tr><th>成员</th><th>账号角色</th><th>账号状态</th><th>改密状态</th><th>最近登录</th><th>来源批次</th><th className="align-right">操作</th></tr></thead>
                  <tbody>{rows.map((account) => (
                    <tr key={account.id} data-label="成员账号">
                      <td><div className="account-cell"><span className={`avatar ${account.status === "disabled" ? "avatar-muted" : ""}`}>{initials(account.display_name, account.username, account.email)}</span><span><strong>{accountName(account)}</strong><small className="mono">{account.username}</small><small>{account.email || "未设置邮箱"}</small></span></div></td>
                      <td data-label="账号角色"><Badge tone={account.role === "teacher" ? "warning" : "info"}>{roleLabel(account.role)}</Badge></td>
                      <td data-label="账号状态"><Badge tone={account.status === "active" ? "success" : "danger"}>{account.status === "active" ? "活跃" : "已停用"}</Badge></td>
                      <td data-label="改密状态"><Badge tone={account.must_change_password ? "warning" : "neutral"}>{account.must_change_password ? "待改密" : "已就绪"}</Badge></td>
                      <td data-label="最近登录">{formatDate(account.last_seen_at)}</td>
                      <td data-label="来源批次"><span className="batch-source">{account.batch_filename || "手动创建"}<small>{formatDate(account.created_at)}</small></span></td>
                      <td data-label="操作"><div className="row-actions">
                        <Button variant="ghost" size="small" onClick={() => openEdit(account)}><Pencil size={14} />编辑账号</Button>
                        <Button variant="ghost" size="small" className={account.status === "active" ? "danger-text" : "success-text"} onClick={() => { setStatusTarget(account); setStatusError(null); }}>
                          {account.status === "active" ? <UserRoundX size={14} /> : <UserCheck size={14} />}{account.status === "active" ? "停用" : "启用"}
                        </Button>
                        <Button variant="ghost" size="small" onClick={() => { setResetTarget(account); setResetError(null); }}><KeyRound size={14} />重置密码</Button>
                      </div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <Pagination total={accounts.data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} label="成员账号分页" />
          </>
        )}
      </section>

      <Modal
        open={Boolean(editTarget)}
        onClose={() => { if (!savingName) setEditTarget(null); }}
        title="编辑账号"
        description={editTarget ? accountIdentity(editTarget) : undefined}
        footer={<><Button variant="ghost" onClick={() => setEditTarget(null)} disabled={savingName}>取消</Button><Button type="submit" form="edit-account-form" loading={savingName} disabled={!username.trim() || !displayName.trim()}><Check size={16} />保存更改</Button></>}
      >
        <form id="edit-account-form" className="form-stack" onSubmit={saveAccount}>
          <label htmlFor="account-username">用户名
            <input id="account-username" className="field" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} required disabled={savingName} data-autofocus />
          </label>
          <label htmlFor="account-email">邮箱 <span className="optional">选填</span>
            <input id="account-email" className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} disabled={savingName} />
          </label>
          <label htmlFor="display-name">显示名称
            <input id="display-name" className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} required disabled={savingName} />
          </label>
          {canManageTeachers && (
            <label htmlFor="account-role">账号角色
              <select id="account-role" className="field" value={editRole} onChange={(event) => setEditRole(event.target.value as AccountRole)} disabled={savingName}>
                <option value="student">学生</option>
                <option value="teacher">教师</option>
              </select>
            </label>
          )}
          <p className="field-hint">{canManageTeachers ? "可在学生与教师之间调整角色；用户名与邮箱均可修改，邮箱留空表示不设置。" : "用户名与邮箱均可修改，邮箱留空表示不设置；显示名称会展示给学生本人。"}</p>
          <InlineFieldError>{editError}</InlineFieldError>
        </form>
      </Modal>

      <Modal
        open={Boolean(statusTarget)}
        onClose={() => { if (!savingStatus) setStatusTarget(null); }}
        title={statusTarget?.status === "active" ? "停用这个成员账号？" : "重新启用这个账号？"}
        description={statusTarget ? accountIdentity(statusTarget) : undefined}
        footer={<><Button variant="ghost" onClick={() => setStatusTarget(null)} disabled={savingStatus}>取消</Button><Button variant={statusTarget?.status === "active" ? "danger" : "primary"} onClick={() => void changeStatus()} loading={savingStatus}>{statusTarget?.status === "active" ? <Ban size={16} /> : <UserCheck size={16} />}{statusTarget?.status === "active" ? "确认停用" : "确认启用"}</Button></>}
      >
        {statusTarget?.status === "active" ? (
          <><div className="notice notice-warning"><Ban size={18} /><span>停用后，该成员将无法登录，现有会话也会失效。已发布课程和成员进度不会删除。</span></div><div className="confirm-summary"><span><Users size={18} />成员</span><strong>{accountName(statusTarget)}</strong><p>{accountIdentity(statusTarget)}</p></div></>
        ) : (
          <><div className="notice notice-success"><UserCheck size={18} /><span>启用后，成员可重新登录。若仍需修改初始密码，系统会继续要求其改密。</span></div><div className="confirm-summary"><span><Users size={18} />成员</span><strong>{statusTarget ? accountName(statusTarget) : ""}</strong><p>{statusTarget ? accountIdentity(statusTarget) : ""}</p></div></>
        )}
        {statusError && <p className="form-message error" role="alert">{statusError}</p>}
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => { if (!resetting) setResetTarget(null); }}
        title="重置成员临时密码？"
        description="重置成功后，新密码只会显示一次。"
        footer={<><Button variant="ghost" onClick={() => setResetTarget(null)} disabled={resetting}>取消</Button><Button onClick={() => void resetPassword()} loading={resetting}><KeyRound size={16} />生成临时密码</Button></>}
      >
        {resetTarget && <div className="confirm-summary"><span><KeyRound size={18} />成员</span><strong>{accountName(resetTarget)}</strong><p>{accountIdentity(resetTarget)}</p></div>}
        <div className="notice notice-warning"><ShieldCheck size={18} /><span>该成员的全部会话将被撤销，下次登录必须修改密码。账号启停状态不会改变。</span></div>
        {resetError && <p className="form-message error" role="alert">{resetError}</p>}
      </Modal>

      <Modal
        open={Boolean(temporary)}
        onClose={() => { setTemporary(null); setCopyMessage(null); }}
        title="临时密码已生成"
        description="请通过可信渠道交给成员；关闭后无法再次查看。"
        footer={<Button onClick={() => { setTemporary(null); setCopyMessage(null); }}><CheckCircle2 size={16} />我已安全保存</Button>}
      >
        {temporary && <div className="temporary-credential">
          <div className="notice notice-warning"><KeyRound size={18} /><span><strong>仅展示一次。</strong>密码未写入本地存储。成员首次登录时必须修改。</span></div>
          <label htmlFor="temporary-password">{accountName(temporary.account)} 的临时密码
            <input id="temporary-password" className="field credential-input mono" value={temporary.password} readOnly onFocus={(event) => event.currentTarget.select()} spellCheck={false} data-autofocus />
          </label>
          <Button variant="outline" onClick={() => void copyTemporary()}><Copy size={16} />复制临时密码</Button>
          {copyMessage && <p className={`copy-message ${copyMessage.includes("失败") ? "error" : "success"}`} role="status">{copyMessage}</p>}
        </div>}
      </Modal>
    </div>
  );
}
