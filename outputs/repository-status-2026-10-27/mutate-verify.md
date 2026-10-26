# 全表变异认证 · rev fc056d0

- 测量提交：`fc056d03915c9ad3a1568973fb7e87b92ef6517e`
- 测量时间：2026-10-27 00:48:42 至 01:24:27（Asia/Shanghai；由命令起止时间与实测时长核对）
- 命令：`pnpm mutate-verify`
- 隔离树：`.worktrees/gate-mutate-verify @ fc056d0`
- 预算：未设置 `--budget-ms`；运行由外层会话全程保留，未被中途杀死
- 结果：exit 0，1621/1621 条变异全部被正确杀死
- 实测时长：2145.4 s
- 判卷成本：`判卷 spawn 3242 次／1621 条（每条次数分布 2×1621）`
- 结论：全表变异断言均能区分目标行为；不是只跑受影响锚点，也不是静针脚体检

## 命令原文

```text
$ node --import tsx scripts/mutate-verify.mjs --in-worktree=.worktrees/gate-mutate-verify
[mutate-verify] worktree add exit=0：.worktrees/gate-mutate-verify @ fc056d0
[mutate-verify] cp -al node_modules exit=0
[mutate-verify] cp -al apps/desktop/node_modules exit=0
[mutate-verify] 锁=本进程持有（/Users/ze/Downloads/Cairn/cairn/.git/dsh-tool-locks/mutate-verify-gate-mutate-verify.lock）
变异验证：1621 条
...
全部变异被正确杀死（断言非恒真）
[mutate-verify] 本次耗时 2145.4s · 跑了 1621/1621 条 · 未设预算（外层超时会在中途杀我，见 --budget-ms）
成本分母：判卷 spawn 3242 次／1621 条（每条次数分布 2×1621）· 单次中位 第1次 0.5s／第2次 0.5s· 最贵一条 orchestrator-project-rules-not-passed 32.2s
跑法单价：selector 3224 拍·中位 0.47s·坏拍（选中≠1） 0 vs whole 18 拍·中位 0.51s·坏拍（没量到或 0 条） 0
锁=本进程持有（/Users/ze/Downloads/Cairn/cairn/.git/dsh-tool-locks/mutate-verify-gate-mutate-verify.lock）
```

## 边界

- 该结果证明 `fc056d0` 的变异表判卷有效，不证明真实 DeepSeek 请求、真实外部用户流程、
  打包发布、跨机器性能长尾或生产计费。
- `mutate-needles-check` 只做静态针脚体检，不能替代这份全表实跑；本页记录的是后者。
- 认证树在跑完后保持 detached、干净；主工作树中的文档改动不属于该提交的变异测量面。
