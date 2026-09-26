# 第 121 页 · 一条写着「禁用一切」的 skill，禁不掉任何一把注入面工具——申报域从 10/23 修成 23/23

复算日期：2026-09-26。这页改的是产品代码（权限面），不是尺：`src/agent/plugins/skills.ts` ＋
`src/agent/plugins/index.ts` ＋判卷 `tests/skill-tool-policy.test.ts`，三支动手前都对 HEAD 干净。
结案的是挂了很久的 **#19**。

## 一、实测（不是照抄立案时的数）

一条 skill 的 frontmatter 写 `disallowed-tools: <整张模型面>`，今天的效果：

```
真进 deny[]（闸收得到）0 条：（空）
落进 unknown（闸根本没收到）13 条：deny:spawn_agent deny:wait_for_agents … deny:automation_list
```

原因是一行：`skillToolPolicy()` 用 `resolveToolName()` 归一申报名，而后者只认静态表 10 把（∪ CC 别名），
注入面 13 把全认不出 ⇒ 进 `unknown` ⇒ **那条 deny 从没进 `deny[]`，活闸根本没收到它**。

**立案时（09-24）记的是 7 把，今天实测 13 把。** 数字涨的原因就是这页的判据：
`INJECTED_TOOLS` 那张表在长（定时五件是第 42 页才登记进去的），而名字归一函数没跟着长。
⇒ **一般形状：一个只覆盖"部分模型面"的名字归一函数，会随表面扩大而静默失去覆盖率**——
表面每加一把工具，就有新的一把落进免疫区，而且没有任何门会红。
（本仓早记过它是这类缺陷的最小签名：「字段收下了、执行端不读」。）

## 二、为什么这不是"等谁裁"而是可以照读数定的

#19 当时留了 A／B 两案，B 的顾虑写的是"扩大第三方插件可压制的面"（政策裁决）。今天量完，这个顾虑**不成立**：

- 插件此刻**已经**能 deny 全部 10 把静态工具，其中含 `run_shell`、`write_file`、`edit_file`、`verify`、
  `read_file`、`glob`、`grep`、`lsp`、`clarify`、`propose_plan`；
- 也就是说一条恶意 skill 现在就能让 agent **不能读文件、不能写文件、不能跑命令、不能自证**——
  这比"禁掉派活/定时"重得多。把 `spawn_agent`、`automation_*` 也纳入 deny **不新增任何一类能力**，
  只是让申报域等于模型面；
- 真正需要守的是**反方向**：`allowed-tools`（放宽向）绝不能跟着扩——那等于插件作者替用户把注入面预批了。
  这一侧原样只认规范名，并专门钉了一条用例（造红 M9 就是打它的）。

所以走 B：修机制，不修账面（`TOOL_NAMES` 一个字节没动，本仓"注入项不进静态注册表"的分类边界保持）。

## 三、改了什么

```ts
// deny 的归一 = 静态表 ∪ 注入面那份唯一清单（不抄第二张表）
export function resolveDeclaredTool(raw: string): string | null {
  const stat = resolveToolName(raw);
  if (stat !== null) return stat;
  return INJECTED_TOOL_NAMES.has(raw.trim()) ? raw.trim() : null;
}
```
- `SkillToolPolicy.deny` 类型从 `ToolName[]` 放宽成 `string[]`，`allow` **仍是** `ToolName[]`；
  不对称写在接口注释里，理由是方向（收紧 vs 放宽）不同。
- 两脸同源不用新做：执行闸（`loop.ts` 的 `skillDenial(name)`）与规格面（`glm-session.ts` 按
  `s.function.name` 比对）本来就按**名字字符串**判 ⇒ 放开归一这一步，规格面与活闸同时接上。
  这条有端到端用例（见下）。
- `unknown` 的告警文案改成说清申报域是哪两张表，否则下一个"认不出"会被当成拼写错误。

**留下一条过期注释没动**：`glm-session.ts:429` 还写着「`remember`/`spawn_agent` 这类不在 ToolName 键域里的
规格根本不可申报」——那句话现在不成立了，但该文件实测 `M`（他人 09-24 起在飞），按规矩不碰，记进工单。

## 四、判据与造红

判卷 `tests/skill-tool-policy.test.ts` 18 → **22 条**，四条各钉一格：

