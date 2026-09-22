# deny 被「git 全局选项」静默绕过：下游选项族（2026-09-22）

> **结论先行**：用户手写的 `deny run_shell "git push --force"`，在**五支**真实写法下完全不生效，
> 自主档实测 `approve@L4-pass`——命令会直接被执行。根因与 09-21 收口的那族（包装器在二进制**上游**）不同：
> 这一族的选项插在**二进制与子命令之间**，而规则匹配是**前缀匹配**，于是看不见子命令。
> 已修（`commandForms` 增「下游选项归一」后缀形），修后探针 **红 0 / 绿 42**。基线 HEAD `3162258`。

## 复现与读数（修前，逐支实测）

```sh
pnpm exec tsx scripts/probe-shell-bypass.ts        # ⑤ 段，修前红 5
```

| 命令 | 期望 | 修前实测 | worker 静态闸 |
|---|---|---|---|
| `git push --force` | deny@L1-deny | deny@L1-deny ✓ | 拦 |
| `git -C /tmp push --force` | deny@L1-deny | **approve@L4-pass** | 拦 |
| `git --no-pager push --force` | deny@L1-deny | **approve@L4-pass** | 拦 |
| `git -c advice.pushUpdateRejected=false push --force` | deny@L1-deny | **approve@L4-pass** | 拦 |
| `git --git-dir=/x push --force` | deny@L1-deny | **approve@L4-pass** | 拦 |
| `git -C/x push --force` | deny@L1-deny | **approve@L4-pass** | 拦 |

**为什么只有主会话这条路漏**：worker 的 `interceptDestructiveGit` 取 `args[0]` 当子命令，
`-C` / `--no-pager` 不在只读白名单里 ⇒ **fail-closed 侥幸拦住了**（代价是 reason 说成 `git -C 被拦截`，
读起来怪但不失守）。规则层是前缀匹配，没有这层 fail-closed 兜着，所以静默放行。

## 修法（`src/permissions/command-shape.ts`）

`commandForms` 过去对每个 invocation 只产一形（`bin + 全部 args`，即「剥掉上游包装器」）。
现在额外产**后缀形**：从每个**非选项**参数位置各起一形，于是
`git -C /tmp push --force` 也产出一支 `git push --force`。

```ts
function suffixForms(inv: Invocation): string[] {
  const out: string[] = [];
  if (EXEC_WRAPPERS.has(inv.bin)) return out;   // 只给「真命令」那一支生成
  for (let i = 1; i < inv.args.length; i++) {
    if (inv.args[i]!.startsWith("-")) continue; // 选项本身不冒充子命令
    out.push([inv.bin, ...inv.args.slice(i)].join(" ")…);
  }
  return out;
}
```

三条边界，都是钉住过的（不是想当然）：

1. **只作用于 deny/ask**：allow 仍只认原形。`allow run_shell "git status"` 配
   `git -C /tmp status` 实测 `judgeChain = miss` ⇒ 不替用户扩大同意面（这条不对称是 09-21 定的）。
2. **包装器那一支不产假形**：`sudo -u root git status` 曾多产 `sudo git status` / `sudo root git status`
   两支——被既有负控「只读 git 只产它自己那一形（多余候选=审批卡变多）」当场抓红。
   过覆盖与漏判方向相反，但同样是代价，所以它也得有界。
3. **过覆盖的残留形状**：`git log --format=%h push` 会产出一支 `git push` ⇒ 用户 deny「git push」时
   这条只读命令会被拦。取舍：**多一张卡 < deny 白写**；本族无按二进制区分的选项表，
   要消掉它就得给每个二进制建选项规范（成本另账）。

## 本轮刻意不修的一支（另记一账）

`git push -f` 同样 `approve` —— 这不是「形态」问题而是**标志别名**问题（`-f` ≡ `--force`），
需要按二进制的别名表，不属于包装器/位置归一能覆盖的形状。
探针 ⑤″ 段把它打印出来但不计入红绿（避免一条永远红、无人分辨的断言——本仓 09-21 栽过一次）。

## 锚点与复算

```sh
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts \
  tests/command-shape.test.ts tests/shell-bypass-composition.test.ts tests/permissions.test.ts
TERM=dumb node --import tsx scripts/mutate-verify.mjs \
  shape-downstream-option-forms-lost shape-suffix-forms-also-for-wrappers
```

| 锚点 | 改什么 | 必红的那条 |
|---|---|---|
| `shape-downstream-option-forms-lost` | 去掉后缀形生成 | 「五支写法在自主档全由 L1-deny 拦下」 |
| `shape-suffix-forms-also-for-wrappers` | 去掉包装器豁免 | 「包装器那一支不产假形」负控 |

## 本轮改动清单

- `scripts/lib/shell-bypass-cases.ts`：`GLOBAL_OPT_VARIANTS`（5）+ `GLOBAL_OPT_MUST_STAY_CLEAN`（4）+ `FLAG_ALIAS_CASE`
- `scripts/probe-shell-bypass.ts`：新增 ⑤ / ⑤′ 负控 / ⑤″ 只记录段
- `src/permissions/command-shape.ts`：`suffixForms` + `commandForms` 接上
- `tests/command-shape.test.ts`：+4 条（29 → 33）
- `tests/shell-bypass-composition.test.ts`：+⑤ 族 4 条（16 → 20）
- `scripts/mutate-verify.mjs`：+2 锚点（针脚 633 条，阻断 0）

## 读数（提交前跑齐，非提交后补票）

| 门 | 结果 |
|---|---|
| 探针 ①–⑤ | 修前 **红 5 / 绿 37** → 修后 **红 0 / 绿 42** |
| `test` | exit 0，`195 files / 1948 tests`（+8：4 条形态单测 + 4 条组合） |
| `e2e` | exit 0，闭环成立 + **判卷文件 sha256 与冻结逐字一致** |
| `security-check` | `43 ✅ / 0 ❌` |
| `typecheck` | exit 2，归因 `HEAD 内 0 个 / 未跟踪草稿 1 个`（他人 `scripts/sidebar-probe.ts`）；**HEAD 干净另在同 HEAD 开 worktree 实测**：`git worktree add --detach /tmp/dsh-wt-88e2316 HEAD` + `tsc --noEmit` ⇒ exit 0、零行输出 |
| `mutate-needles-check` | 633 条，阻断 0 / 待复认 0 / 未覆盖 0 |
| 两条新锚点 | 干净 HEAD `88e2316` 实跑全杀 |
| 同 HEAD worktree 复跑 | 三个权限测试文件 **84 条全过** |

一处自纠（同轮内）：`suffixForms` 的注释最初插在 `commandForms` 的文档块与函数之间，
把「规则匹配用的形态集」那段说明挤成了 `suffixForms` 的头注释——复核 diff 时调回顺序。
另一处：首版给包装器那一支也产后缀形，被既有负控「只读 git 只产它自己那一形」当场判红，
遂加 `EXEC_WRAPPERS` 豁免（这条负控比新断言更早存在，正是它的价值）。
