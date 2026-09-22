# deny 被「git 全局选项」静默绕过：下游选项族（2026-09-22）

> **结论先行**：用户手写的 `deny run_shell "git push --force"`，在**五支**真实写法下完全不生效，
> 自主档实测 `approve@L4-pass`——命令会直接被执行。根因与 09-21 收口的那族（包装器在二进制**上游**）不同：
> 这一族的选项插在**二进制与子命令之间**，而规则匹配是**前缀匹配**，于是看不见子命令。
> 已修（`commandForms` 增「下游选项归一」后缀形），修后探针 **红 0 / 绿 42**。基线 HEAD `3162258`。

## 复现与读数（修前，逐支实测）

```sh
pnpm exec tsx scripts/probe-shell-bypass.ts        # ⑤ 段，修前红 5
```

| 命令 | 期望 | 修前实测 | worker 静态闸 |
|---|---|---|---|
| `git push --force` | deny@L1-deny | deny@L1-deny ✓ | 拦 |
| `git -C /tmp push --force` | deny@L1-deny | **approve@L4-pass** | 拦 |
| `git --no-pager push --force` | deny@L1-deny | **approve@L4-pass** | 拦 |
| `git -c advice.pushUpdateRejected=false push --force` | deny@L1-deny | **approve@L4-pass** | 拦 |
| `git --git-dir=/x push --force` | deny@L1-deny | **approve@L4-pass** | 拦 |
| `git -C/x push --force` | deny@L1-deny | **approve@L4-pass** | 拦 |

**为什么只有主会话这条路漏**：worker 的 `interceptDestructiveGit` 取 `args[0]` 当子命令，
`-C` / `--no-pager` 不在只读白名单里 ⇒ **fail-closed 侥幸拦住了**（代价是 reason 说成 `git -C 被拦截`，
读起来怪但不失守）。规则层是前缀匹配，没有这层 fail-closed 兜着，所以静默放行。

## 修法（`src/permissions/command-shape.ts`）

`commandForms` 过去对每个 invocation 只产一形（`bin + 全部 args`，即「剥掉上游包装器」）。
现在额外产**后缀形**：从每个**非选项**参数位置各起一形，于是
`git -C /tmp push --force` 也产出一支 `git push --force`。

```ts
function suffixForms(inv: Invocation): string[] {
  const out: string[] = [];
  if (EXEC_WRAPPERS.has(inv.bin)) return out;   // 只给「真命令」那一支生成
  for (let i = 1; i < inv.args.length; i++) {
    if (inv.args[i]!.startsWith("-")) continue; // 选项本身不冒充子命令
    out.push([inv.bin, ...inv.args.slice(i)].join(" ")…);
  }
  return out;
}
```

三条边界，都是钉住过的（不是想当然）：

1. **只作用于 deny/ask**：allow 仍只认原形。`allow run_shell "git status"` 配
   `git -C /tmp status` 实测 `judgeChain = miss` ⇒ 不替用户扩大同意面（这条不对称是 09-21 定的）。
2. **包装器那一支不产假形**：`sudo -u root git status` 曾多产 `sudo git status` / `sudo root git status`
   两支——被既有负控「只读 git 只产它自己那一形（多余候选=审批卡变多）」当场抓红。
   过覆盖与漏判方向相反，但同样是代价，所以它也得有界。
3. **过覆盖的残留形状**：`git log --format=%h push` 会产出一支 `git push` ⇒ 用户 deny「git push」时
   这条只读命令会被拦。取舍：**多一张卡 < deny 白写**；本族无按二进制区分的选项表，
   要消掉它就得给每个二进制建选项规范（成本另账）。

## 刻意没修的一支：选项边界的**两面**（需要一次语义裁决，不是 bug 修复）

顺着同一批变体往外推，`deny "git push --force"` 在**两个相反方向上都不对**，
而这两个错同根：规则匹配是**整串前缀**（`form.startsWith(pattern)`）。实测：

| 命令 | 今天 | 应然 | 错在 |
|---|---|---|---|
| `git push -f` | `approve@L4-pass` | deny | **漏判**：短标志与 `--force` 是同一个破坏性操作 |
| `git push --f` | `approve@L4-pass` | deny | 漏判：git 允许唯一前缀缩写 |
| `git push --force-with-lease` | **`deny@L1-deny`** | 不该 deny | **过覆盖**：用户没禁的那个、而且**更安全** |
| `git push --force-with-lease origin main` | `deny@L1-deny` | 不该 deny | 同上 |

