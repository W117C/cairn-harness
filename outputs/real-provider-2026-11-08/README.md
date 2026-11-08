# 真实 provider 验收记录（2026-11-08）

## 范围

- 构建/工作树：`integration-main-dev-20261108` 工作树（集成 `main` + 公开候选打包批之后的待提交树）。
- 平台：macOS 27.2 / arm64；Node v24.19.0；pnpm 11.21.0。
- 凭据来源：本机 `~/.config/cairn/env`（`CAIRN_ENDPOINT` / `CAIRN_MODEL` / `CAIRN_API_KEY`）。
  凭据值不写入本文件、日志或仓库。
- 端点与模型：`https://tokenrhythm.studio/v1` / `mimo-v2.6-flash`（仅记录非敏感标识）。

## 操作与结果

| 操作 | 预期 | 实际 | 证据 |
|---|---|---|---|
| `./bin/cairn.mjs --doctor` | 环境自检通过 | exit 0；keys/沙箱/工作区/设置/信任面均为就绪 | `doctor.log` |
| `node --import tsx scripts/provider-check.ts` 调用①（纯文本流式） | 收到 ≥2 个 delta 与 usage | 失败：HTTP 403 `IDENTITY_VERIFICATION_REQUIRED`（账户未完成实名认证，`identityStatus=unverified`） | `provider-check.log` |
| 调用②（带 tools）与 JSONL 重放 | 解析出 tool_call、重放逐字一致 | 未执行：调用①在建立流时即被 provider 拒绝，未产生事件 | `provider-check.log` |
| 首次配置 provider / 连接失败提示 | 失败时给出可理解提示 | `--doctor` 报「就绪」；真实调用 403 原文只在 `provider-check.log` 与 CLI 错误栈中可见，桌面首次配置面尚未走真实端点 | 本记录 |
| 打开项目、完成小型真实代码修改、查看 diff | 真实模型驱动完成 | 未执行：provider 账户被实名认证拦截 | 本记录 |
| 运行中取消、失败重试、重启恢复、同名会话隔离 | 行为符合预期 | 单元/集成判卷覆盖；本轮未在真实 provider 上复跑 | 见 core/desktop 套件 |

## 结论

真实模型验收**未通过**，阻塞原因是外部 provider 账户状态（实名认证未完成），不是代码缺陷。
不在本仓库写入或猜测凭据；完成认证后按同一命令重跑 `provider-check.ts`，再执行
`docs/desktop-preview.md` 的预览包真实任务步骤。完成前不得把本轮写成「真实模型验收通过」。
