import { useState, type FormEvent } from "react";
import { CalendarDays, CheckCircle2, Clock3, Mail, ShieldCheck, UserRound } from "lucide-react";
import { api, errorMessage, type AdminUser } from "../api";
import { displayNameOf, isPlaceholderDisplayName } from "../lib/display-name";
import { formatDate, initials } from "../lib/format";
import { Button, Modal } from "./ui";

const roleLabels: Record<AdminUser["role"], string> = {
  student: "学生",
  teacher: "教师",
  admin: "管理员",
};

interface ProfileDialogProps {
  user: AdminUser;
  onClose: () => void;
  onUpdated: (user: AdminUser) => void;
}

export function ProfileDialog({ user, onClose, onUpdated }: ProfileDialogProps) {
  const [displayName, setDisplayName] = useState(isPlaceholderDisplayName(user.display_name) ? "" : user.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const name = displayNameOf(user);
  const role = roleLabels[user.role];

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
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="用户信息"
      description="查看当前登录账号的资料，并更新在学习端展示的名称。"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
        <Button type="submit" form="profile-form" loading={saving}>
          <CheckCircle2 size={16} />保存更改
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
        <div><dt><UserRound size={15} />用户名</dt><dd>{user.username}</dd></div>
        <div><dt><Mail size={15} />邮箱</dt><dd>{user.email || "未设置"}</dd></div>
        <div><dt><ShieldCheck size={15} />账号角色</dt><dd>{role}</dd></div>
        <div><dt><CalendarDays size={15} />注册时间</dt><dd>{formatDate(user.created_at)}</dd></div>
        <div><dt><Clock3 size={15} />最近登录</dt><dd>{formatDate(user.last_seen_at)}</dd></div>
      </dl>

      <form id="profile-form" className="form-stack" onSubmit={save}>
        <label htmlFor="profile-display-name">显示名
          <input
            id="profile-display-name"
            className="field"
            value={displayName}
            onChange={(event) => { setDisplayName(event.target.value); setSaved(false); }}
            maxLength={120}
            autoComplete="nickname"
            data-autofocus
          />
        </label>
        <p className="field-hint">留空时回退显示用户名；用户名与邮箱由管理员维护。</p>
        {saved && <div className="notice notice-success" role="status"><CheckCircle2 size={17} /><span>资料已更新。</span></div>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