⇒ 这不是「写宽一点」能收的：加宽会加剧过覆盖，收窄会把漏判留住甚至扩大。
**尤其要说的是那处反向激励**：现在的实现把推荐做法（`--force-with-lease`）拦下，
却让裸强推的短标志（`-f`）静默通过。

三条候选与代价，留给裁决时选（本轮不动实现）：

1. **只裁过覆盖**（选项整词匹配 + 缩写规则 `--fo` ↦ 以它开头的唯一长选项）：
   纯机械、不需要按二进制的表；但会把 `--force-with-lease` 从 deny 变成放行 ——
   即"收紧一头必放宽另一头"里的那一头，得先认这条取舍。
2. **再裁漏判**（短标志 ↔ 长标志别名表）：必须**按二进制且按子命令**建表
   （`tar -f` 是文件、`git push -f` 才是强推），`-F`/`--forest` 一类歧义还得逐个定。
   表一旦建起来就是新的维护面（本仓对「写死的默认」类账很敏感）。
3. **不改匹配，改审批卡文案**：把「规则命中」与「选项不同但子命令相同」分开呈现，
   让用户在卡上看见差异 —— 代价最低，但漏判仍在。

**重开条件**：任何一条被采纳时，`tests/shell-bypass-composition.test.ts` 的
「已知边界：deny 的选项两侧（未裁）」三条**必须一起翻**（它们钉的是现状，不是期望）。
`scripts/probe-shell-bypass.ts` 的 ⑤″ 段只打印不计红绿，正是为了让这两面一直可见。

## 锚点与复算

```sh
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts \
  tests/command-shape.test.ts tests/shell-bypass-composition.test.ts tests/permissions.test.ts
TERM=dumb node --import tsx scripts/mutate-verify.mjs \
  shape-downstream-option-forms-lost shape-suffix-forms-also-for-wrappers
```

| 锚点 | 改什么 | 必红的那条 |
|---|---|---|
| `shape-downstream-option-forms-lost` | 去掉后缀形生成 | 「五支写法在自主档全由 L1-deny 拦下」 |
| `shape-suffix-forms-also-for-wrappers` | 去掉包装器豁免 | 「包装器那一支不产假形」负控 |

## 本轮改动清单

- `scripts/lib/shell-bypass-cases.ts`：`GLOBAL_OPT_VARIANTS`（5）+ `GLOBAL_OPT_MUST_STAY_CLEAN`（4）
  + 未裁两侧的 `FLAG_UNDERHIT`（2）/ `FLAG_BOUNDARY_OVERHIT`（2）
- `scripts/probe-shell-bypass.ts`：新增 ⑤ / ⑤′ 负控 / ⑤″ 两侧只记录段（不计红绿，但要一直看得见）
- `src/permissions/command-shape.ts`：`suffixForms` + `commandForms` 接上
- `tests/command-shape.test.ts`：+4 条（29 → 33）
- `tests/shell-bypass-composition.test.ts`：+⑤ 族 4 条 + 已知边界 3 条（16 → 23）
- `scripts/mutate-verify.mjs`：+2 锚点（针脚 633 条，阻断 0）

## 读数（提交前跑齐，非提交后补票）

| 门 | 结果 |
|---|---|
| 探针 ①–⑤ | 修前 **红 5 / 绿 37** → 修后 **红 0 / 绿 42** |
| `test` | exit 0，`195 files / 1948 tests`（+8：4 条形态单测 + 4 条组合） |
| `e2e` | exit 0，闭环成立 + **判卷文件 sha256 与冻结逐字一致** |
| `security-check` | `43 ✅ / 0 ❌` |
| `typecheck` | exit 2，归因 `HEAD 内 0 个 / 未跟踪草稿 1 个`（他人 `scripts/sidebar-probe.ts`）；**HEAD 干净另在同 HEAD 开 worktree 实测**：`git worktree add --detach /tmp/dsh-wt-88e2316 HEAD` + `tsc --noEmit` ⇒ exit 0、零行输出 |
| `mutate-needles-check` | 633 条，阻断 0 / 待复认 0 / 未覆盖 0 |
| 两条新锚点 | 干净 HEAD `88e2316` 实跑全杀 |
| 同 HEAD worktree 复跑 | 三个权限测试文件 **84 条全过** |

一处自纠（同轮内）：`suffixForms` 的注释最初插在 `commandForms` 的文档块与函数之间，
把「规则匹配用的形态集」那段说明挤成了 `suffixForms` 的头注释——复核 diff 时调回顺序。
另一处：首版给包装器那一支也产后缀形，被既有负控「只读 git 只产它自己那一形」当场判红，
遂加 `EXEC_WRAPPERS` 豁免（这条负控比新断言更早存在，正是它的价值）。

### 追加（同日，未裁两侧入库）

