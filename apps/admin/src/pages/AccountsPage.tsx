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
import { useI18n } from "@codequest/i18n";
import { api, errorMessage, type AdminAccount, type AdminUser, type ManagedAccountRole } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { copyText } from "../lib/browser";
import { displayNameOf, isPlaceholderDisplayName } from "../lib/display-name";
import { formatDate, formatNumber, initials } from "../lib/format";
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
const roleMessageKeys: Record<ManagedAccountRole, "role.student" | "role.teacher" | "role.admin"> = {
  student: "role.student",
  teacher: "role.teacher",
  admin: "role.admin",
};

function accountName(account: AdminAccount): string {
  return displayNameOf(account);
}

function accountIdentity(account: AdminAccount): string {
  return account.email ? `${account.username} · ${account.email}` : account.username;
}

export function AccountsPage({ role, currentUserId }: { role: AdminUser["role"]; currentUserId: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const isAdmin = role === "admin";
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | ManagedAccountRole>("");
  const effectiveRole = isAdmin ? roleFilter : "student";
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
  const [editRole, setEditRole] = useState<ManagedAccountRole>("student");
  const [editError, setEditError] = useState<unknown>(null);
  const [savingName, setSavingName] = useState(false);
  const [statusTarget, setStatusTarget] = useState<AdminAccount | null>(null);
  const [statusError, setStatusError] = useState<unknown>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminAccount | null>(null);
  const [resetError, setResetError] = useState<unknown>(null);
  const [resetting, setResetting] = useState(false);
  const [temporary, setTemporary] = useState<{ account: AdminAccount; password: string } | null>(null);
  const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);

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
      const roleChanged = isAdmin && editRole !== editTarget.role;
      const result = await api.updateAccount(editTarget.id, {
        username: username.trim(),
        email: email.trim() || null,
        display_name: displayName.trim(),
        ...(roleChanged ? { role: editRole } : {}),
      });
      replaceAccount(result.account);
      setEditTarget(null);
      toast(t("accounts.updated"));
      if (roleChanged) accounts.reload();
    } catch (reason) {
      setEditError(reason);
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
      toast(t(nextStatus === "active" ? "accounts.enabled" : "accounts.disabled"));
      setStatusTarget(null);
      accounts.reload();
    } catch (reason) {
      setStatusError(reason);
    } finally {
      setSavingStatus(false);
    }
  };

  const resetPassword = async () => {
    if (!resetTarget || resetTarget.id === currentUserId) return;
    setResetting(true);
    setResetError(null);
    try {
      const result = await api.resetPassword(resetTarget.id);
      replaceAccount({ ...resetTarget, must_change_password: true });
      setTemporary({ account: resetTarget, password: result.temporary_password });
      setResetTarget(null);
      setCopyState(null);
    } catch (reason) {
      setResetError(reason);
    } finally {
      setResetting(false);
    }
  };

  const copyTemporary = async () => {
    if (!temporary) return;
    try {
      await copyText(temporary.password);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
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
  const rows = (accounts.data?.accounts ?? []).filter((account) => isAdmin || account.role === "student");
  const disabling = statusTarget?.status === "active";

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t("accounts.eyebrow")}
        title={t("accounts.title")}
        description={t(isAdmin ? "accounts.description.admin" : "accounts.description.teacher")}
        actions={<Button variant="outline" size="small" onClick={accounts.reload} disabled={accounts.loading}><RefreshCw size={15} />{t("accounts.refresh")}</Button>}
      />

      <section className="panel accounts-panel" aria-labelledby="accounts-table-title">
        <div className="panel-heading accounts-heading">
          <div><p className="eyebrow">{t("accounts.eyebrow")}</p><h2 id="accounts-table-title">{t("accounts.heading")}</h2><p>{t(isAdmin ? "accounts.description.admin.list" : "accounts.description.teacher.list")}</p></div>
          <Badge tone="info"><Users size={13} />{t("accounts.count", { count: accounts.data ? formatNumber(accounts.data.total, locale) : "—" })}</Badge>
        </div>
        <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()); setOffset(0); }}>
          <label className="search-field" htmlFor="account-search"><Search size={17} /><span className="sr-only">{t("accounts.search")}</span>
            <input id="account-search" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder={t("accounts.searchPlaceholder")} autoComplete="off" maxLength={120} />
          </label>
          <label htmlFor="account-role-filter">{t("accounts.role")}
            <select
              id="account-role-filter"
              className="field"
              value={effectiveRole}
              disabled={!isAdmin}
              onChange={(event) => { setRoleFilter(event.target.value as typeof roleFilter); setOffset(0); }}
            >
              {isAdmin && <option value="">{t("accounts.allRoles")}</option>}
              <option value="student">{t("role.student")}</option>
              {isAdmin && <option value="teacher">{t("role.teacher")}</option>}
              {isAdmin && <option value="admin">{t("role.admin")}</option>}
            </select>
          </label>
          <label htmlFor="account-status">{t("accounts.status")}
            <select id="account-status" className="field" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setOffset(0); }}>
              <option value="">{t("accounts.allStatuses")}</option><option value="active">{t("accounts.status.active")}</option><option value="disabled">{t("accounts.status.disabled")}</option>
            </select>
          </label>
          <label htmlFor="password-state">{t("accounts.passwordState")}
            <select id="password-state" className="field" value={passwordState} onChange={(event) => { setPasswordState(event.target.value as typeof passwordState); setOffset(0); }}>
              <option value="">{t("accounts.allPasswordStates")}</option><option value="required">{t("accounts.password.required")}</option><option value="ready">{t("accounts.password.ready")}</option>
            </select>
          </label>
          <Button type="submit" variant="outline" disabled={accounts.loading}><Search size={16} />{t("accounts.searchSubmit")}</Button>
          {hasFilters && <Button variant="ghost" onClick={resetFilters}>{t("accounts.clear")}</Button>}
        </form>

        {accounts.loading ? <LoadingState label={t("accounts.loading")} /> : accounts.error ? <ErrorState error={accounts.error} onRetry={accounts.reload} /> : (
          <>
            {rows.length === 0 ? (
              hasFilters ? <SearchEmptyState onReset={resetFilters} /> : <EmptyState title={t("accounts.empty.title")} description={t("accounts.empty.description")} />
            ) : (
              <div className="table-wrap">
                <table className="data-table accounts-table">
                  <caption className="sr-only">{t("accounts.heading")}</caption>
                  <thead><tr><th>{t("accounts.member")}</th><th>{t("accounts.role")}</th><th>{t("accounts.status")}</th><th>{t("accounts.passwordState")}</th><th>{t("accounts.lastSeen")}</th><th>{t("accounts.sourceBatch")}</th><th className="align-right">{t("accounts.actions")}</th></tr></thead>
                  <tbody>{rows.map((account) => (
                    <tr key={account.id} data-label={t("accounts.member")}>
                      <td><div className="account-cell"><span className={`avatar ${account.status === "disabled" ? "avatar-muted" : ""}`}>{initials(account.display_name, account.username, account.email)}</span><span><strong>{accountName(account)}</strong><small className="mono">{account.username}</small><small>{account.email || t("accounts.noEmail")}</small></span></div></td>
                      <td data-label={t("accounts.role")}><Badge tone={account.role === "admin" ? "danger" : account.role === "teacher" ? "warning" : "info"}>{t(roleMessageKeys[account.role])}</Badge></td>
                      <td data-label={t("accounts.status")}><Badge tone={account.status === "active" ? "success" : "danger"}>{t(account.status === "active" ? "accounts.status.active" : "accounts.status.disabled")}</Badge></td>
                      <td data-label={t("accounts.passwordState")}><Badge tone={account.must_change_password ? "warning" : "neutral"}>{t(account.must_change_password ? "accounts.password.required" : "accounts.password.ready")}</Badge></td>
                      <td data-label={t("accounts.lastSeen")}>{formatDate(account.last_seen_at, locale)}</td>
                      <td data-label={t("accounts.sourceBatch")}><span className="batch-source">{account.batch_filename || t("accounts.manual")}<small>{formatDate(account.created_at, locale)}</small></span></td>
                      <td data-label={t("accounts.actions")}><div className="row-actions">
                        <Button variant="ghost" size="small" onClick={() => openEdit(account)}><Pencil size={14} />{t("accounts.edit")}</Button>
                        <Button variant="ghost" size="small" className={account.status === "active" ? "danger-text" : "success-text"} onClick={() => { setStatusTarget(account); setStatusError(null); }}>
                          {account.status === "active" ? <UserRoundX size={14} /> : <UserCheck size={14} />}{t(account.status === "active" ? "accounts.disable" : "accounts.enable")}
                        </Button>
                        {account.id !== currentUserId && (
                          <Button variant="ghost" size="small" onClick={() => { setResetTarget(account); setResetError(null); }}><KeyRound size={14} />{t("accounts.reset")}</Button>
                        )}
                      </div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <Pagination total={accounts.data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} label={t("accounts.pagination")} />
          </>
        )}
      </section>

      <Modal
        open={Boolean(editTarget)}
        onClose={() => { if (!savingName) setEditTarget(null); }}
        title={t("accounts.editTitle")}
        description={editTarget ? accountIdentity(editTarget) : undefined}
        footer={<><Button variant="ghost" onClick={() => setEditTarget(null)} disabled={savingName}>{t("common.cancel")}</Button><Button type="submit" form="edit-account-form" loading={savingName} disabled={!username.trim() || !displayName.trim()}><Check size={16} />{t("accounts.save")}</Button></>}
      >
        <form id="edit-account-form" className="form-stack" onSubmit={saveAccount}>
          <label htmlFor="account-username">{t("accounts.username")}
            <input id="account-username" className="field" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} required disabled={savingName} data-autofocus />
          </label>
          <label htmlFor="account-email">{t("accounts.email")} <span className="optional">{t("accounts.optional")}</span>
            <input id="account-email" className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} disabled={savingName} />
          </label>
          <label htmlFor="display-name">{t("accounts.displayName")}
            <input id="display-name" className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} required disabled={savingName} />
          </label>
          {isAdmin && (
            <label htmlFor="account-role">{t("accounts.role")}
              <select id="account-role" className="field" value={editRole} onChange={(event) => setEditRole(event.target.value as ManagedAccountRole)} disabled={savingName}>
                <option value="student">{t("role.student")}</option>
                <option value="teacher">{t("role.teacher")}</option>
                <option value="admin">{t("role.admin")}</option>
              </select>
            </label>
          )}
          <p className="field-hint">{t(isAdmin ? "accounts.roleHint.admin" : "accounts.roleHint.teacher")}</p>
          <InlineFieldError>{editError}</InlineFieldError>
        </form>
      </Modal>

      <Modal
        open={Boolean(statusTarget)}
        onClose={() => { if (!savingStatus) setStatusTarget(null); }}
        title={t(disabling ? "accounts.disableTitle" : "accounts.enableTitle")}
        description={statusTarget ? accountIdentity(statusTarget) : undefined}
        footer={<><Button variant="ghost" onClick={() => setStatusTarget(null)} disabled={savingStatus}>{t("common.cancel")}</Button><Button variant={disabling ? "danger" : "primary"} onClick={() => void changeStatus()} loading={savingStatus}>{disabling ? <Ban size={16} /> : <UserCheck size={16} />}{t(disabling ? "accounts.confirmDisable" : "accounts.confirmEnable")}</Button></>}
      >
        {disabling ? (
          <><div className="notice notice-warning"><Ban size={18} /><span>{t("accounts.disableNotice")}</span></div><div className="confirm-summary"><span><Users size={18} />{t("accounts.member")}</span><strong>{accountName(statusTarget!)}</strong><p>{accountIdentity(statusTarget!)}</p></div></>
        ) : (
          <><div className="notice notice-success"><UserCheck size={18} /><span>{t("accounts.enableNotice")}</span></div><div className="confirm-summary"><span><Users size={18} />{t("accounts.member")}</span><strong>{statusTarget ? accountName(statusTarget) : ""}</strong><p>{statusTarget ? accountIdentity(statusTarget) : ""}</p></div></>
        )}
        {statusError != null && <p className="form-message error" role="alert">{errorMessage(statusError, t)}</p>}
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => { if (!resetting) setResetTarget(null); }}
        title={t("accounts.resetTitle")}
        description={t("accounts.resetDescription")}
        footer={<><Button variant="ghost" onClick={() => setResetTarget(null)} disabled={resetting}>{t("common.cancel")}</Button><Button onClick={() => void resetPassword()} loading={resetting}><KeyRound size={16} />{t("accounts.generatePassword")}</Button></>}
      >
        {resetTarget && <div className="confirm-summary"><span><KeyRound size={18} />{t("accounts.member")}</span><strong>{accountName(resetTarget)}</strong><p>{accountIdentity(resetTarget)}</p></div>}
        <div className="notice notice-warning"><ShieldCheck size={18} /><span>{t("accounts.resetNotice")}</span></div>
        {resetError != null && <p className="form-message error" role="alert">{errorMessage(resetError, t)}</p>}
      </Modal>

      <Modal
        open={Boolean(temporary)}
        onClose={() => { setTemporary(null); setCopyState(null); }}
        title={t("accounts.temporaryTitle")}
        description={t("accounts.temporaryDescription")}
        footer={<Button onClick={() => { setTemporary(null); setCopyState(null); }}><CheckCircle2 size={16} />{t("accounts.saved")}</Button>}
      >
        {temporary && <div className="temporary-credential">
          <div className="notice notice-warning"><KeyRound size={18} /><span><strong>{t("accounts.resetDescription")}</strong>{t("accounts.resetNotice")}</span></div>
          <label htmlFor="temporary-password">{t("accounts.temporaryFor", { name: accountName(temporary.account) })}
            <input id="temporary-password" className="field credential-input mono" value={temporary.password} readOnly onFocus={(event) => event.currentTarget.select()} spellCheck={false} data-autofocus />
          </label>
          <Button variant="outline" onClick={() => void copyTemporary()}><Copy size={16} />{t("accounts.copy")}</Button>
          {copyState && <p className={`copy-message ${copyState === "failed" ? "error" : "success"}`} role="status">{t(copyState === "copied" ? "accounts.copied" : "accounts.copyFailed")}</p>}
        </div>}
      </Modal>
    </div>
  );
}
