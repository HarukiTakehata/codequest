import { useEffect, useId, useState, type FormEvent } from "react";
import { CalendarDays, Clock3, Mail, ShieldCheck, UserRound, X } from "lucide-react";
import { api, type User } from "../api";
import { displayNameOf, isPlaceholderDisplayName } from "../display-name";
import { useI18n } from "../i18n/I18nProvider";
import { localizeError } from "../i18n/errors";

interface ProfilePanelProps {
  user: User;
  onClose: () => void;
  onUpdated: (user: User) => void;
}

export function ProfilePanel({ user, onClose, onUpdated }: ProfilePanelProps) {
  const { t, locale } = useI18n();
  const [displayName, setDisplayName] = useState(isPlaceholderDisplayName(user.display_name) ? "" : user.display_name ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const titleId = useId();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const formatDate = (value: string | null | undefined) => {
    if (!value) return t("profile.notAvailable");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("profile.notAvailable");
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.updateProfile(displayName.trim() || null);
      onUpdated(result.user);
      setDisplayName(result.user.display_name ?? "");
      setMessage({ tone: "success", text: t("profile.saved") });
    } catch (reason) {
      setMessage({ tone: "error", text: localizeError(reason, t, "profile.failed") });
    } finally {
      setBusy(false);
    }
  };

  const name = displayNameOf(user);
  const initial = name.trim().charAt(0).toUpperCase() || "CQ";
  const role = t(`role.${user.role}`);

  return (
    <div className="profile-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="profile-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="profile-header">
          <div>
            <span className="eyebrow">{t("profile.eyebrow")}</span>
            <h2 id={titleId}>{t("profile.title")}</h2>
            <p>{t("profile.subtitle")}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("profile.close")} title={t("profile.close")}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="profile-identity">
          <span className="profile-avatar">{initial}</span>
          <div>
            <strong>{name}</strong>
            <span>@{user.username} · {role}</span>
          </div>
        </div>

        <dl className="profile-facts">
          <div><dt><UserRound size={15} aria-hidden="true" />{t("profile.username")}</dt><dd>{user.username}</dd></div>
          <div><dt><Mail size={15} aria-hidden="true" />{t("profile.email")}</dt><dd>{user.email || t("profile.noEmail")}</dd></div>
          <div><dt><ShieldCheck size={15} aria-hidden="true" />{t("profile.role")}</dt><dd>{role}</dd></div>
          <div><dt><CalendarDays size={15} aria-hidden="true" />{t("profile.createdAt")}</dt><dd>{formatDate(user.created_at)}</dd></div>
          <div><dt><Clock3 size={15} aria-hidden="true" />{t("profile.lastSeenAt")}</dt><dd>{formatDate(user.last_seen_at)}</dd></div>
        </dl>

        <form className="profile-form" onSubmit={save}>
          <label htmlFor="profile-display-name">{t("profile.displayName")}
            <input
              id="profile-display-name"
              className="field"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={120}
              autoComplete="nickname"
            />
          </label>
          <p className="field-hint">{t("profile.displayNameHint")}</p>
          <p className="field-hint">{t("profile.identityHint")}</p>
          {message && <p className={`form-message is-${message.tone}`} role="status">{message.text}</p>}
          <div className="profile-actions">
            <button type="button" className="button button-ghost" onClick={onClose}>{t("common.cancel")}</button>
            <button type="submit" className="button button-primary" disabled={busy} aria-busy={busy || undefined}>
              {busy ? t("profile.saving") : t("profile.save")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