`FLAG_UNDERHIT` / `FLAG_BOUNDARY_OVERHIT` 进共用清单、探针 ⑤″ 只打印不计红绿、
组合测加「已知边界（未裁）」3 条现状断言之后复跑：
`test` exit 0，**195 files / 1951 tests**（较上表 +3）；`typecheck` 归因 `HEAD 内 0 个`；
`mutate-needles-check` 仍 633 条阻断 0。实现一字未动 —— 这两侧的修法在等一次语义裁决。

## 再追加（同日）：⑥ 前缀词族 —— 同一把尺子量出来的三个新漏

把 ⑤ 的做法推广成**按位置枚举写法**的一次系统扫（26 种），结果 22 拦 4 漏，
其中 3 个是真缺词、1 个是伪漏判：

| 写法 | 修前 | 定性 |
|---|---|---|
| `eval git push --force`、`eval "git push --force; echo done"` | 两支面全漏 | **真漏**：`eval` 余下参数就是脚本 |
| `xargs git push --force`、`xargs -n1 …` | 两支面全漏 | **真漏**：余下 token 是被执行的命令 |
| `time git push --force`、`time -p …` | 两支面全漏 | **真漏**：`time` 只加测量 |
| `git push --fo=rcx` | 未拦 | **伪漏判**：git 自己会报「选项歧义/不认」，命令根本执行不了强推 |

修在同一个共用件里：`eval` 进 `SCRIPT_WRAPPERS`（载荷 = 余下参数原样 join，
**不滤** 以 `-` 开头的 token，否则 `--force` 会被自己削掉），`time` / `xargs` 进 `EXEC_WRAPPERS`
并各配 `VALUE_OPTS`。

### 施工时自己踩的第二个坑（已钉成锚点）

给 `time` 登记 `VALUE_OPTS` 时把布尔开关 `-p` 当成带值选项 ⇒ 解析器把后面的 `git` 当值吞掉，
`time -p git push --force` 依旧两支全漏。**这是"宁窄勿宽"那条规矩的反面教材**：
误登记一个带值选项的代价不是"少跳一步"，而是**把二进制本身吃掉**。
已收：`-p` 从表里去掉，并加一条锚点 `shape-time-p-misregistered-as-value-opt`
专门把「把 `-p` 登记成带值」这个错钉住（改回去必红）。

### 观测者与锚点

- 共用清单：`PREFIX_WORD_VARIANTS`（9）+ `PREFIX_WORD_MUST_STAY_CLEAN`（4 条负控）
- 探针 ⑥ / ⑥′：每支**两支面各一条**（规则层 + worker 闸），合计 红 0 / **绿 64**（原 42 + 22）
- 组合测 ⑥：3 条（两支面同拦、负控不牵连、`time -p` 的取料形状）
- 锚点 +3：`shape-eval-script-payload-lost`、`shape-exec-wrappers-drop-time-xargs`、
  `shape-time-p-misregistered-as-value-opt`

## 再再追加（同日）：⑦ 前缀词**枚举不完** —— 三条结构性候选的代价已量，等一次裁决

第二轮按位置扫写法又扫出 **15 个仍漏的前缀词**（setsid / ionice / stdbuf / chrt / watch / pkexec /
doas / sudoedit / script / unshare / flock / taskset / prlimit / strace / busybox），主会话自主档实测
`approve@L4-pass`（探针 ⑦ 段逐支印出）。**每层容器、调度器、追踪器都会再贡献几个词**——
按名字往 `EXEC_WRAPPERS` 里加是无穷追赶，所以这一轮**不加词**，改为把「往哪走」量成可裁的数字。

读数脚本：`outputs/measure-prefix-word-candidates-2026-09-22.mts`
（跑法 `node --import tsx outputs/measure-prefix-word-candidates-2026-09-22.mts`；一次性观测，不进门禁）。
匹配口径与 `rules.ts:matchSegment` 一致（deny 侧对形态做 pattern 前缀匹配）。

| 候选 | 15 支缺口 | 已收口 25 支 | 本仓真命令语料 40 支被牵连 | 手写负控 13 支被牵连 |
| --- | --- | --- | --- | --- |
| 今天（按名字白名单） | 0 | 25 | 0 | 0 |
| **A** = 今天 + 任意位置起后缀（首词不必登记） | **15** | 25 | 0 | **1**（`echo xargs git push --force`） |
| **B** = 今天 + pattern 的词按序出现即可（中间可插词） | **15** | 25 | 0 | 1（同左）＋`grep -e git -e push src --force` |
| B′ = 同 B 但限词距 ≤2 / ≤3 | 12 / **15** | 25 | 0 | 1（**词距界挡不住那支 grep**，见下） |
| **C** = 首词不在表里就升 ask（不看 pattern） | — | — | **40 / 40 出卡（100%）** | — |

