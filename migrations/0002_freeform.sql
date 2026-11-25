-- 自由模式草稿：不绑定剧情/课程，按用户 + 语言保存（R8 云端同步）。
CREATE TABLE IF NOT EXISTS freeform_drafts (
  user_id TEXT NOT NULL REFERENCES users(id),
  lang TEXT NOT NULL CHECK (lang IN ('javascript','python','cpp','shell','java')),
  code TEXT NOT NULL DEFAULT '',
  stdin TEXT NOT NULL DEFAULT '',
  testcases_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lang)
);
