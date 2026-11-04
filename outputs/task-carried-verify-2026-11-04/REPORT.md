# 任务自带判据：首批落地与实测

日期：2026-11-04（Asia/Shanghai）。分支 `fix/spec-summary-double-count`。
本文件是证据面：命令、输出、事件行号。设计见 `docs/superpowers/specs/2026-11-04-task-carried-verify-design.md`。

## 一、改了什么

| 文件 | 改动 |
| --- | --- |
| `src/agent/verify-plan.ts` | 新增：`validateVerifyDeclaration`（形状/空白/空表/超时上下限，越界拒收不夹取）、`resolveVerifyConfig`（声明 > 仓库配置 > 探测） |
| `src/events/types.ts` | `VerifyDeclaration`；`SessionMetaEvent.verify?`；`SessionMetaUpdateEvent.verify?`；`VerifyResultEvent.source?` |
| `src/agent/verify.ts` | `VerifySource`；`runVerifyOutcome` 接受已解析配置并回填 `source`；`createVerifyHook` 接受 `resolved`；导出超时上下限 |
| `src/agent/loop.ts` | `verify_result` 照抄钩子报的 `source`（不报就不编） |
| `src/main/agent-runner.ts` | `RunOverrides` / `RunOptions` 增加 `verifyDeclaration`；钩子按声明解析 |
| `src/cli.ts` | `--verify`（可重复）；坏声明当场拒；开工前写 `session_meta_update{verify}` |
| `tests/verify-plan.test.ts` | 8 条：优先级、回旧行为、四类非法声明、来源标记、钩子按声明执行 |

## 二、判卷（现跑）

```
npx vitest run --config tests/vitest.config.ts tests/verify.test.ts tests/verify-plan.test.ts \
  tests/verify-cause.test.ts tests/verify-multiface.test.ts tests/verify-trust.test.ts \
  tests/verify-trust-fingerprint.test.ts
→ 6 文件 / 99 条全绿
node --import tsx scripts/typecheck.ts
→ tsc --noEmit 通过（0 条报错）
```

反向验证（`source` 标记）：删掉 `loop.ts` 那行后，`verify_result 的来源标记` 用例由绿转红
（`expected undefined to be 'task'`），复原后 7/7 全绿——这一格不是恒真。

## 三、端到端（demo provider，零凭据、零远端）

工作区 `.tmp/verify-e2e`，命令：

```
node bin/cairn.mjs --workspace <ws> --provider demo \
  --verify "node -e \"process.exit(0)\"" --mode auto "说一句话"
```

事件流（`cli-1793796735287.jsonl`）：

```
#1  session_meta_update  {"verify":{"commands":["node -e \"process.exit(0)\""]}}
#14 verify_result        {"ok":true,"source":"task","auto":true,"attempt":1}  command=node -e "process.exit(0)"
```

账本（`.tmp/verify-e2e/.agent/evolution-ledger.jsonl`）：

```
{"v":1,"type":"run","session":"cli-1793796735287","verifyOutcome":"green","patches":0,...}
```

必败判据（`--verify "node -e \"process.exit(1)\""`）：

```
{"ok":false,"source":"task","cause":"code","auto":true,"attempt":1}
账本：{"session":"cli-1793796752772","verifyOutcome":"red",...}
```

回放：`cairn --workspace <ws> --replay cli-1793796735287` 第 1 行是 `session_meta_update`，
第 14 行是 `verify_result 验证 通过（第 1/3 拍）`。

## 四、读数

| 指标 | 改前 | 改后 |
| --- | --- | --- |
| 判据覆盖率（近 11 天会话） | 2/25 | 本笔 demo 跑 1/1 带 `source:"task"`（不是产品会话，不能并与基线） |
| 账本 `verifyOutcome` | 桌面路径有、CLI 未验证 | CLI 两条（一绿一红）均入账，与事件流一致 |

**尚未证明**：真实模型会话下的覆盖率、`--session` 续跑沿用首次声明（代码按"读既有事件流"设计，
本轮未跑该路径）、桌面端入口（本轮不做）。

## 五、边界

- 未跑全量 `pnpm gates` / `head-cert` / `mutate-verify`（工作树未提交，HEAD 认证不转移）。
- `apps/**` 未动。
- demo provider 是预录剧本，不证明真实模型的任务质量；它只证明判据通道本身通了。
