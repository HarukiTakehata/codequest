import { useState, type FormEvent } from "react";
import { CalendarDays, CheckCircle2, Clock3, KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useI18n, type MessageKey } from "@codequest/i18n";
import { api, errorMessage, LocalizedError, type AdminUser } from "../api";
import { displayNameOf, isPlaceholderDisplayName } from "../lib/display-name";
import { formatDate, initials } from "../lib/format";
import { MIN_ADMIN_PASSWORD_LENGTH, validatePasswordChange } from "../lib/password";
import { Button, Modal } from "./ui";

const roleMessageKeys: Record<AdminUser["role"], MessageKey> = {
  student: "role.student",
  teacher: "role.teacher",
  admin: "role.admin",
};

interface ProfileDialogProps {
  user: AdminUser;
  onClose: () => void;
  onUpdated: (user: AdminUser) => void;
  onPasswordChanged: () => void;
}

export function ProfileDialog({ user, onClose, onUpdated, onPasswordChanged }: ProfileDialogProps) {
  const { t, locale } = useI18n();
  const [displayName, setDisplayName] = useState(isPlaceholderDisplayName(user.display_name) ? "" : user.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<unknown>(null);
  const name = displayNameOf(user);
  const role = t(roleMessageKeys[user.role]);
  const busy = saving || changingPassword;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api.updateProfile(displayName.trim() || null);
      onUpdated(result.user);
      setDisplayName(result.user.display_name ?? "");
      setSaved(true);
    } catch (reason) {
      setError(reason);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    const validationKey = validatePasswordChange(currentPassword, newPassword, confirmPassword);
    if (validationKey) {
      setPasswordError(new LocalizedError(validationKey));
      return;
    }
    setChangingPassword(true);
    setPasswordError(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onPasswordChanged();
    } catch (reason) {
      setPasswordError(reason);
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      title={t("profile.title")}
      description={t("profile.subtitle")}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
        <Button type="submit" form="profile-form" loading={saving} disabled={changingPassword}>
          <CheckCircle2 size={16} />{t("profile.save")}
        </Button>
      </>}
    >
      <div className="profile-summary">
        <span className="avatar">{initials(user.display_name, user.username, user.email)}</span>
        <div>
          <strong>{name}</strong>
          <small className="mono">@{user.username} · {role}</small>
        </div>
      </div>

      <dl className="profile-details">
        <div><dt><UserRound size={15} />{t("profile.username")}</dt><dd>{user.username}</dd></div>
        <div><dt><Mail size={15} />{t("profile.email")}</dt><dd>{user.email || t("profile.noEmail")}</dd></div>
        <div><dt><ShieldCheck size={15} />{t("profile.role")}</dt><dd>{role}</dd></div>
        <div><dt><CalendarDays size={15} />{t("profile.createdAt")}</dt><dd>{formatDate(user.created_at, locale)}</dd></div>
        <div><dt><Clock3 size={15} />{t("profile.lastSeenAt")}</dt><dd>{formatDate(user.last_seen_at, locale)}</dd></div>
      </dl>

      <form id="profile-form" className="form-stack" onSubmit={save}>
        <label htmlFor="profile-display-name">{t("profile.displayName")}
          <input
            id="profile-display-name"
            className="field"
            value={displayName}
            onChange={(event) => { setDisplayName(event.target.value); setSaved(false); }}
            maxLength={120}
            autoComplete="nickname"
            disabled={busy}
            data-autofocus
          />
        </label>
        <p className="field-hint">{t("profile.identityHint")}</p>
        {saved && <div className="notice notice-success" role="status"><CheckCircle2 size={17} /><span>{t("profile.saved")}</span></div>}
        {error != null && <p className="field-error" role="alert">{errorMessage(error, t)}</p>}
      </form>

      <section className="profile-password" aria-labelledby="profile-password-title">
        <div className="section-heading">
          <h2 id="profile-password-title"><KeyRound size={17} />{t("admin.profile.password.title")}</h2>
        </div>
        <p className="field-hint">{t("admin.profile.password.description")}</p>
        <form id="profile-password-form" className="form-stack" onSubmit={changePassword}>
          <label htmlFor="profile-current-password">{t("admin.profile.password.current")}
            <input
              id="profile-current-password"
              className="field"
              type="password"
              value={currentPassword}
              onChange={(event) => { setCurrentPassword(event.target.value); setPasswordError(null); }}
              autoComplete="current-password"
              maxLength={200}
              required
              disabled={busy}
            />
          </label>
          <label htmlFor="profile-new-password">{t("admin.profile.password.next")}
            <input
              id="profile-new-password"
              className="field"
              type="password"
              value={newPassword}
              onChange={(event) => { setNewPassword(event.target.value); setPasswordError(null); }}
              autoComplete="new-password"
              minLength={MIN_ADMIN_PASSWORD_LENGTH}
              maxLength={200}
              required
              disabled={busy}
            />
          </label>
          <label htmlFor="profile-confirm-password">{t("admin.profile.password.confirm")}
            <input
              id="profile-confirm-password"
              className="field"
              type="password"
              value={confirmPassword}
              onChange={(event) => { setConfirmPassword(event.target.value); setPasswordError(null); }}
              autoComplete="new-password"
              minLength={MIN_ADMIN_PASSWORD_LENGTH}
              maxLength={200}
              required
              disabled={busy}
            />
          </label>
          <p className="field-hint">{t("admin.profile.password.hint")}</p>
          {passwordError != null && <p className="field-error" role="alert">{errorMessage(passwordError, t)}</p>}
          <Button type="submit" variant="outline" loading={changingPassword} disabled={saving}>
            <KeyRound size={16} />{t("admin.profile.password.submit")}
          </Button>
        </form>
      </section>
    </Modal>
  );
}
