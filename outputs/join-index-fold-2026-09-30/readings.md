# 第 218 页 · #41 折层的 A/B 自证（2026-09-30）

同一份取料面、两份代码，各跑一次 `replay:gate-outcomes`：

```bash
# 旧代码（HEAD=`70eab48` 的认证树里那份，cwd 固定在主树 ⇒ 两侧吃同一批 jsonl）
node --import tsx .worktrees/head-cert-70eab48/scripts/replay/gate-outcomes.ts
# 新代码（折进取料层 `callNameIndex` 之后）
node --import tsx scripts/replay/gate-outcomes.ts
```

两侧输出**逐字相同**（`diff` 退出码 0），退出码也都是 1（那格本来就是 §5 之前的「不可测」）：

```
受管 tool_result=98 · 带 gate 留痕=0 ⇒ **不可测**：这批会话早于 gate 留痕落流（§5），…
```

⇒ 「搬层没换口径」不是叙述，是这一对字节等式（规则 262 的接线证人形状：让读数自己对账，不钉措辞）。