| 用例 | 钉的是 | 造红 |
| --- | --- | --- |
| 静态 10 ＋ 注入 13 全进 deny、`unknown` 必空 | 分面漏一半会"看起来没问题"（旧写法得到 10 条也是绿） | **M8**（注入面退出申报域）⇒ 这条 ＋ 端到端那条一起红 |
| 端到端：模型清单里真少那把、`removed`/`note` 点名 | 「看得见却被拒」的镜像缺陷（f120129 立的同源要求） | 同 M8 |
| 同一名字写进 `allowed-tools` 仍算认不出 | **不对称**：放宽向不跟着扩面 | **M9**（allow 也改用宽归一）⇒ 只红这一条 |
| `spawn_agents`（多一个 s）与 `mcp__foo__bar` 仍落 unknown | 申报域是两张表的并集，不是"任意字符串都收" | — |

两台跑完 `cp` 复原，`grep -c MUTATION-121` ＝ 0、逐字节一致。

**施工期又撞一次自己记过的坑**：`it("…（不是"能看见却被拒"）")` 里嵌了 ASCII 双引号，
文件直接编译不过（本仓已记「Edit 里的双引号会被改写／内层串用「」」）——这次是它第一次在**我自己手写的
测试标题**里命中，而不是在 Edit 的 old_string 里。

## 五、留下的开放项（不是遗漏，是新的量）

M8/M9 之外，量修的过程中发现一条**没实现也没门管**的组合：一条 skill 只 deny `cancel_agents`
而不 deny `spawn_agent` ⇒ 模型还能派活、却撤不掉自己派的。修之前这不会发生（两把都禁不掉），
修之后它是**新可达**的状态。今天不拦，理由：它是收紧向的正常表达，拦它要给"哪些工具不可被摘"的白名单，
那是产品裁决不是 bug 修复。已立案跟这条，且这属于「能撤队」= 能力 4（遇失败能换路）的对面。

## 六、验证

- 探针复算（改前／改后各一次）：`deny[] 0 → 13`、`unknown 13 → 0`。
- `tests/skill-tool-policy.test.ts` **23 passed** exit 0；typecheck exit 0；全量 **229 files / 2602 tests passed，exit 0**（00:31:18 起跑，82.69s）。
- 没有任何测试钉过旧告警文案（`工具名认不出` 全仓只此一处），改文案零牵连。
- **凭证的边界要说出口**：上面四把尺里**没有 `docs-check`**（交这页前没跑）。补跑后真实仓红 1 条
  （`D-8 登记项 replay:prompt-fixed-cost 没有任何文档引用`，exit 1），靶文件是**未跟踪的他人工件**
  （`scripts/replay/prompt-fixed-cost.ts`，mtime 09-26 07:25，不在这页 pathspec 里）⇒ 不属这页的账，第 122 页立案。
- 防复发那条不是"多写一个用例"：它**枚举两张表的现值**（`[...TOOL_NAMES, ...INJECTED_TOOLS]` 每一把都必须可申报），
  所以第 14 把注入工具进来而忘了申报域 ⇒ 当场红；旧写法（手抄 13 个名字）做不到这件事。

## 七、这页自己被第 118 页那把尺抓了一次（闭环真的在转）

全量首跑 **1 failed**，红的是我自己两页前写的那条：`真仓读数必须在帽内`。
尺交出的格子是 `tests/skill-tool-policy.test.ts` 里我新写的一句 `not.toContain("spawn_agent")`——
**裸名字针脚**那一族（第 3 格 > 帽 2）。修法照该族自己的规矩：名字取自上面那张表（`const [probe] = INJECTED`），
不抄第二处字面量 ⇒ 尺不收它，格子消失。改后重跑全量：**229 files / 2602 tests passed，exit 0**。

值得记的是**为什么以前看不见**：那条红按第 118 页之前的口径只数"已提交态"，
而我这两页新增的副本全在**未提交文件**里 ⇒ 旧口径下这一格永远不计账，要等落库那天才炸（而且炸成"水位无故上涨"）。
⇒ 上一轮改的判据位置，下一轮就抓到了真东西——这是本仓"改一行要答得出哪条用例会红"那条纪律的正样本。
