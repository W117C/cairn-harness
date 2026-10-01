# 交接：`feat/m7-permission-allowlist` 待并入 `zcode`（7 笔，M5/M6/M7 三格）

**给正在 `zcode` 上开发的会话** —— 这是路线图 M5/M6/M7 三格一次攒下的改动，已全部落地、验证、
并在写这份说明时**实测零冲突并入**。

- **分支**：`feat/m7-permission-allowlist`（本次已在 `zcode-merge` 上实测并入）
- **基点**：`5e0c859`（我开工时的 `zcode`）
- **提交数**：7
- **合并冲突**：**0**（`git merge-tree --write-tree zcode feat/m7-permission-allowlist` 退出 0）

> ⚠️ **为什么已经在 `zcode-merge` 上并好，而不是直接并进 `zcode`**：
> 写这份说明时 `zcode` 的主工作树**不干净**——有他人未提交的 `scripts/docs-check.ts`
> （新增 D-12「省略式点名」判据，+47/−5）与 `src/agent/map/parse.ts`。
> **不把他人未提交的工作并进来**（那是他的，不是我的），所以我另起 `zcode-merge` 落合并，
> 由集成 owner 挑时机合进 `zcode`。见下面「五、两个合并期要注意的坑」。

---

## 一、你要做的（两条命令）

> ✅ **已合并**：`zcode-merge` 已于 2026-10-02 快进并入 `zcode`（`git merge --ff-only zcode-merge`，
> 零冲突、零新文件）。合并前先验过两条：合并要动的 28 个文件与 zcode 工作树上**别人未提交的**
> 两处改动**无交集**，要新增的文件与**未跟踪**文件**无撞名** —— 那两处未提交工作合并后原样保留。
> 回滚点：`d311b19`。

```sh
cd "/Users/ze/Downloads/deepseek harness"   # 主树，当前在 zcode
git log --oneline -3                        # 确认 09e9c9e / 79e1188 已在
node --import tsx scripts/typecheck.ts       # 预期：0 报错
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts   # 预期：见下表
```

**合并后在 zcode 上的实测读数**（工作树 = HEAD ＋ 别人未提交的 D-12，判卷四面**在飞 4 项**）：

| 项 | 读数 |
|---|---|
| typecheck | 0 报错，exit=0 |
| `docs-check` | exit=0（台账 sha 面、凭证对账、证人点名面 红 0） |
| `memory-check` | exit=0 |
| 全量判卷 | **3681 条全绿**，155.9s，exit=0 |
| 断言体检 | 零命中（扫描面 92 个脚本） |

> 3681 比合并分支上的 3676 多 5 条：差的不是我的东西，是 zcode 工作树上别人那份**未跟踪**的
> `tests/impact-multilang.test.ts` 也在盘上。**所以这一趟是工作树认证，不是纯 HEAD 认证**——
> 门自己印了这句话（「在飞 4 项 ⇒ 本表全 0 不等于 HEAD 全 0」）。要纯 HEAD 认证得在隔离 worktree 里跑整表。

**回滚**：`git reset --hard d311b19`（若在 zcode 上直接回退）。

---

## 二、这三格里最要紧的两处

### 1. M7 · 未登记的工具名，默认方向是反的 ← **最要紧**

`src/permissions/index.ts` 的 `evaluate()` 里，`isSideEffectTool` 是**黑名单**：
**任何没登记的名字一律放行**（四档全部 `approve`）。今天没有可利用的洞（26 个在册名逐个核过都登了记），
但这是**默认值**问题——以后新增一族工具忘了登记 `SIDE_EFFECT_TOOLS`，就会静默绕过只读档与方案门。
同一函数下一行是「未列出的档位取 ask」（保守）：**未知档位=ask（安全） vs 未知工具=allow（不安全）**，
两条默认方向相反。

改成：新工具名按写处理并**逐次审批**，复用既有 `L4-mcp-unannotated` 层（不新增层）。
在册 26 名 × 4 档 = **104 格零回归**（金标准表逐格点名，不是通则——通则会跟被改对象一起漂）。

**方案书指错了主犯**：它点名 `checkPermission`，实测那是近乎死代码（全仓唯一生产调用点在
`src/agent/loop.ts:401`，而 `checkPermission` 在 `agent-runner.ts` 里 import 了却零调用）。
第一版按原计划在它上面也加了守卫 → **全量套件红 4 条**，因为 `loop.ts` 早已有那道未知工具闸、
且 `tests/registry-rung.test.ts` 明写「不许拿静态 TOOLS 当唯一源」。
**守卫已撤回**，撤回理由留在源码注释里，并由判卷 C3 用例钉住「别被加回来」。

### 2. M6 · 记忆里的教训必须带证据指针

既有 `distill.ts` 给的正是「凭空总结」那一支：计数摘要（`verify×2（工具失败）`），
**不带 callId、不带会话**，结论交给模型自由写。新增 `src/agent/memory/lessons.ts`：
**确定性纯函数**（不经模型）把失败轨迹提炼成条目，每条逐字带 `session#callId`。

**硬门**：造不出证据指针 ⇒ **不产出条目**（实现上「造不出证据」与「造不出条目」是同一条路径，
不靠事后过滤）。反向验证：把每一处证据门摘掉再跑判卷 ⇒ **19 条里 9 条变红**。

