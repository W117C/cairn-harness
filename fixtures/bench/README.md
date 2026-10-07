# `fixtures/bench/` —— 固定任务集（能力 10 的靶子）

这套靶子回答一个问题：**「这次改动到底有没有让 agent 变好？」**

配套两只尺：

```sh
pnpm bench          # 拿真模型跑这套任务，出 → outputs/bench/readings.json
pnpm eval-report    # 把两次读数对起来，判"改动是否超出噪声带"
```

---

## 为什么是 16 条、五类

单次读数什么都证明不了。**同一配置跑两次本来就有差**，那个差叫噪声带；
改动幅度落在噪声带里 ⇒ 判不出好坏。所以任务集要**够多、够分散**，
让"成功率"这个数有分母，让 token/耗时能看出方向。

| 类别 | 条数 | 考什么 |
|---|---|---|
| 跨文件 bug 修复 | 3（B1 / B4 / B5） | 从失败现象回溯到根因；根因常在共享模块，改动要落到对的地方 |
| 加功能 | 4（B2 / B6 / B7 / B8） | 按规格实现；规格藏在测试与 README 里，不是一句话 |
| 重构 / 改调用点 | 4（B3 / B9 / B10 / B11） | 改名、抽共享、换签名——**必须把调用点一起改**，漏一处就红 |
| 长任务 | 4（B12 / L30 / L32 / L48） | 没有共同根因、只靠"持续推进"才过得完：20／30 个互不相关的 bug，32／48 级顺序流水线 |
| 离线合成 | 1（S1） | 不烧钱的那一格：剧本 provider 把「该转绿的没绿／该保住的坏了」两列判卷跑成读数（第 422 页） |

> 条数不是均分（16 条里 3/4/4/4/1）也不是问题：这里要的是**分母够大**，不是每类等分。

---

## 16 条逐条

| id | 种子（`seed.path`） | 种子态（tests/pass/fail） | 靶心 |
|---|---|---|---|
| `B1-bugfix-crossfile` | `bench-bugfix-crossfile` | 3 / 2 / 1 | 券后金额跌破包邮线仍免运费；金额一律用整数「分」 |
| `B2-feature-export` | `bench-feature-export` | 1 / 0 / 1 | 实现尚不存在的 `joinFitted`（多段折行 + 空行分隔） |
| `B3-refactor-callsite` | `bench-refactor-callsite` | 4 / 0 / 4 | 共享 `money()` 不补两位小数，且**有遗留代码绕过封装** |
| `B4-bugfix-pagination` | `bench-bugfix-pagination` | 5 / 3 / 2 | 分页少一条（闭区间被写成半开）；API 层要一起对 |
| `B5-bugfix-async` | `bench-bugfix-async` | 3 / 1 / 2 | 队列没等异步任务跑完就返回 |
| `B6-feature-flag` | `bench-feature-flag` | 4 / 1 / 3 | 加 `--verbose` 开关，且解析结果要能喂给 logger |
| `B7-feature-csv` | `bench-feature-csv` | 5 / 1 / 4 | 补 RFC 4180 转义（含逗号/引号/换行的字段） |
| `B8-feature-memo` | `bench-feature-memo` | 3 / 2 / 1 | 加记忆化：同 id 只真取一次，`resetCache()` 能重置 |
| `B9-refactor-rename` | `bench-refactor-rename` | 3 / 1 / 2 | `getUser` → `fetchUser`，**三个调用点**跟着改，旧名不留 |
| `B10-refactor-dedupe` | `bench-refactor-dedupe` | 3 / 1 / 2 | 两份校验漂了（一份忘 trim、一份忘小写），抽成一份 |
| `B11-refactor-signature` | `bench-refactor-signature` | 2 / 1 / 1 | 位置参数改选项对象，**三个调用点**跟着改 |
| `B12-long-horizon` | `bench-long-horizon` | 20 / 0 / 20 | 20 个独立 bug，逐个修 |
| `L30-long-horizon` | `bench-long-horizon-30` | 30 / 0 / 30 | B12 的加长版：30 个互不相关的小工具各埋一处 bug，还是没有共同根因 |
| `L32-long-chain` | `bench-long-chain-32` | 1 / 0 / 1 | 32 级流水线 `src/s01.js … src/s32.js` 顺序相接；判卷只有一条用例且**遇第一个错级即停**⇒ 改一级才露下一级 |
| `L48-long-chain` | `bench-long-chain-48` | 1 / 0 / 1 | 同上拉到 48 级，把"推进轮数"这一维再压一档 |
| `S1-synthetic-named-sets` | `bench-synthetic-judge` | 3 / 2 / 1 | 逐名判卷那条链的**离线靶子**：门槛写成严格大于 ⇒ 一条红；剧本 provider 只改 `src/` ⇒ 全绿。零 key、零网络（`--scripted`，见 `scripts/synthetic-judge/`） |

