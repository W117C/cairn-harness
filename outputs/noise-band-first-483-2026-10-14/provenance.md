++
# 第 483 页取料：噪声带第一次真的算出来（路线图第 2 波动作一/二/三）

出证 2026-10-14；工作树 `/Users/ze/Downloads/Cairn/deepseek harness`，HEAD `4d2bff3e`。

## 1. 这一格此前为什么空着

`docs/development-plan-2026-10-12.md` 第 2 波动作一写着：「盘上现存 20 份读数一份都盖不了章，
所以今天连『这个改动大不大』都问不出来」。实测确实如此：`outputs/` 下 20 来份读数里，
`bench-head-d0ffe15e-a/b`（12 行）**一个身份键都没有**（`headSha`/`ranAt`/`arm`/`reps` 全缺）
⇒ 喂进 comparator 只会被身份闸咬住（出口码 3）。

真正带章的同配置对在 `outputs/bench-b12-before-477-2026-10-13/`：`readings-run1.json` 与
`readings-run2.json`，两趟同为 `headSha=1547c364d7f217d429f2b4ca0e5a2459a9ff3c58`、
`model=cn:hy3`、`maxSteps=40`、`reps=1`、`arm=base`、`providerFace=真会话`，
只差 `ranAt`（13:05:41Z ↔ 13:08:03Z）。这正是噪声带要求的「同配置两次」。

## 2. 三个验收判据逐个实测

**① 两份带章的同配置读数 ⇒ 身份闸不咬（出口码 0 / 4，不再是 3）**

`self-compare.log`：用 run1 同时当基线与候选（自比，改动量为 0）。

- 身份面：✅ 三个身份键齐（共 3 行）；
- 配对：同面 2 趟 ⇒ 逐靶比较 1 个共同靶，flips 0；
- 噪声带来源：run1 ↔ run2（同配置两次）——**这一行此前在盘上从未出现过**；
- 结论：所有指标都在噪声带内 ⇒「这次改动没有可观测效果」；
- **出口码 0**（不是 3）。

拿到的第一个真实噪声带（B12 单靶、`cn:hy3`、40 步帽）：

| 指标 | 两次差（＝噪声带） |
|---|---|
| 成功率 / 达标数 | 0.0% / 0 |
| 输入 token | 44,347 |
| 输出 token | 1,204 |
| 墙钟(秒) | 16.9 |
| 内存峰(MB) | 6 |

两点样本是弱证据（报告自己也这么说），所以这个带只能当**第一个**读数，不能当抖动底定论。

**② 故意退化的 fixture ⇒ comparator 判「越出」**

`degraded-gate.log`：把基线两份弄成全绿、候选弄成全红（同面、同任务集）。

- 成功率 100.0% ⇒ 0.0%（差 −100.0%，带 0.0%）⇒ **⚠退化**；达标数 1 ⇒ 0 ⇒ ⚠退化；
- 成本类同时「变好」（输入 token −22,173、墙钟 −8.5s）却**不许**印成改善；
- 印出 `⇒ 本表禁止读作改善；成本类超带只是副作用`；
- **出口码 4**（合取闸咬）。

反向格同批验过：三份同配置全绿 ⇒ 出口码 0 且**不印**禁止改善那句（`tests/eval-report.test.ts`
里那条「三份同配置全过 ⇒ 出口码 0」就是防闸写反的）。

**③ 两道闸各有针脚钉住**

身份闸此前已有锚点（`exit-code-identity-branch-dropped`、`eval-run-identity-keys-rehardcoded`、
`eval-provider-face-not-in-pair-keys`、`model-face-*` 四条）。合取闸 `outcomeGate`
此前**一条都没有**——`scripts/eval/report.ts` 那 7 条锚点全部打在归因面与身份闸上。
⇒ 本页补 `outcome-gate-conjunction-dropped`：把 `const blocked = degraded.length > 0;`
换成 `false && …`（闸恒放行）。

实测（干净 worktree，`HEAD=4d2bff3e`）：**✅ 全部变异被正确杀死**，0.8s／2 拍。
`--check-needles` 1557 → **1558 条**，阻断 0。

## 3. 读数

- 噪声带自比：出口码 0、所有指标带内（`self-compare.log`）；
- 故意退化：出口码 4、禁止改善那句印出（`degraded-gate.log`）；
- 新锚点在干净 worktree 里杀死；needles 1558 条｜阻断 0；
- typecheck 0 报错。

## 4. 仍未证（不许读成绿）

① 噪声带是**两点**样本，只能当第一个读数，不能当抖动底——路线图自己要求提高 `--reps` 再下结论，
   而 `--reps` 那条路因免费档日配额（1000 次/天）此刻走不通（第 2 波原文已登记）；
② 这一页没有跑任何真模型请求，用的全是既有读数；
③ `outcomeGate` 的锚点只验了「恒放行」这一种改坏方向，没验「恒拦截」（后者由判卷里
   「三份同配置全过 ⇒ 出口码 0」那条兜着，但它不是变异锚点）；
④ `mutate-verify` 全表未因这一笔重跑（1558 条 ≈ 20+ 分钟），只单独跑了新加那一条。
