# verify-c7f2ea0f worktree 备份（2026-10-06）

回收 `.worktrees/verify-c7f2ea0f` 前的备份。该树基线 `c7f2ea0f`（第 357 页，早于 HEAD 两天），
按台账 `outputs/ledger-open-items-2026-10-05/inventory.md` 的 #69/#71 条目，这些改动属「同题两作，
别整簇并回」的范畴，但它们是未入库的在飞产物，不能直接丢。

## 备份内容

1. `no-progress-check.ts` — 该树对判据的修正（+18 行）：
   - `real-red-verify-stagnation` 改判 `silent`（旧判 `fire` 是误伤：中间有 shell 重定向写盘）
   - 新增 `synth-red-repeat-readonly-shell`（真阳性：只读命令间的同签名连红）
   - 新增 `synth-red-repeat-shell-write`（判别对照：shell 重定向写盘后应 silent）
2. `synth-red-repeat-readonly-shell.events.jsonl` — 新增的 fixtures 语料
3. `synth-red-repeat-shell-write.events.jsonl` — 新增的 fixtures 语料

## 处置建议（按台账口径）

- 这些改动与已入库的 `tests/loop-cap-verify-beat.test.ts` / `tests/loop-no-progress.test.ts` 同题两作
- 台账说「先重验『还剩哪几格真没落』再动手，别整簇并回」
- 若要采用，需：① 证明与已入库判卷不同题 ② 由业主在 `scripts/frozen-sha256.json` 登记新 fixtures
- 当前 `src/agent/loop.ts` + `src/agent/no-progress.ts` 被 worktree `agent-general-purpose-6e462e1c` 占着（#93 在飞）

## 回收依据

- 规则 120: detached ∧ 0 项在飞 ∧ 已入库 才算残留
- 该树 detached、3 项在飞（已备份）、c7f2ea0f 已是 zcode 祖先
- 主树已有该树的 outputs 副本（plan-persist-2026-10-05）