三条读数里最值钱的三条：

1. **A/B 只能叠加、不能替换。** 把形态集整个换成 A 会倒退 9 支已收口的写法
   （`/usr/bin/git push --force` 的取基名、`bash -c` / `eval` 的载荷递归、`git -C /tmp push …` 的
   下游选项后缀全住在今天那一支里）。表里的 25/25 是「今天 ∪ 新增」才算得出的。
2. **C 作为字面政策当场死。** 仓里没有「已知可执行二进制」这张表，所以「首词未知」对
   `node --import tsx scripts/gates.ts` 这类日常命令恒成立——`pnpm test` 自己都要出卡。
   C 唯一可用的形态是「A/B 命中 **且** 首词未知 ⇒ 升 ask 而非 deny」，那是 A/B 的后果分级，不是第三条路线。
3. **量 ⑦ 的尺子顺手量出 ⑧ 一族**：`git push origin --force`、`git push --no-verify --force`、
   `git push origin HEAD --force` 三支**货真价实的强推**今天全漏——⑤ 的 `suffixForms` 只把全局选项从
   前缀位置挪走，pattern 仍是整条前缀匹配，「子命令与危险选项中间插了参数」它照样看不见。
   只有 B 收得住（A 不收）。worker 那一支照旧拦得住（`push` 非只读 ⇒ fail-closed，探针 ⑧ 逐支标了）。
4. **词距界不是那条闸**（我原本的猜想，实测推翻）：限「词距 ≤2」会漏 3 支——`chrt -f 10 git…`、
   `script -q /dev/null git…`、`taskset -c 0 git…`（前缀词自带**两个** token），而放到 ≤3 就与无界的 B
   召回相同（15/15）。更要紧的是那支假阳 `grep -e git -e push src --force` 的词距只有 1，
   **任何界都挡不住它**。⇒ 区分「这些词是命令」与「这些词是被 grep 的关键字」的事实，
   只有「首词是不是会被执行的 binary」这一条，而那又要一张表——**结构性判据并不能把名字表赶尽**，
   它只是把表从「包装器名」挪到「可执行名」。

### 牵连面这两列别读过头（诚实记账）

真命令语料 = `package.json` 的 39 条 scripts + `fixtures/mock/todo-fix.jsonl` 里那条 `run_shell`，
去重 40 支（HEAD 态实跑；**分母随 `package.json` 漂移**——在飞那份多一条 scripts 时是 41，所以它是读数不是判据）。
它对 A/B 的「牵连 0」**近乎空读**——这 40 支里根本没有 pattern 字样，这一列只量得出 C 的
ask 率。A/B 的牵连证据是：负控 1 支（`echo xargs git push --force`，已在 `PREFIX_WORD_MUST_STAY_CLEAN`
里钉着，实现 A 的那一刻它必红）＋形似非恶意六支（`echo git push --force` / `printf git push --force`
被 A、B 牵连；带引号的 `echo 'git push --force'`、`grep -rn "git push --force" src`、
`git commit -m 'git push --force 已禁用'` 不牵连，因为分词把载荷收成了单个 token）。
⇒ A/B 的真实代价是**「把 echo/printf 的参数当命令」这一类**，不是「审批卡普遍变多」。

### 建议与重开条件

裁决点其实只有一句：**认不认「未知首词命中 deny ⇒ 不静默拒绝，而是出卡」**。

- 建议：**B（无界按序子序列，等价于 ≤3）+ 后果分级**——pattern 命中且**首词不在已知表**时降为 ask，
  首词已知（`git` / `env` / `sudo` / `bash -c` …）仍按 deny。一次改动同时收 ⑦ 的 15 支与 ⑧ 的 3 支，
  而把「误伤 `echo git push --force` / 那支 grep」从**命令被拒**降级为**多一张卡**。
  代价要说清楚：用户手写的 deny 在未知前缀词那一族上**不再绝对**（变成必问），这是拿确定性换召回。
- 备选（更保守）：纯 A + 分级。少收 ⑧ 的 3 支真强推，其余与上面同。
- 不采纳：继续按词加 `EXEC_WRAPPERS`（⑦ 的存在理由）；C 的字面版「首词未知就 ask」（40/40 出卡）。
- 反向证据要求：落地时必须同批钉一条「allow 侧不吃这些形态」（沿用 ⑤ 那条不对称断言的形状），
  否则就是把用户点过的「总是允许」顺着匹配器放宽。