清单五份：`tasks.json`（12 条，B1–B12）＋ `tasks-long30.json`／`tasks-chain32.json`／`tasks-chain48.json`／`tasks-synthetic.json`（各 1 条）＝合计 16 条，与盘上 16 个 `bench-*` 目录双向配平（无悬空、无孤儿）。
上表的行数、id、种子目录名与这里的四份清单名都由 `tests/bench-corpus-parity.test.ts` 现读盘比对——它不联网、不跑真模型。
三条长任务靶子入于 2026-10-02，比本文件上一笔改动晚 3 天而一直没被喊：`scripts/docs-check.ts` 的文档面只吃 `docs/**` 与三个根文件，**不含 `fixtures/**`**。
`L32`／`L48` 的判卷是 `node tests/run.mjs`（紧接下面那句"判卷命令统一是"管不到这两条），`B12`／`L30` 才是 `node --test tests/*.test.js`。

**判卷命令统一是 `node --test tests/*.test.js`**（node 内置测试器）：
不联网、不装依赖、不受宿主包管理器影响 ⇒ 判得准，也**跑得动**。

---

## 四条纪律（改这套靶子时必须守）

1. **种子必须开跑即红。** 种子全绿的任务证明不了任何事——它只会把成功率刷成 100%。
   加任务时请把 `node --test` 的 pass/fail 计数贴进上表。
2. **`expects` 必须带 `judgeUntouched`。** 这 16 条的判卷面就是 `tests/`，
   而"改测试把红改绿"是**最容易拿到的假绿灯**。
   实测（2026-10-01）：第一版没写这条，12 条里 **5 条改过判卷面且全部判 PASS**；
   补上之后同一批任务的成功率从 **11/12 掉到 9/12**——掉下去的那两条不是能力退化，
   是**原来的绿灯本来就是假的**。
3. **不判卷"实现方式"。** 判的是行为（测试断言），不是"必须用某个函数"——
   否则会把一种正确解法判成错，那是假红。
4. **不联网、不依赖外部包。** 靶子自包含，`npm test` 在任何机器上同形。

---

## 跑法与读数

```sh
# 冒烟：只跑一两条（改完某个子系统时）
pnpm bench -- --only B12-long-horizon

# 看分布：同配置多跑几轮（判改动效果必须用这个）
pnpm bench -- --reps 3

# 对账：至少两份同配置基线 + 一份改动后读数
pnpm eval-report --baseline outputs/bench-a/readings.json \
                 --baseline outputs/bench-b/readings.json \
                 --candidate outputs/bench-after/readings.json
```

`eval-report` 会告诉你：每项指标的差值、噪声带、以及**这次改动是否真超出噪声**。
**噪声带不可得时它会明说"判不出"**——不会假装通过。

### 诚实标注

- **两点噪声带是弱证据**：它只能挡住"改动幅度比机器抖动还小"这种假改善。
  要下结论请提高 `--reps`，并把同一配置的多份读数都喂给 `--baseline`。
- **真模型跑有成本**：全套 16 条里除了 `tasks-synthetic.json` 那 1 条（离线合成面，`--scripted` 喂剧本、零 key 零网络），其余都会烧真 token。改完先 `--only` 冒烟，再全量。
- **一键只喂到一份清单**：`package.json` 的 `bench` 写死 `--tasks fixtures/bench/tasks.json`，而
  `scripts/loop-eval.ts` 的 `pick()` 取**首个** `--tasks` ⇒ 命令行追加无效。
  **2026-10-05 已修（#63c），两半都收口**：
  ① 三份长清单各有了消费者——`bench:long30`／`bench:chain32`／`bench:chain48`
  （`max-steps` 分别 35／40／55，按链路长度给，不必手动传）；
  ② 重复给 `--tasks` 现在**出声并拒绝出数**（exit 2），不再静默只听第一份。
  判卷 `tests/bench-task-consumers.test.ts`（脚本↔清单双向配平 ＋ 真起进程判守卫）。
- **任务集换了就不能横比**：`eval-report` 会检查任务 id 集合，不一致直接把结论标为作废（分母变了）。
