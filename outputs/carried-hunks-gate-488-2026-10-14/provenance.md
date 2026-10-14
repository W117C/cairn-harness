# 第 488 页取料：夹带判据（第 487 页事故欠的那道门）

出证 2026-10-14；HEAD `ff4c6c6b`。

## 1. 这一格防的是什么

第 487 页事故：`git add <file>` 提的是**整个文件**。多会话共用一个工作树时，那个文件常带着
**别人没提交的 hunk**。我把隔壁会话 42 行 `turnDelivery` 测试连进 commit，而配套源码还在脏状态
⇒ HEAD 上出现「入库的测试 import 一个 HEAD 里不存在的函数」，`desktop-test` 在 HEAD 必红。
`pnpm gates` 量工作树、脏源码正好补上 ⇒ 本地全绿。只有 HEAD 口径的 `head-cert-check` 抓得到。

当时立的账：「这条还没有机器判据」。本页交这笔账。

## 2. 第一版判据是错的（它骗过了我自己）

用「落库行数 ≥ 暂存前行数 × 2」。我的"事故复现"用例当场红：

```
359 >= 271*2 = false
```

那次文件从 271 行到 359 行只有 1.3 倍，而其中 42 行是别人的。**绝对行数天生带着文件自己的
历史，量不出「这一笔夹带了多少」。**

## 3. 改成增量比

判据：未声明文件的新增行数 ≥ 我声明那批新增之和 × 2（`CARRIED_DELTA_RATIO`）。

用事故那笔的真实 numstat 端到端跑通：

```
输入：declared=[scripts/mutate-verify.mjs]
      scripts/mutate-verify.mjs            +16
      apps/desktop/tests/projections.test.ts +88
输出：❌ carriedForeignHunks — 575a293c 夹带了未声明文件的改动：
      apps/desktop/tests/projections.test.ts（这一笔给它 +88 行，而我声明的那批只 +16 行）
      ⇒ blocking=true
```

**教训：判据要能复现它要防的那次真事故，否则它只是在防一个我想象中的事故。**

## 4. 不假装量过

不给 `--declared` 时明说「没有对照基准，本轮只出声不判」——多会话共用一个 git 身份，
author 分辨不出是谁的笔，基准只能由人显式给。

## 5. 读数

- 判卷 `tests/commit-surface-check.test.ts` **55 条**（＋8），含三条防恒真：
  「不到 2 倍不响」「没基准不判」「声明过的不点名」；
- 新锚点 `carried-hunks-ratio-blind`：把 `CARRIED_DELTA_RATIO` 从 2 磨成 200 ⇒ **4 条红**；
- needles 1561 → **1562**｜阻断 0；typecheck 0 报错；
- `run.log`：本笔自己不触发（两个文件都声明了），落库面对账 100% 一致。

## 6. 仍未证（不许读成绿）

① 这一格**要人传 `--declared` 才判** ⇒ 挡得住"我知道该声明什么"的我，挡不住"我根本没想到
要声明"的我。前者是机制，后者仍是纪律。② 它判的是**行数量级**，不是语义：别人只加 3 行但那是
关键 3 行时它不响。③ 本轮改动后全表未重跑。④ 真模型/生产行为未跑。
