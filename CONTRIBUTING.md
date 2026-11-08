# 参与 Cairn 的开发

本文件是**贡献者入口**：怎么把仓库跑起来、改什么要落在哪一层、提交前必须过哪些门。
规则本身的**唯一事实源**是 [`AGENTS.md`](AGENTS.md)——本文件只做导航与展开，
两者冲突时以 `AGENTS.md` 为准。

---

## 1. 先确认受众边界

Cairn 目前处于 **B1 内测**阶段，交付面只有 CLI（桌面端不在 v1 交付面内）。
受众与范围的裁决见 [`docs/adr/0002-v1-audience-b1-internal-beta.md`](docs/adr/0002-v1-audience-b1-internal-beta.md)，
扩大受众的清单留门 [`docs/b2-checklist.md`](docs/b2-checklist.md)。
**在读这两份之前不要扩大改动面。**

本仓是**专有软件**：许可与分发边界见 [`LICENSE`](LICENSE)。

---

## 2. 开发环境

| 项 | 要求 | 事实源 |
|---|---|---|
| Node | `>=20.11.0 <25` | `package.json` 的 `engines` |
| 包管理器 | pnpm（版本由 `packageManager` 字段单点声明） | `package.json` |
| 凭据 | 只走环境变量，不落文件 | 见 §7 |

```sh
git clone https://github.com/W117C/cairn-harness.git
cd cairn-harness
pnpm install --frozen-lockfile
```

> `pnpm-lock.yaml` 是**事实源**。锁文件不一致时 CI 会直接判红（`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`），
> 这不是噪声，是真的漂了。改依赖请走 `pnpm add` / `pnpm update -r`，不要手改锁文件。

---

## 3. 跑起来

```sh
pnpm typecheck        # tsc --noEmit
pnpm test             # 核心套件整跑
pnpm test:capped      # 核心套件（限并发；8GB 机器上的可复现读数用这个）
pnpm --filter cairn-desktop test    # 桌面套件 + 边界闸
pnpm gates            # 门禁全集（清单在 scripts/gate-manifest.ts）
```

**没有 API key 也能看完整流程**：

```sh
./bin/cairn.mjs --provider demo --mode auto --workspace /tmp/cairn-demo "随便写点什么"
```

`demo` 跑的是**预录剧本**：不拨号、不花钱，但剧本内容与你的任务无关，
结尾那句「任务完成」是台词而不是判卷结论——**看退出码，别看台词**。

---

## 4. 改什么落在哪一层（四层文档）

这是本仓**最容易做错**的一件事：写错层不仅难看，还会让 `docs-check` 判红。

| 层 | 落点 | 放什么 | 写法 |
|---|---|---|---|
| 规矩层 | [`AGENTS.md`](AGENTS.md) | 不知道就会这一轮做错事的规则 | **只加新规则** |
| 现态层 | [`STATE.md`](STATE.md)、[`docs/README.md`](docs/README.md)、[`docs/CODE-WIKI.md`](docs/CODE-WIKI.md) | 现在在哪、在飞什么、还没裁什么 | **整体重写，永不追加** |
| 台账层 | [`PROGRESS.md`](PROGRESS.md) | 历史与审计链：备案、裁决全文、各轮实录 | **只追加**，页号是引用单位 |
| 档案层 | [`archive/`](archive/) | 不再现行的结论 | 归档 |

由 `docs-check` 机械守护的几条：

- **D-1** 现态层有字节预算（只准下调，不准调高）
- **D-2** 现态层不许手抄观测值——**指向 `pnpm facts`**，不要把读数抄进正文
- **D-4** 现态层不许用「追注」代替改写
- **D-5** `STATE.md` 的 `rev:` 必须是一个**真实存在的提交**

**台账层不搬进 `archive/`**：门有多张面直接拿 `PROGRESS.md` 当事实源，
搬走会让那些面「读不到」被读成「没问题」——那是本仓最忌的假绿形状。
现态层的瘦法是**把结论迁进 `archive/`**，不是把台账搬走。

文档指针一律用**标签锚点**，不用行号（重排即静默打断，而没有门会知道）。

---

## 5. 验证：改了什么就跑什么

| 改动面 | 必跑 |
|---|---|
| 任意 | `pnpm typecheck` |
| 核心行为 | `pnpm test:capped`（或 `pnpm test`） |
| 桌面行为 | `pnpm --filter cairn-desktop test` |
| 跨层依赖 | `pnpm desktop-boundary-check` |
| 规则 / 文档 | `pnpm docs-check` |
| 提交前全量 | `pnpm gates` |

