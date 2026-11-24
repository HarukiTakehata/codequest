# 发布产物

`admin/` 由 `npm run build:admin` 生成，内容来自 `apps/admin/dist/`，供设计书 §7.3 中的 nginx `root` 使用。

该目录已加入 `.gitignore`；部署前先执行构建，不要把本地 `.dev.vars`、D1 状态或 `node_modules` 复制进发布目录。
