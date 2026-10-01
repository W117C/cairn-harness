# `fixtures/bench/` —— 固定任务集（能力 10 的靶子）

这套靶子回答一个问题：**「这次改动到底有没有让 agent 变好？」**

配套两只尺：

```sh
pnpm bench          # 拿真模型跑这套任务，出 → outputs/bench/readings.json
pnpm eval-report    # 把两次读数对起来，判"改动是否超出噪声带"
```

---

## 为什么是 12 条、四类

单次读数什么都证明不了。**同一配置跑两次本来就有差**，那个差叫噪声带；
改动幅度落在噪声带里 ⇒ 判不出好坏。所以任务集要**够多、够分散**，
让"成功率"这个数有分母，让 token/耗时能看出方向。

| 类别 | 条数 | 考什么 |
|---|---|---|
| 跨文件 bug 修复 | 4（B1 / B4 / B5） | 从失败现象回溯到根因；根因常在共享模块，改动要落到对的地方 |
| 加功能 | 4（B2 / B6 / B7 / B8） | 按规格实现；规格藏在测试与 README 里，不是一句话 |
| 重构 / 改调用点 | 4（B3 / B9 / B10 / B11） | 改名、抽共享、换签名——**必须把调用点一起改**，漏一处就红 |
| 长任务 | 1（B12） | 20 个**互不相关**的 bug，无共同根因，逼出 ≥20 轮真实推进 |

> 条数是奇数（12 条里的 4/4/4/1）不是问题：这里要的是**分母够大**，不是每类等分。

---

## 12 条逐条

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

**判卷命令统一是 `node --test tests/*.test.js`**（node 内置测试器）：
不联网、不装依赖、不受宿主包管理器影响 ⇒ 判得准，也**跑得动**。

---

## 三条纪律（改这套靶子时必须守）

1. **种子必须开跑即红。** 种子全绿的任务证明不了任何事——它只会把成功率刷成 100%。
   加任务时请把 `node --test` 的 pass/fail 计数贴进上表。
2. **不判卷"实现方式"。** 判的是行为（测试断言），不是"必须用某个函数"——
   否则会把一种正确解法判成错，那是假红。
3. **不联网、不依赖外部包。** 靶子自包含，`npm test` 在任何机器上同形。

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
- **真模型跑有成本**：每轮 12 条会烧真 token。改完先 `--only` 冒烟，再全量。
- **任务集换了就不能横比**：`eval-report` 会检查任务 id 集合，不一致直接把结论标为作废（分母变了）。