**核心套件的口径**：8GB 机器上默认 worker 数会超订，届时报的
`Test timed out` / Chrome 渲染超时是**负载假象，不是逻辑回归**——
这些用例单跑都过。要一个**可复现**的整跑读数，就用 `pnpm test:capped`
（＝`vitest run --config tests/vitest.config.ts --maxWorkers=2`）。
**引用核心套件读数时必须带上并发档位**，不带并发档的计数不是可复现读数。

门禁清单的事实源是 `scripts/gate-manifest.ts`。`pnpm gates` 不带参数跑的是**全集**，
比认证面（`CERT_GATES`）慢、面也不同——引用读数时要说明跑的是哪一面。

**`pnpm mutate-verify` 量的是 HEAD，不是工作树**——改动必须先提交才能被它量。
它在一次性 worktree 里跑，不要在主检出里跑，也不要绕过它的隔离闸。

---

## 6. 提交与分支

**提交信息**用 Conventional Commits，作用域写清子系统：

```
feat(orchestration): <一句话说做了什么>
fix(orchestration): <一句话说修了什么>
docs(orchestration): <一句话说哪一页落了什么>
chore(repo): <一句话说动了哪一处>
```

标题用中文正文、ASCII 作用域名，与本仓既有历史一致。

### 6.1 提交面纪律

门 `repo-hygiene-check` 判的是**这一笔自己的形状**：

- **一笔里从树里消失的文件数有帽**（现读帽见 `scripts/lib/commit-surface.ts` 的 `DELETED_FILE_CAP`）。
  超帽且没有备案 ⇒ 阻断。确实要删那么多，就在说明里写
  `删除备案：<为什么>` 再落——只留标记不给话**仍然阻断**。
- **删除占比高但消失文件少** ⇒ 出声不阻断。
- **取不到读数（树里 0 支文件 / 读不出）⇒ 判红**，不许折成 0 放行。

### 6.2 取料面（`outputs/`）

`outputs/` 是**证据面**：凭证页与它的证人**同笔落库**，这是本仓的纪律。
因此：

- `outputs/` 里的新记录**必须点名它自己的取料目录**，
  否则 `docs-check` 的凭证对账面会把它判成「未检」；
- 工件确实没入库的，在登记表里写清**当年为什么查不到**；
- **永远不要把源码副本停在 `outputs/`**：那里是真被 typecheck 的
  （`tsconfig.evidence.json` 覆盖它），副本的相对 import 解析不到 ⇒ 幻影危险代码。
  要留档就留非 TS 的（`.md` / `.json` / `.log`）。

取料占比有帽，`outputs/` 的占比不许越过它——**超了就是新增了不该入库的取料**。

### 6.3 其它

- **先看 diff 再改**。别人的在飞改动一律保留：不 reset、不 stash、不顺手捎进本次提交。
- **不许改冻结的判卷文件与夹具、不许放松断言、不许调低验证要求来让一道红门变绿。**
- 核心与桌面之间**反向依赖禁止**（`src/` 不得 import `apps/desktop/`）；
  `scripts/desktop-boundary-check.ts` 机械守这一条。

---

## 7. 凭据

**凭据只走环境变量，不落文件、不进 commit、不进事件日志。**

| provider | 环境变量 |
|---|---|
| `glm` | `CAIRN_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |

事件日志落盘前会做密钥脱敏（`src/agent/loop.ts` 的 `redactSecrets`），
但**不要依赖它**：你的第一道防线是不写进去。

---

## 8. PR 自检清单

提交 PR 前逐条对照：

- [ ] `pnpm typecheck` 通过
- [ ] 改了核心行为 ⇒ 核心套件跑过；改了桌面 ⇒ 桌面套件跑过
- [ ] 改了规则或文档 ⇒ `pnpm docs-check` 通过
- [ ] 改了跨层依赖 ⇒ `pnpm desktop-boundary-check` 通过
- [ ] 提交信息符合 Conventional Commits，作用域清楚
- [ ] 没有把别人在飞的改动捎进来
- [ ] 没有凭据、机器本地状态、运行产物混进提交
- [ ] 引用读数时带上了**读数来自哪一面**与**并发档位**
- [ ] 提交里没有删掉超过帽值的文件；超了就在说明里写了 `删除备案：<为什么>`

---

## 9. 报告问题

- **功能缺陷 / 需求** → GitHub Issues（模板见 `.github/ISSUE_TEMPLATE/`）
- **安全漏洞** → **不要开公开 Issue**，见 [`SECURITY.md`](SECURITY.md)
- **用法问题** → 见 [`SUPPORT.md`](SUPPORT.md)
- **行为与文档不一致** → 可能是 bug，也可能是文档层选错了；两种都要提

---

## 10. 行为准则

参与即接受 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。
