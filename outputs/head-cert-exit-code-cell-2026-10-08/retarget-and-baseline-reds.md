# 第 426 页那一搬的补正：三处旧证人取料落空、两根锚点针脚搬家（2026-10-08）

## 1. 谁喊出来的

派生复认（`--changed-since=d15c4ebd`，干净树 `verify-08c081e`，0 项在飞）：

```text
改动面派生：rev=d15c4ebd → 变更文件 6 个 ⇒ 选中锚点 65/1496 条
✅ …… 62 条（含本簇四根 cert-exit-code-* 全杀）
❌ 判红 2 条，按类别分开（修法各不同，混成一句会把人指错方向）：baseline-red 2
  ❌ 判红·基线就不绿 ⇒ 本条判定被污染，不算存活的证据（2 条）：
     concurrency-wired-into-exit-code  cert-gate-face-not-spawned
REDKINDS=survived:0,misattributed:0,baseline-red:2,no-effect:0,syntax:0,restore-mismatch:0,vacuous:0
```

门把这两条分类成 **baseline-red**（基线就不绿 ⇒ 这条锚点此刻量不出东西，不许读成存活）。
在干净 HEAD 上单跑那两个文件，复现 3 条红：

```text
× 作废必须改退出码：只印一行而门照绿 ⇒ 这道门永远不会因为树被切走而红        （tests/head-cert-deps.test.ts）
× 反向哨兵：并发套数刻意不进退出码（别的会话在跑不是我这笔代码错…）        （tests/head-cert-deps.test.ts）
× 跑门那一行、名单来源、退出码里的门红三项都在语句开头                      （tests/cert-gate-face.test.ts）
```

⇒ **是本簇带来的**：第 426 页把 `const code = certifiable && … && drift === null && dirtyCount === 0 ? 0 : 1`
那串内联式抽成 `certExitCode(outcome)`，而这三处旧证人钉的是**被搬走的那段文字**。
这正是记忆里那条「搬家类改动必跑所有读被搬文本的判卷」（第 410 页）的第三次现身，
也是同一形状的新变体：**这次不是我忘了跑，是派生表替我跑了**——差别在于代价从「全量认证」降到一趟 65 条派生。

## 2. 补正怎么写的（方向：针脚跟着真源走，两头各查一次）

| 旧断言钉的 | 改成钉的 | 为什么这样分 |
| --- | --- | --- |
| `expect(src).toContain("dirtyCount === 0 && drift === null ? 0 : 1")` | 调用点 `treeDrifted: drift !== null,` ＋ lib 里 `!o.treeDrifted ? 0 : 1` | 判决搬进 lib 后这件事**分两跳**：只查一头就会出现「调用点交得对、真源不认」或反之 |
| `expect(formula).toContain("drift === null")` | `formula` 含 `certExitCode(outcome)` ＋ 新增一块 `outcome` 的取料面**不含 ps 前/后套数** ＋ 保留 `process.exit(code)` | 反向哨兵要守的是「并发不许进判决」。式子没了以后，能进并发的那个口变成 **outcome 那一块**——不把这一面加进来，哨兵就退化成恒真 |
| `line(/const code = certifiable[\s\S]{0,200}&& gateReds\.length === 0/)` | `line(const code = certExitCode(outcome);)` ＋ `line(gateRedCount: gateReds.length,)` ＋ lib 里 `if (o.gateRedCount > 0)` | 同上，门红那一维也分两跳 |

用例标题一个字没改——两根老锚点的 `expectFail` 指着它们（改标题就会当场打成 killer 指针失效）。

## 3. 两根老锚点的针脚搬家

| 锚点 | 旧针脚（已随实现消失） | 新针脚 |
| --- | --- | --- |
| `head-cert-drift-not-in-exit-code` | `dirtyCount === 0 && drift === null ? 0 : 1` | `    treeDrifted: drift !== null,` → `    treeDrifted: false,`（钉**调用点那一跳**） |
| `concurrency-wired-into-exit-code` | 同一串旧式（反向：加 `&& psBefore === 0`） | `const code = certExitCode(outcome);` → `const code = certExitCode(outcome) === 0 && psBefore === 0 ? 0 : 1;` |

本簇新加的 `cert-exit-code-drift-dim-dropped` 钉的是 **lib 那条合取**——与搬了家的那根各红一条，不是重复。
反证：如果两根都还钉同一处文字，`--check-needles` 会报「HEAD 那份里针脚 0 处」而不是安静通过。

## 4. 补正后的读数

`node --import tsx scripts/typecheck.ts` exit 0；
`tests/head-cert-deps.test.ts` ＋ `tests/cert-gate-face.test.ts` ＋ `tests/head-cert-exit-code-cell.test.ts` ＋ `tests/head-cert-provenance.test.ts`
合跑 **166 passed（4 文件）**；`node --check scripts/mutate-verify.mjs` 通过。

归属：`tests/head-cert-deps.test.ts` +11/−2、`tests/cert-gate-face.test.ts` +4/−1 全部是本簇（两文件开工前现读干净）；
`scripts/mutate-verify.mjs` 工作树 +41/−8 里含隔壁 `d13-*` 那 37 行、`PROGRESS.md` +1/−1 是隔壁那处改名 ⇒ 这两处仍走临时 index。
