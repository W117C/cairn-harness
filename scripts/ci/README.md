# CI 兜底（M9）：为什么有、覆盖什么、代价多少、还不能做什么

**动因**：31 道门全靠人记得跑，而仓库自己点过账——**86 笔提交跑在红灯上**；
`.git/hooks/post-checkout` 与 `post-commit` 是只有一行 `#!/bin/sh` 的空壳，`core.hooksPath` 未设置。
⇒ 质量此前**没有任何自动保险丝**（`outputs/_audit2-quality.md`，能力 9）。

## L1（已落地，零打扰）：`.github/workflows/verify.yml`

- **覆盖**：`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test`（全量判卷）→
  **快门面** `pnpm gates --only=…`（= `CERT_GATES` 减两道已知红，逐道点名在 workflow 里）。
- **触发**：`push` / `pull_request` / `workflow_dispatch`（手动）。
- **本地零影响**：不装钩子、不改任何本地行为；只有推上去才跑。
- **本地复现一模一样的一串**（首次跑通前，CI 里的任何结论都以下面这串的实测为准）：

  ```sh
  pnpm install --frozen-lockfile
  pnpm typecheck
  pnpm test
  pnpm gates --only=no-progress-check,prune-check,fork-check,compaction-check,docs-check,memory-check,head-import-check,autonomy-check,sandbox:check,security-check,provider:check,routing-check,model-surface-check,prefix-churn-check,prompt-surface-check,replay-determinism-check,cost-per-progress-check,web-fetch-check,gym-check,evidence-typecheck-check
  ```

- **校验状态（诚实标注）**：YAML 已用 `ruby -ryaml` 解析通过（结构化读取成功，不是"看着像"）；
  那一串命令在本机按同序跑过（读数见 `outputs/m9-ci-2026-10-01/`）。
  **但"GitHub 上的首次真实运行"本机无法验证** ⇒ 首次推上去视作一次联调，不预先宣称 CI 已绿。

### 两道被排除的门（不是遗漏，是登记）

| 门 | 现读 | 归属 |
|---|---|---|
| `gate-check` | 红：H7 冻结表与 `fixtures/impact/accuracy-repo/*` 双向不一致 | 任务 #9（`1748ca7`） |
| `mutate-needles-check` | 红：4 条锚点的针脚被 `d1371dd` 搬走实现（门自己点了 `4c10272`/`404249c`/`e76ed13`） | 任务 #23 |

两道都**不进** L1：把已知红放进 CI 只会训练人忽略红灯（那正是要治的病）。修好后各加回一行
（workflow 里留了那行注释）。

### 更重的门为什么也不进 L1

`head-cert-check`（实测 **123.7s**，含全量判卷）与 `mutate-verify`（**18–25 分钟**）不进每次 push 的
CI——它们是**合并/收尾**那一档的动作（路线图 §5.3 的合并前清单），不是每笔提交的保险丝。
需要时用 `workflow_dispatch` 手动触发（或按 §5.3 在本地跑）。

## L2（**未落地**：pre-commit 钩子——需要业主拍板）

候选形态：`pre-commit` 只跑 `pnpm typecheck`（本机实测约 5–8 秒）。

**为什么本笔不加**：钩子作用于**这台机器上的所有并行会话**的每一次提交——加它等于单方面改掉
其他人的提交体验（路线图 §M9 禁区原文：「不要在本地加会拖慢每次提交的钩子，除非业主明确同意」）。
若要做，验收至少要有：可一键关闭（`git config --unset core.hooksPath` 或 `--no-verify` 的**受控**用法）、
一次"故意类型错被挡下"的反向验证、以及对本机提交耗时的实测读数。

## 反向验证（L1 的判据有没有分辨力）

「故意提交一处类型错误 → CI 配置能抓到（本地用同样命令证）」：
在 `src/` 放一个临时类型错文件 → 跑 workflow 里那条同款 `pnpm typecheck` → 必须 exit≠0 且点名那个文件；
删掉 → 复绿。读数落 `outputs/m9-ci-2026-10-01/`（文件名带 `reverse-verify`）。
