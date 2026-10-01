### 2026-10-01 · M9 收口 · L2 裁决定案：**不做** pre-commit 钩子（业主授权"按最优解处理"下的裁决；一键启用路径与反悔条件已写明）

取料面（全名逐支）：`scripts/ci/README.md`（「L2（裁决定案：不做）」一节）、`.github/workflows/verify.yml` 头注。

1. **裁决**：不加 pre-commit 钩子。依据三条：⑴ 本树多会话共享，钩子跑整棵树 typecheck ⇒ 别人在飞的脏文件会把提交卡死（**当日实测**：`scripts/docs-check.ts` 在飞状态让 typecheck 红了数小时）；被他人状态卡住的提交只会训练出 `--no-verify`，比没有钩子更坏；⑵ 已有覆盖——L1 在 push 时跑同一条 `pnpm typecheck`、房屋协议 §5.4 第 4 步本就要求提交前自跑、合并档有 head-cert；⑶ 收益边际——本地 5–8s × 所有并行会话的每次提交，换的只是"早几分钟发现"，而 CI 必拦。
2. **可逆性**（裁决必须可翻）：README 里写好**一线启用路径**（建 `.githooks/pre-commit` + `git config core.hooksPath .githooks`）与零成本撤销（`--unset`），并写明**反悔条件**（"同一类型错连穿两笔 CI"之类证据出现即翻回）。
3. **不改任何本地行为**：L1 的"No local impact"承诺保持——这一笔只改文档与注释。
