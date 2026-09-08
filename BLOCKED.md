# BLOCKED.md（待裁决清单）

无阻塞事项。

## 待裁决（非阻塞，不影响交付）
1. **pnpm-workspace.yaml 的去留**：`pnpm add` 期间 pnpm 11 自动生成（内容仅 ignoredBuiltDependencies: [esbuild]，即任务书"坑一"的官方记录方式）。不在任务书白名单内，故未提交 git；也未删除（删文件属不可逆操作）。建议：领导拍板后 `git add pnpm-workspace.yaml` 入库或直接删除，二选一即可，删除后下次 install pnpm 会重新生成。
2. **pnpm-lock.yaml 已随任务 1 入库**：lockfile 不在白名单字面列表中，但它是 `pnpm add`（任务 1 明确要求）的直接产物，为可复现性随 package.json 一并提交。若不允许，`git rm --cached pnpm-lock.yaml` 即可。

## 背景注记（已解决的环境坑，无需裁决）
- 根目录不允许新建 vitest.config.ts → 改由 package.json 脚本显式 `--config tests/vitest.config.ts`（根 vitest 默认 include 会扫进 oh-src/ 的 772 个外部测试文件）。
- pnpm 11.8 下 tsx CLI 包装吞子进程 stdout/stderr 且丢退出码 → scripts 统一 `node --import tsx`（tsx 官方推荐用法）。
