# 测试与验证

## 本地命令

```sh
pnpm install --frozen-lockfile
pnpm typecheck          # TypeScript 类型检查
pnpm test               # 核心行为测试（Vitest）
pnpm --filter cairn-desktop test   # 桌面行为测试
pnpm verify              # 公开 CI 的 L1 全套（类型 + 核心/桌面测试 + 产品契约门）
```

## 分层

| 层级 | 跑什么 | 何时跑 |
|---|---|---|
| **L1 · 公开契约** | `PUBLIC_GATES`：类型、核心/桌面测试、权限/沙箱、安全、回放、会话语义等 31 项 | 每个 PR / push，`pnpm verify` |
| **L2 · 发布认证** | `head-cert-check`、`mutate-verify`、`mutate-needles-check`、`head-import-check`、`bench-judge-spec-check`、`gym-check` | 维护者发布前或夜跑，不阻塞公开 PR |
| **L3 · 历史审计** | 内部文档台账、历史证据与体积审计 | 私有审计仓，不随公开仓库分发 |

L1 的名单唯一事实源是 [`scripts/gate-manifest.ts`](../scripts/gate-manifest.ts) 的 `PUBLIC_GATES`；
CI 只调用 `pnpm verify`，不手抄第二份名单。

## 判卷的边界

- 测试证明的是**当前产品契约**。测试绿不等于模型能力好，也不等于用户任务一定完成。
- 演示 provider（`--provider demo`）是预录剧本，不是判卷结论；看退出码，不看台词。
- 不修改冻结 fixtures、不弱化断言来换绿灯；要改判据，单独提 PR 说明理由。
- 缺少凭据时 `provider:check` 会明确标「未证」，不会写成通过。
