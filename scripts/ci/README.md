# CI 兜底（M9）：为什么有、覆盖什么、代价多少、还不能做什么

**动因**：31 道门全靠人记得跑，而仓库自己点过账——**86 笔提交跑在红灯上**；
`.git/hooks/post-checkout` 与 `post-commit` 是只有一行 `#!/bin/sh` 的空壳，`core.hooksPath` 未设置。
⇒ 质量此前**没有任何自动保险丝**（`outputs/_audit2-quality.md`，能力 9）。

## L1（已落地，零打扰）：`.github/workflows/verify.yml`

- **覆盖**：`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test`（全量判卷）→
  **快门面** `pnpm gates --only=…`（= `CERT_GATES` 那 25 道，唯一定义在 `scripts/gate-manifest.ts`，
  逐道点名在 workflow 里；10-02 起不再减门，见下一节）。
- **工具链版本钉在一处**（第 475 页）：`package.json` 的 `packageManager` 与 workflow 里的
  `pnpm/action-setup` 同大版本（现读 11）。这不是洁癖——pnpm 9 与 11 **读 overrides 的地方不是一个**
  （9 读 package.json 的 `pnpm` 字段、11 读 `pnpm-workspace.yaml`），差一个大版本就会让同一份锁文件
  在两处解释成两种配置，CI 上直接 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`。
- **触发**：`push` / `pull_request` / `workflow_dispatch`（手动）。
- **本地零影响**：不装钩子、不改任何本地行为；只有推上去才跑。
- **本地复现一模一样的一串**（首次跑通前，CI 里的任何结论都以下面这串的实测为准）：

  ```sh
  pnpm install --frozen-lockfile
  pnpm typecheck
  pnpm test
  # 2026-10-12：cert face 23 → 25（买进 e2e 与 desktop-test，理由见 scripts/gate-manifest.ts 的 CERT_GATES 买入注）
  pnpm gates --only=no-progress-check,prune-check,fork-check,compaction-check,docs-check,memory-check,head-import-check,autonomy-check,sandbox:check,security-check,provider:check,routing-check,model-surface-check,prefix-churn-check,prompt-surface-check,replay-determinism-check,cost-per-progress-check,web-fetch-check,gym-check,evidence-typecheck-check,gate-check,mutate-needles-check,repo-hygiene-check,e2e,desktop-test
  ```

- **校验状态（诚实标注）**：YAML 已用 `ruby -ryaml` 解析通过（结构化读取成功，不是"看着像"）；
  那一串命令在本机按同序跑过（读数见 `outputs/m9-ci-2026-10-01/`）。
  **但"GitHub 上的首次真实运行"本机无法验证** ⇒ 首次推上去视作一次联调，不预先宣称 CI 已绿。

### 两道曾被排除的门：10-02 已结案并加回（这一段留作登记，不是现状）

| 门 | 当初为什么排除（10-01 现读） | 结案证据 |
|---|---|---|
| `gate-check` | 红：H7 冻结表与 `fixtures/impact/accuracy-repo/*` 双向不一致 | 认证树 `认证门面=22 道（跑到 22）｜绿 22 道`（`outputs/retry-backoff-2026-10-02/head-cert-7cc9605.log`） |
| `mutate-needles-check` | 红：4 条锚点的针脚被 `d1371dd` 搬走实现 | 同一趟里这道门 `✅ mutate-needles-check exit=0`；条数与阻断数取自主树那份 `needles.log`（`针脚体检：1238 条 —— 阻断 0`） |

原则没变：**已知红不进 CI**（把红灯接进流水线只会训练人忽略它）。这两道修好了就加回——
就是 workflow 里那句注释预留的动作，10-02 兑现。名单与 `CERT_GATES` 的**集合相等**由
`tests/cert-gate-face.test.ts` 的「手抄的第二份名单必须与唯一事实源逐项相等」逐趟钉住
（两份手抄件：workflow 那句 `--only=` 与本页下面那个复跑块；顺序不要求一致）。
> ⚠️ 第 319 页勘误：这一段原先写「**由脚本核过**（两边各 22 道、双向差集为空）」——那是 10-02
> **人工核对**的记录，被写成了常态性质的样子，而当时**并不存在**这样一份判据（全仓 `grep` 无任何
> 引用 `.github/workflows` 的判据）。代价当场就出现了：写这句话的时候，**本页自己的复跑块少了
> `gate-check` 与 `mutate-needles-check` 两道门**（20 项 vs 名单 22 项），而那份"脚本核过"本该抓到它。
> 现已补成判据并修好那一行；「核对过一次 ≠ 此后每趟都核」这一条教训按同族记在判卷注释里。

### 更重的门为什么也不进 L1

`head-cert-check`（实测 **123.7s**，含全量判卷）与 `mutate-verify`（**18–25 分钟**）不进每次 push 的
CI——它们是**合并/收尾**那一档的动作（路线图 §5.3 的合并前清单），不是每笔提交的保险丝。
需要时用 `workflow_dispatch` 手动触发（或按 §5.3 在本地跑）。

## L2（**裁决定案：不做**）：pre-commit 钩子

2026-10-01 业主授权「按最优解处理」，据此裁定**不加** pre-commit 钩子。理由三条：

1. **本树是多会话共享的工作树，钩子跑整棵树的 typecheck** ⇒ **别人在飞的脏文件**会把你的提交卡死
   （有实测：`scripts/docs-check.ts` 的在飞状态让 `pnpm typecheck` 红了数小时）。一次被他人状态
   卡住的提交只会训练出 `--no-verify`——那比没有钩子更坏（本仓规约：不许无理由跳钩子）。
2. **已有覆盖**：L1 在 push 时跑同一条 `pnpm typecheck`；房屋协议（路线图 §5.4 第 4 步）本来就要求
   提交前自跑；更重的 `head-cert-check` 覆盖合并档。
3. **收益边际**：本地 5–8s × **所有并行会话的每一次提交**，换的是"早几分钟发现类型错"——而 CI 会拦。

**随时可翻（一线启用路径，零成本撤销）**：

```sh
mkdir -p .githooks && printf '#!/bin/sh\npnpm typecheck\n' > .githooks/pre-commit && chmod +x .githooks/pre-commit
git config core.hooksPath .githooks     # 撤销：git config --unset core.hooksPath
```

**反悔条件（写清才叫裁决）**：若出现"同一类型错连穿两笔 CI"或"CI 因类型错红了 ≥2 次且本可
本地拦住"这类证据，把上面两条命令跑一遍翻回来。

## 反向验证（L1 的判据有没有分辨力）

「故意提交一处类型错误 → CI 配置能抓到（本地用同样命令证）」：
在 `src/` 放一个临时类型错文件 → 跑 workflow 里那条同款 `pnpm typecheck` → 必须 exit≠0 且点名那个文件；
删掉 → 复绿。读数落 `outputs/m9-ci-2026-10-01/`（文件名带 `reverse-verify`）。
