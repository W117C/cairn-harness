# CI 兜底（M9）：为什么有、覆盖什么、代价多少、还不能做什么

**动因**：31 道门全靠人记得跑，而仓库自己点过账——**86 笔提交跑在红灯上**；
`.git/hooks/post-checkout` 与 `post-commit` 是只有一行 `#!/bin/sh` 的空壳，`core.hooksPath` 未设置。
⇒ 质量此前**没有任何自动保险丝**（`outputs/_audit2-quality.md`，能力 9）。

## L1（已落地，零打扰）：`.github/workflows/verify.yml`

- **覆盖**：`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test:capped`（全量核心判卷，maxWorkers=2）→
  **快门面** `pnpm gates --only=…`（= `CERT_GATES` 那 25 道，唯一定义在 `scripts/gate-manifest.ts`，
  逐道点名在 workflow 里；10-02 起不再减门，见下一节）。
- **工具链版本钉在一处**（第 475 页）：`package.json` 的 `packageManager` 与 workflow 里的
  `pnpm/action-setup` 同大版本（现读 11）。这不是洁癖——pnpm 9 与 11 **读 overrides 的地方不是一个**
  （9 读 package.json 的 `pnpm` 字段、11 读 `pnpm-workspace.yaml`），差一个大版本就会让同一份锁文件
  在两处解释成两种配置，CI 上直接 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`。
- **触发**：`push` / `pull_request` / `workflow_dispatch`（手动）。
- **本地零影响**：不装钩子、不改任何本地行为；只有推上去才跑。
- **本地复现一模一样的一串**（首次跑通前，CI 里的任何结论都以下面这串的实测为准；首次远端运行现已完成）：

  ```sh
  pnpm install --frozen-lockfile
  pnpm typecheck
  pnpm test:capped
  # 2026-10-12：cert face 23 → 25（买进 e2e 与 desktop-test，理由见 scripts/gate-manifest.ts 的 CERT_GATES 买入注）
  pnpm gates --only=no-progress-check,prune-check,fork-check,compaction-check,docs-check,memory-check,head-import-check,autonomy-check,sandbox:check,security-check,provider:check,routing-check,model-surface-check,prefix-churn-check,prompt-surface-check,replay-determinism-check,cost-per-progress-check,web-fetch-check,gym-check,evidence-typecheck-check,gate-check,mutate-needles-check,repo-hygiene-check,e2e,desktop-test
  ```

- **校验状态（按提交区分）**：YAML 曾用 `ruby -ryaml` 解析通过；那一串命令在本机按同序跑过
  （历史读数见 `outputs/m9-ci-2026-10-01/`）。GitHub Actions 的真实运行已验证：2026-10-14 11:47Z，
  [`verify` run 38559010713](https://github.com/W117C/cairn-harness/actions/runs/38559010713) 在
  `zcode@074656c522ac7b6b350f389bd854fb28a712da0b` 全绿。这个结果只认证该远端提交；本地 HEAD 及
  未提交工作树须另行验证。下次远端提交仍应以对应 run 的 SHA 和结果为准。

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

## L1 的增量（2026-10-25 仓库标准化）

这一段记的是**在 L1 之上加的东西**，以及**为什么这么加**。
L1 本身的取舍（快门面 25 道、更重的门不进每次 push、pre-commit 不做）一个字没动。

### 并发组：同一 ref 上只留最新的一趟

```yaml
concurrency:
  group: verify-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

**为什么**：本仓每趟 verify 要跑完整判卷 + 快门面。连续推送时会叠出好几趟并行——
**重复的是同一份树，浪费的是计费分钟**。取消的是**被取代**的那一趟，不是最新那一趟：
最新那趟仍会跑完并给出读数。

> ⚠️ 这条只省算力，**不改变任何判读口径**：被取消的那一趟本来就要被更新的那趟取代。
> 想看历史某一趟的读数，被取消的 run 在 Actions 里仍留记录（状态是 cancelled）。

### 最小权限

```yaml
permissions:
  contents: read
```

这道门只需要读仓库（checkout + 跑判卷）。默认的写权限是**能用上但用不到**的权限面——
在能给的最小面上给，是 CI 的基本卫生。

### L1′：公开仓库的 CodeQL 分析

静态分析与 verify 分别取证。仓库已于 2026-10-26 转为公开，原来“私有仓库无此能力”的前提已不适用。

- 触发：main 的 push、面向 main 的 pull_request，以及 workflow_dispatch；不新增周期任务。
- JavaScript/TypeScript 使用上游 Action 的 `languages` 输入和 `build-mode: none`，不构建产品。
- 扫描 src、apps/desktop/src、bin、scripts；历史工件、夹具和 node_modules 不混入生产源码分析。
- CodeQL 告警是待核对的静态证据；不把数量当成已验证可利用漏洞数，也不替代 core/desktop 回归。
- 配置、权限与执行记录以 `.github/workflows/codeql.yml` 和对应 GitHub Actions 为准。

### 当前 CI 状态与旧账单阻塞

公开前的 verify 有账户付款/支出限制，任务没有启动；这些失败记录仍保留。
公开后已在原提交上重新启动真实 CI，不能再把旧账单限制当成当前必然阻塞。
最新运行链接和剩余事项见 `docs/ROADMAP.md`；必须核对 run 的提交与结论再报告通过。

## 反向验证（L1 的判据有没有分辨力）

「故意提交一处类型错误 → CI 配置能抓到（本地用同样命令证）」：
在 `src/` 放一个临时类型错文件 → 跑 workflow 里那条同款 `pnpm typecheck` → 必须 exit≠0 且点名那个文件；
删掉 → 复绿。读数落 `outputs/m9-ci-2026-10-01/`（文件名带 `reverse-verify`）。
