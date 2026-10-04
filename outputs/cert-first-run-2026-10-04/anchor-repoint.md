# 三条锚点的改指（备料；落不了库，因为 `scripts/mutate-verify.mjs` 在隔壁手里）

出处：10-04 认证第一趟 `mutate-needles-check` 的 3 条阻断（原文见 `needles-at-head.txt`），
三条全指 `src/agent/plugins/skills.ts`，全是第 370 页（`3dff65c1`）把实现改了形状、**锚点没跟着走**留下的空操作。
门给的话就是那句「针脚已不在源文件里（变异必然不生效——多半是被锚定的实现搬走了，改指它）」。

## 为什么这一格必须有人管

锚点空操作不是"少了一条覆盖"那么轻：它绿的时候**没人知道它没跑**。第 370 页我落的是
「超预算不再整条丢 ⇒ 降级成只列名字」这套新语义，而这三条锚点原本守的正是这条路径上的三个静默失效
（标记里少数字／`dropped` 算成反数／清单不做 `modelInvocable` 过滤）。现在它们一条都杀不动，
等于这一格的守卫从"有"变成"看起来有"。

## 改指内容（三对，逐字来自现读；`expectFail` 一字不改）

| 锚点 id | 表里的位置（HEAD 行号） | 旧 `apply` 第一参（盘上已无） | 新 `apply` 第一参 ⇒ 第二参 |
| --- | --- | --- | --- |
| `routing-truncation-marker-hides-count` | `:550` | `" 字符，已截断：另有 \" + String(dropped) + \" 条未列出]"` | `'if (dropped > 0) parts.push("另有 " + String(dropped) + " 条未列出");'` ⇒ `'if (dropped > 0) parts.push("条目未全列出");'` |
| `routing-dropped-counts-listed-not-missing` | `:558` | `"  const dropped = lines.length - kept;"` | `"  const droppedCount = Math.max(0, total - listed);"` ⇒ `"  const droppedCount = listed;"` |
| `skill-routing-ignores-disable-model-invocation` | `:3182` | `"  const lines = [...skills.filter(modelInvocable).map(skillRoutingLine), ...extraLines];"` | `"  const invocable = skills.filter(modelInvocable);"` ⇒ `"  const invocable = skills;"` |

三条的语义变异方向与原来同向（第一条＝标记还在但数字没了；第二条＝`dropped` 从"没列出的条数"翻成
"列出的条数"；第三条＝不做可触发过滤），所以期望变红的用例标题（`expectFail`）不需要改：
前两条仍是 `tests/plugin-role-discoverability.test.ts` 的
「超限 ⇒ dropped 恰等于没列出的条目数（两处取法互查），且标记里的数字与它一致」，
第三条仍是 `tests/skill-invocation-faces.test.ts` 的
「disable-model-invocation 的 skill 不进清单；不声明的照常进（布尔与字符串两种写法同效）」。

## 已经当场验过的两格（`probe-anchor-repoint.mts` ⇒ `anchor-repoint-readings.txt`）

- 三个新针脚第一参在 `src/agent/plugins/skills.ts` 的现读文本上**逐字命中且各只命中 1 次**
  （命中 2 次的话 `replace` 只改第一处，得人工复认改到的是哪一处）；
- 三个改法产出的源文件**语法合法**——检查形状直接照抄门里那把尺（`mutate-verify.mjs` 的
  `mutantSyntaxProblem`：`ts.transpileModule` + `reportDiagnostics`），不是我自己另发明一套；
- 三条 `产出变了=true`（防"改法是个空操作"那种恒绿）。

## 没做的两件事，以及为什么

1. **没在干净树把这三条真跑一遍杀变异**。`mutate-verify.mjs` 盘上是隔壁的 M0→CAIRN 在飞版
   （现读 `8 insertions/8 deletions`，命中 3008/3824/6238/7495/13148 五处），我的三处在 546/554/3178
   不同行 ⇒ 贴上不该冲突，但**跑表会改源文件**，我不能拿别人的在飞表去跑；而 `entryDisposition`
   对"被测面在飞"给的是 `refused`，那一条此刻量不出东西。等它落库：贴针脚 ⇒ 干净树逐条杀 ⇒ 与判卷同笔。
2. **没顺手把锚点数量往上加**。这一格要的是把三条空操作恢复成有效，不是新开战场。
