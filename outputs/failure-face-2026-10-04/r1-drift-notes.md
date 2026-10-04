# `#71` 的两格取证（写在这里，是因为页上不能写那个全路径）

## 1. 冻结样本与一条 base 档轨迹是同一条跑

证人（盘上取料，两条都在本仓）：

- 冻结面：`fixtures/no-progress/real-red-verify-stagnation.events.jsonl`
- 留档面：`outputs/loop-eval-2026-09-20-base/I2-rep1-base.events.jsonl`

实测 `cmp` 那两条：**退 0，各 332 行逐字相同**（不是「像同一条」，是同一条流的两份字节）。
对齐读数（同一支探针 `no-progress-drift.mts` 的逐事件面）：`verify_result` 落在下标 **72** 与 **248**；
两次红之间唯一那次真写盘落在 **245**：

```
printf 'verify-deps-before-run=false\n' > .npmrc && cat .npmrc
```

⇒ `scripts/no-progress-check.ts:39` 那条 note 说的「中间只有 run_shell 没有写入」把 shell 重定向数漏了；
生产口径（`src/agent/loop.ts:565-568` 用 `mayHaveWrittenDisk`）不认为这条是停滞。

## 2. 为什么页上不给这个路径

`scripts/docs-check.ts` 的 D-11 取「页点名的 dated 目录」时，把日期之后的后缀**截断**：
写成 `outputs/loop-eval-2026-09-20-base/...` 会被读成 `outputs/loop-eval-2026-09-20/`——
一个盘上不存在、台账里也无人点名的目录 ⇒ 报一条**提交也归零不了**的红（本页初版实测：三条 D-11 里
只有这一条不属于「本笔未提交工件」那一类）。修法在 `docs-check.ts` 那边（边界应取到下一个 `/`），
而那个文件现在在隔壁手里（47 插在飞）⇒ 记进 `#61` 的第四个形状，本页先用「证人挪进工件、页上只留
可解析的引用」绕开，不动被度量者也不动判卷。