一个设计问题被实测数据改了：来源③「同一 `(工具,参数)` 重复调用」原本不限工具，
对 20 份 tracked 日志离线提炼，**40 条教训里 35 条是 `read_file` 读同一个文件**——
re-read 是「确认改动写进去了」的**正常**动作 ⇒ 收窄为只收写向工具，同批 **40 → 10 条**。

---

## 三、其余要点

- **M5**：`verify.ts` 补 **typecheck 验证面**（只在既有前两档都没产出时生效）+ 重复失败**升级处置**
  （第 3 拍起追加「别再改同一处、先判这条红可不可修」，第 2 拍文案**逐字不动**）。
  **禁区一条没碰**：`autoVerify` 默认不动、归因类别零新增。
  命令选 `./node_modules/.bin/tsc` 而非 `npx`——实测缺失时前者退出 **127** ⇒ 落进**既有**的
  `toolchain-missing`（环境类，不扣模型额度），后者退出 1 且不匹配包管理器正则 ⇒ 被判 `code`
  = **拿 harness 的环境问题扣模型的钱**。
  **lint 面不做**：`src/agent/verify.ts:162` 与既有变异锚点明写「只补 test，绝不凭空造 lint」。
  **写范围缩到 `verify.ts`，没动 `loop.ts`**——`runVerifyOutcome` 本来就返回多 result 数组，
  新增一面只是多一个 result，不改拍数记账（路线图的写范围含 `loop.ts`，这是实测缩小的）。

---

## 四、门禁现状（照贴，不写成「全绿」）

三道门绿（typecheck / docs-check / memory-check）、断言体检零命中。
**`mutate-verify` 在 M7、M6 两轮都以 `exit=124` 超时收场**（预算 1200s 耗尽），
日志里可见的 ❌ 全部是**父提交就存在**的失效锚点，无一条属 M5/M6/M7 的文件——
逐条归因写在 `outputs/m6-acceptance-2026-10-01/EVIDENCE.md` §5.5 与
`outputs/m7-permission-allowlist-2026-10-01/EVIDENCE.md` §8。
**它没跑完这件事本身照贴**，不写成「全绿」。

---

## 五、两个合并期要注意的坑

### 1. D-12 注释里的「第 292 页」和我的第 292 页撞号

zcode 未提交的 `docs-check.ts` 里，D-12 的注释写「（第 292 页）」——
但**台账第 292 页是我的 M7 收口页**（zcode 已提交的只到第 **291 页**）。
⇒ 合并后同一页号会指两件不同的事。**建议把 D-12 注释里的页号改成 295**（或它真正的落笔页号）。

> 合并后实测：**没有真撞**——三道门在**含 D-12 未提交改动**的工作树上仍全绿，
> 那条新判据与我的三页无冲突（`docs-check.ts` 本就不在合并面里）。
> 所以这是**注释读起来会歧义**，不是缺陷。

### 2. 合并后判卷红了 2 条，根因在金标准表 —— 已在本分支补齐

**零文件冲突 ≠ 能过**。合并后全量判卷 **2 failed / 3674 passed**，红的是 M7 自己的两条零回归金标准：

```
AssertionError: 金标准缺 apply_patch——新增工具必须在这里点名，否则本段会跟着行为一起漂
AssertionError: apply_patch @ read-only 非交互: expected 'deny' to be 'allow'
```

根因：`tests/permissions-tool-registry.test.ts` 的金标准表**故意不写通则、逐格写死**
（通则本身就是被改对象，会跟着行为一起漂）。zcode 在我写表之后新增了三个工具，
表里没有它们 ⇒ 按设计就该红。**这正是那张表存在的理由在生效，不是它坏了。**

缺口一次列全（实测裁决，非推断）：`apply_patch`、`diagnose`（均写入向）、`web_search`（出网）。
已在 `zcode-merge` 上补点名，并**逐条反向验证**（各自从 `SIDE_EFFECT_TOOLS` 摘掉 ⇒ 2 红，还原后 9/9 绿）。

> **合并到 `zcode` 后请重跑全量判卷**：`ALL_NAMES` 是从 zcode 的工具面**派生**的，
> 你那侧再新增工具，这张表还会以同样方式要求点名——这是有意的，不是维护负担。

### 3. 台账是追加的，两边都往尾部接

zcode 已提交的第 290/291 页在 9739 行之前，我的第 292/293/294 页接在其后
（合并后台账 432 页 / 9858 行）。合并零冲突是因为**两边恰好都接在尾部**；
若 `zcode` 在此之后又追加了页，下一次合并仍应是追加式零冲突，但**页号要接着往下数**。

---

## 六、留给集成 owner 的两行请求（本轮只提不改）

1. **`scripts/gate-manifest.ts` 未加新门**：M5/M6/M7 的判卷**全部走既有 `test` 门**，
   故意不新增 `*-check` 脚本（新脚本会触发孤儿护栏并迫使改热文件）。
2. **`src/main/agent-runner.ts:3` 的注释与事实不符**：写着「真实门…复用 `checkPermission`」，
   实际真实门是 `evaluate`，`checkPermission` 在该文件里零调用。属 M7 §5.1 的共享面，只改注释。