# 离线合成面第一次端到端读数与三笔补正（第 422 页簇，2026-10-08）

## 1. 第一次端到端读数（原文，`SYNTH_EXIT=0`，零 key 零网络）

```text
[loop-eval] 合成面：provider=剧本（fixtures/bench/scripts/synthetic-judge/script.jsonl）⇒ 零 API key、零网络；这一趟读数标「合成」，不进任何基准分母
[loop-eval] 判卷器自校：必绿仓→ok ✅ 必红仓→不 ok ✅
[loop-eval] S1-synthetic-named-sets rep1 PASS 起点=红 读先于写=1 clarify=0 先批后写=N verify=1→true 闸拍=0 返修=一次绿 隐藏=无面 逐名=逐名全绿 提供者=剧本 工具=3/0败 重复=0 请求=0 拨数=1 tok=0/0 价不可知 1s 内存峰=161MB/3进程 cpu=479ms
[loop-eval] 逐名那一格：全绿 1／有红 0／读不出 0（有规格 1 趟／无规格 0 趟）
```

`readings.json` 里那一格的结构化脸（`rows[0].r`）：

```json
{"providerFace":"剧本","verifyOkLast":true,
 "namedSets":{"state":"pass","notGreen":[],"broken":[],"unmatched":[],"reasons":[],
   "sources":[{"command":"pnpm_config_verify_deps_before_run=false pnpm run test",
               "format":"node-test-tap","tests":3,"carried":true,"complete":true}]}}
```

换第二副剧本（`script-broken-p2p.jsonl`：门槛改对、基础运费 600→500）同一格：

```json
{"state":"fail","notGreen":[],"broken":["券后价不为负且总价含运费"],"verifyOkLast":false}
```

⇒ 这一对就是这一簇买来的分辨力：**同一枚非零退出码，一句「是哪条、哪一种坏」只有逐名这格说得出**。
靶子起点态现读（`node --test` 管道下自出 TAP，`parseTestResults` 报 `format=node-test-tap`、`complete=true`）：
`券后过线免运费=failed`、`原价未过线收运费=passed`、`券后价不为负且总价含运费=passed`。
第二条剧本故意**不**弄坏「原价未过线收运费」——它断言的是 import 进来的常量本身，改常量不动它；读数只报真坏的那条，不替剧本编故事。

## 2. 三笔补正（都在同一簇里，各自独立落库）

| 笔 | 抓到的东西 | 发现位 |
| --- | --- | --- |
| `49f011c` | 三根锚点又插进**第二张数组**：上一次构造把 MUTATIONS 的收尾粘成 `  },];`，于是「起点之后第一个 `^];`」跳到后面那张表；而自检用同一个 slice 数「多三根」，永远确认错的位置 | 干净树 `--list` 只有 1485 条且逐名报 `未知 id`（`--check-needles` 反而「阻断 0」——它只读整份文件的字面） |
| `665d3ad` | 新增那份清单把 `tests/bench-corpus-parity.test.ts` 顶红 6 条（语料↔清单↔README 三向配平；README 五处条数与两份表都没跟上） | `head-cert` 的全量：`7 failed`（其中 6 条在这一把尺里） |
| 判卷文件名写错 | 我把 `tests/assertion-health-scan.test.ts` 写成 `tests/assertion-health.test.ts`，vitest 因「没有测试文件」退 1 被我当成跑过 | 现读 `ls tests` 纠名后重跑：`17 passed` |

锚点实跑（`verify-c0bf1f5`，0 项在飞）：补正后三根逐条 ✅、末行「全部变异被正确杀死」、`MV_EXIT=0`；
干净树 `--list` 条数 1488（＝1476 起 ＋ 本会话 12 根），三根逐名命中 3/3。

## 3. 认证读数

- `49f011c`（补正一之后、README 之前）：`认证门面=23 道｜绿 23｜超预算 0`，但 `Tests 7 failed | 4855 passed (4862)`——那 6 条是 README 配平，见 §2 第二行；原文在 `outputs/head-cert-49f011c-2026-10-07-1948/provenance.md`。
- `665d3ad`（本簇最后一笔）：`Test Files 1 failed | 344 passed (345)｜Tests 1 failed | 4861 passed (4862)｜exit=1`，唯一那条红是第 413 页登记过的常驻红；原文在 `outputs/head-cert-665d3ad-2026-10-07-1957/provenance.md`。
