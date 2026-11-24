# 管理面板 API（M6.1）

> 设计依据：`docs/编程学习系统设计书.md` §7.1 / §7.3 / §8 M6.1。所有接口位于 `/api/v1/admin`。
> 除 `GET /accounts/download/:token` 外，均要求活跃的教师或管理员会话；学生调用返回 403。`/audit` 与 `/check` 仅管理员可用。

## 通用约定

- JSON 错误：`{ "error": { "code": string, "message": string, "request_id": string } }`。
- 列表使用 `limit`（1–100，默认 20）与 `offset`（≥0）分页，返回 `{ items, total, limit, offset }` 中的实际字段名。
- 时间均为 ISO 8601 UTC。
- 创建发号批次、重置密码的响应含一次性凭据；其余列表/概览/审计接口绝不返回密码、CSV 或下载 token。

## 会话与配置

| 方法 | 路径 | 响应 |
|---|---|---|
| GET | `/config` | `{ instance_name: string, editor_url: string \| null, learner_url: string \| null, download_link_ttl_hours: 24 }` |
| GET | `/overview` | `{ accounts: { total, active, disabled, password_change_required }, teachers: { total, active }, courses: { total, enabled }, batches: { pending, downloaded, expired, revoked }, recent_batches: IssuedBatch[], recent_audit: AuditEvent[] }`；教师的 `recent_audit` 为空 |
| GET | `/audit?limit=&offset=` | `{ events: AuditEvent[], total, limit, offset }` |

`IssuedBatch`：`{ id, filename, role: "student"|"teacher", count, status: "pending"|"downloaded"|"expired"|"revoked", expires_at, downloaded_at: string|null, revoked_at: string|null, created_at }`。

`AuditEvent`：`{ id, actor_id, actor_username, actor_email: string|null, action, target_type, target_id: string|null, metadata: Record<string, unknown>, created_at }`。

## 批量发号

CSV 列为 `username,email,display_name[,password]`；首行可选。用户名必填且唯一，邮箱列可留空，显示名留空时使用用户名，空密码列表示系统生成。单次 1–500 个账号，用户名与邮箱均不区分大小写。指定密码至少 10 个字符且不能以 `=`、`+`、`-`、`@` 开头，避免电子表格公式注入。

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/accounts/batch/preview` | `{ csv, filename?, role?: "student" \| "teacher" }` | `{ filename, count, generated_count, specified_count, rows: { username, email: string|null, display_name, password_mode }[], conflicts: string[] }` |
| POST | `/accounts/batch` | `{ csv, filename?, role?: "student" \| "teacher" }` | 201：`{ batch: IssuedBatch, download_url: string }` |
| GET | `/accounts/batches?limit=&offset=` | — | `{ batches: IssuedBatch[], total, limit, offset }` |
| DELETE | `/accounts/batches/:id` | — | `{ ok: true }`；仅撤销 pending 批次 |
| GET | `/accounts/download/:token` | — | 一次性 CSV 附件；24 小时过期；已撤销/已领取/过期均返回 404 |

预览中的 `conflicts` 是数据库中已存在的用户名或邮箱；预览不建号，也不生成最终随机密码。正式创建时仍由数据库唯一约束保证原子回滚。下载使用条件 `UPDATE ... RETURNING` 原子消费，响应带 `Cache-Control: no-store`；领取后清空 `csv_text`。

## 学生与教师账号

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/accounts?query=&status=&role=&password_state=&limit=&offset=` | `role: student\|teacher` | `{ accounts: AdminAccount[], total, limit, offset }` |
| PATCH | `/accounts/:id` | `{ username?: string, email?: string \| null, display_name?: string, status?: "active" \| "disabled", role?: "student" \| "teacher" }` | `{ account: AdminAccount }` |
| POST | `/accounts/:id/password-reset` | — | `{ temporary_password: string, must_change_password: true }` |

`AdminAccount`：`{ id, username, email: string|null, display_name, role: "student"|"teacher", status, must_change_password, created_at, last_seen_at: string|null, password_updated_at: string|null, batch_id: string|null, batch_filename: string|null }`。用户名必填且唯一，邮箱可空；非空邮箱唯一。教师只能查询和管理学生；管理员可管理学生与教师，但不能管理管理员。仅管理员可修改角色，角色变更会撤销目标账号会话。重置密码会撤销目标账号全部会话，且不改变启停状态。

## 当前用户资料

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/v1/me` | — | `{ user: PublicUser }` |
| PATCH | `/api/v1/me` | `{ display_name?: string \| null }` | `{ user: PublicUser }` |

`PublicUser`：`{ id, username, email: string|null, display_name: string|null, role, status, must_change_password, created_at, last_seen_at }`。用户只能修改自己的 `display_name`；用户名与邮箱由管理端维护。空字符串、纯空白或仅含 `?` / `？` / 替换字符的显示名统一保存为 `null`，界面回退到用户名。临时密码会话可读取 `/api/v1/me`，但不能修改资料。

## 课程

学习端课程接口已抽象为通用 provider，当前版本固定无课：`GET /api/v1/courses` 返回 `{ courses: [] }`，课程详情、整包与单文件接口返回 404。管理端课程 API 与课程包存储仍保留给后续课程实现；管理面板 UI 暂不展示上传/上下架入口。

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/courses` | — | `{ courses: AdminCourse[] }` |
| POST | `/courses` | `{ pack: Record<string, string> }` | 201：`{ course: AdminCourse }` |
| PATCH | `/courses/:id` | `{ enabled: boolean }` | `{ course: AdminCourse }` |

`AdminCourse` 在学习端课程字段基础上增加 `enabled: boolean, created_at, updated_at`。上传沿用服务端课程包 schema 校验；同 slug 上传会创建新版本并启用课程。配置 R2 时课程正文写入尝试唯一的版本化对象，D1 只保存元数据，`pack_json` 为 `NULL`；R2 写失败不修改 D1，D1 写失败会清理本次 R2 对象，课程元数据与审计同批提交。读取 R2 时校验字节数和 SHA-256，损坏、不可用或对象缺失返回 503；未配置 R2 时只使用 D1 `pack_json`，不再回读历史 R2/D1 双写数据。编码后超过 1.5 MB 仍返回 413，作为当前上传 API 的统一限制。

## 初始化入口

唯一初始化入口为 `POST /api/v1/setup`，只允许空实例调用，返回 `201 { user, instance_name }`。学习端四步向导使用该入口；管理面板空实例时根据 `GET /api/v1/auth/status` 的 `setup_url` 跳转，不再提供初始化表单。`/setup` 创建首个管理员、写入实例名（默认 `CodeQuest`）、记录 `bootstrap` 审计并签发会话；可选传 `course_pack`，请求格式为 `{ instance_name, admin: { username, email?, password, display_name? }, course_pack? }`。登录 `POST /api/v1/auth/login` 使用 `{ identifier, password }`，identifier 可为用户名或邮箱，用户名匹配优先。重复初始化返回 409 `SETUP_COMPLETED`。`auth/status.setup_url` 默认 `/setup`，配置 `LEARNER_URL` 时为其末尾拼接 `/setup`。