- 重开条件：`tests/shell-bypass-composition.test.ts` 里 ⑦ / ⑧ 两个「已知边界」块**变红**
  （有人动了匹配语义却没说），或 `pnpm exec tsx scripts/probe-shell-bypass.ts` 的 ⑦/⑧ 段读数转 deny。

### ⑦ / ⑧ 的观测者与判据

- 共用清单 +2：`UNBOUNDED_PREFIX_WORDS`（15）、`INSERTED_ARG_UNDERHIT`（3）＋对照面 `STRUCTURE_ALREADY_COVERS`（4）
- 探针 ⑦ / ⑧：**只印不判**（不计红绿，合计仍是 红 0 / 绿 64）——这两族是"已知仍漏"，计红会把
  一次待裁的语义分歧混进"缺陷未修"的账里
- 组合测 +4（现 30 条）：15 支全 miss、结构性对照面全 deny、⑧ 三支全 miss、⑧ 三支 worker 侧全拦
- 本轮**零实现改动**（`src/` 未动）。上表的**判定**对 HEAD 与在飞态同值——同 HEAD 开 worktree 复跑实证：组合测 30 条 +
  `command-shape` 33 条全绿、探针仍 红 0 / 绿 64、候选表逐行同值。只有语料**分母**随 `package.json` 的 scripts
  条数漂移，表内取 HEAD 态 40 支（上一笔提交说明里写的 41 是在飞态那份 package.json 算出来的，以本表为准）


## 再追加（同日，裁决后施工）：⑨ 选项边界选了「整词匹配」——过覆盖那一侧修掉了

上面「刻意没修」那节列的三条候选，用户裁 **① + ③**（先修过覆盖 + 卡片文案），漏判那一侧（`-f` / `--f`）
继续留账。所以那节的原文保留不动（它是该日的现状快照），本节记落地。

**改了什么**（`src/permissions/rules.ts`）：新增 `prefixLenAtBoundary(text, pattern)` ——
pattern 去掉尾部空白后必须命中，且命中处的**右邻只能是行尾或空白**。
`matchSegment` 的 **deny/ask 与 allow 两支一起换**：不对称的仍是「allow 只吃原形、deny/ask 吃形态面」，
边界两侧同规（`allow git status` 覆盖 `git status-bar` 同样是不该发生的）。

| 命令 | 修前 | 修后 |
|---|---|---|
| `git push --force-with-lease` | `deny@L1-deny`（反向激励） | 不命中这条 deny |
| `git push --force-with-lease origin main` | `deny@L1-deny` | 不命中 |
| `git push --force` / `--force --no-verify` / `--force origin main` | deny | **仍 deny**（边界在空白处） |
| `sudo git push --force`、`git -C /tmp push --force` | deny | **仍 deny**（形态面未动） |
| `git push -f` / `--f` | `approve@L4-pass` | 未变（要收它得建按二进制的标志别名表，另账） |

**卡片文案**（`src/permissions/autonomy.ts`）：L1-deny 与 L2-ask 的理由改走同一个构造口
`ruleHitReason()`，除 ruleId 外补一句「匹配按完整 token 为界」。
旧文案只有 `deny 规则命中（deny:run_shell:git push --force#0）`——被过覆盖误伤的人既看不懂为什么被拦、
也不知道该改哪条规则。`ChainVerdict` 为此带上命中规则的 `pattern`。
（`plugins-check` E4 断言的 `deny 规则命中` 前缀逐字保留，不受影响。）

**观测者与锚点**
- 共用清单 +1：`BOUNDARY_MUST_STAY_DENY`（5）——「边界收紧不许顺手放宽」这一侧的证据面
- 探针 ⑤″ 从「只印不计红绿」升为 ⑨ 的**真断言**：过覆盖侧 2 条 + 仍须 deny 侧 5 条 + 卡面文案 1 条，
  合计 红 0 / **绿 72**（原 64）；漏判侧那 2 条继续只印
- 组合测 +3（现 33 条，本块由 3 条改 6 条）：过覆盖侧已修、五支仍 deny、allow 侧同讲边界、卡面说得出规则与匹配口径，
  另把原「worker 侧」与「漏判侧」两条留在同一块里（漏判那条红就说明有人偷偷建了别名表）
- 锚点：既有 `rule-matcher-deny-ignores-wrappers` 的针脚随实现改写；
  新增 `rule-matcher-token-boundary-dropped`（退回整串前缀 ⇒ 过覆盖用例必红）、
  `rule-matcher-allow-ignores-token-boundary`（只给 deny 侧讲边界 ⇒ allow 边界用例必红）。针脚体检 638 条阻断 0
