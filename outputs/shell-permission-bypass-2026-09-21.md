# 权限层与 worker git 闸的包装器绕过（复现报告，2026-09-21）

> **结论先行**：四条缺陷，全部**已实测复现**（不是 grep 推断）。复现器四段皆为断言，
> 当前 **红 24 / 绿 9**（① 9 红 / ② 5 红 / ③ 6 红 / ④ 4 红）。
> 根因高度收敛：**「有效二进制」解析在权限层缺席**（① ③ 同根，③ 本仓已有一半实现）+
> **「总是允许」存整条命令字面量且 allow 只让位于 critical**（②）+ **重定向写面在静态威胁表里零条目**（④）。
> 本文只登记复现与修法形状，**判修未施工**。基线 HEAD `0e1b504`，复现器 `scripts/probe-shell-bypass.ts`。
> ① ② 的修法形状来自对 ZCode 的评估，见 `outputs/zcode-study-2026-09-21.md`；③ ④ 是本仓自有缺陷。

## 复现方法

```sh
pnpm exec tsx scripts/probe-shell-bypass.ts     # 当前必红（退出码 1），直到 ① ③ 收口
```

四段探针分别直调：`judgeChain`（`src/permissions/rules.ts`）、`evaluate`（`src/permissions/autonomy.ts`，
自主档 + 完整会话桩）、`interceptDestructiveGit`（`src/agent/worker-shell-tools.ts`）。
判据写成「期望 vs 实测」两列，**由探针自己给非零退出码**——早期版本退出码恒 0，那不代表绿。

固定规则库：`deny run_shell "git push --force"` + `allow run_shell "echo hi"`（后者模拟用户点过一次「总是允许」）。

## ① 用户手写的 deny 规则不生效：11 个变体里 9 个不进 `L1-deny`

自主档、完整 `evaluate` 的实际落点：

| 命令 | 期望 | 实测 |
|---|---|---|
| `git push --force` | deny@L1-deny | deny@L1-deny ✓ |
| `git  push  --force`（多空格） | deny@L1-deny | deny@L1-deny ✓（`normalizeCommand` 生效） |
| `sudo git push --force` | deny@L1-deny | **ask@L4-risk** |
| `sudo -u root git push --force` | deny@L1-deny | **ask@L4-risk** |
| `env FOO=1 git push --force` | deny@L1-deny | **approve@L4-pass** |
| `nohup git push --force` | deny@L1-deny | **approve@L4-pass** |
| `timeout 30 git push --force` | deny@L1-deny | **approve@L4-pass** |
| `command git push --force` | deny@L1-deny | **approve@L4-pass** |
| `/usr/bin/git push --force` | deny@L1-deny | **approve@L4-pass** |
| `bash -c 'git push --force'` | deny@L1-deny | **approve@L4-pass** |
| `GIT_PAGER=cat git push --force` | deny@L1-deny | **approve@L4-pass** |

两个必须分清的性质：

- 7 条**零提示直接放行** —— 用户显式写的 deny 被静默击穿。
- `sudo` 两条只是「被无关的 `sudo=high` 风险通道问了一句」，**deny 规则本身从头到尾没命中**。
  剔除档位与风险层噪声后单看规则层（`judgeChain`）：`git push --force` → `deny`，
  `sudo git push --force` → `miss`，`/usr/bin/git push --force` → `miss`。
  默认档同样 `miss`（只是会因别的理由出卡），而**审批卡上不会提到用户写过这条 deny**。

根因：`matchSegment` 是 `segment.startsWith(rule.pattern)` 的裸文本前缀匹配，链切分只认
`&& || ; | & 换行`（`CHAIN_SPLIT`），不看包装器、绝对路径、内嵌 shell、前置环境赋值。

## ② 「总是允许」携带载荷：5/5 放行

点过一次「总是允许 `echo hi`」之后，自主档：

| 命令 | 实测 |
|---|---|
| `echo hi` | approve@L3-rule ✓（本就应放行） |
| `echo hi > /tmp/pwned` | **approve@L3-rule** |
| `echo hi >> ~/.zshrc` | **approve@L3-rule** |
| `echo hi $(rm -rf /tmp/x)` | **approve@L3-rule** |
| `` echo hi `rm -rf /tmp/y` `` | **approve@L3-rule** |
| `echo hi \| sh` | **approve@L4-pass**（allow 未参与，属 ④ 一类） |

两条根因叠着：`src/main/agent-runner.ts` 的落库处写的是 `pattern: args.command.trim()`（整条命令字面量），
以及 `autonomy.ts` 的 L3 只在 `risk === "critical"` 时让 allow 让位。`rm -rf /tmp/x` 命中的是 **high**
（威胁表 `rm 递归/强制删除` 那条要 `rm` 后跟 `-rf`，路径是否根路径不影响定级）⇒ high 被 allow 吃掉。

附带后果：同一处 `trim()` 也让规则**过窄**——`echo hi` 的授权不会覆盖 `echo hi -n`，
用户以为「总是允许」了，下次仍被问。窄与宽同时错，是同一个「pattern 从哪来」缺位的两面。

## ③ worker 的 git 破坏命令静态闸：11 例放行 6 例，形态齐一

`interceptDestructiveGit` 直调（`ok:true` = 放行）：

| 命令 | 实测 |
|---|---|
| `git push --force` / `git worktree add x` / `git reset --hard` / `git commit` | 拦住 ✓ |
| `git status` | 放行 ✓（只读集） |
| `nohup git commit -m x` | 拦住 ✓ |
| `sudo -u root git push --force` | **放行** |
| `timeout 30 git worktree add x` | **放行** |
| `nice -n 5 git reset --hard` | **放行** |
| `env -i git push --force` | **放行** |
| `command -p git push --force` | **放行** |
| `bash -c 'sudo -u root git push --force'` | **放行** |

漏的全部是**包装器带参数值**，裸 `sudo` / 裸 `nohup` 反而拦得住。原因在 `gitInvocation` 的跳过循环：
只 `EXEC_WRAPPERS.has(word)` 跳整词 + 跳 `VAR=` 前置赋值，不吞选项值 ⇒ `sudo -u root git …` 的
「有效二进制」被判成 `-u`。`timeout`/`nice`/`env`/`command` 的带值选项同形。
后果面：一个 `nice -n 5 git reset --hard` 就让本该无合并权的 worker 毁掉工作树。

**这是本仓已有的同族接缝**：`worker-shell-tools.ts` 的 H2 段注释明写「拦截按有效二进制判定，
不再只认段首字面 git」，即 ① 的同一条修法在本仓已做过一次，只做在 worker 那一支。
① ③ 的正确收口是**上提成一份共用**，而不是再写第三份。

## ④ 顺手量到的、不从 ZCode 借的：重定向写面零条目

空规则库、自主档：

| 命令 | 实测 |
|---|---|
| `echo hi >> ~/.zshrc` | approve@L4-pass，`risk=none` |
| `echo alias\ ll=rm > ~/.bashrc` | approve@L4-pass，`risk=none` |
| `cat > .git/hooks/pre-commit` | approve@L4-pass，`risk=none` |
| `echo x > /etc/hosts` | approve@L4-pass，`risk=none` |
| `echo 'rm -rf /tmp/z' \| sh` | ask@L4-risk，`risk=high` ✓ |

即：缺的不是管道，是**写向本身没有分类**。`> ~/.zshrc` 是持久化后门面，`> .git/hooks/pre-commit`
是「让下次 git 操作执行任意代码」的面——威胁表六类里没有这一类。同档同类
`echo hi $(rm -rf /tmp/x)` 与 `echo hi > /tmp/pwned` 在 ② 里也被 allow 直接吃掉。

## 修法形状（含成本与出处）

1. **上提「有效二进制」解析为唯一实现**：把 `gitInvocation` 的判定改成通用 `effectiveBinary(seg)`，
   权限层 `matchSegment` 与 worker 层共用；跳过集合补**带值选项表**（约 40 行，出处：ZCode
   `bash-command-permission-policy.ts` 的 `WRAPPER_OPTIONS_WITH_VALUES`，逐包装器列 `sudo -u/-e/--chdir…`、
   `time -f/-o`、`env -C/-S/-u`、`nohup`、`command`）。链切分后再单独判 **redirect 与 `$(…)` 站点**，
   使其不能随主命令一起命中规则。成本：60–90 行 + 锚点。这一条同时收 ① 与 ③。
2. **allow 的落库形状**：`pattern` 存 **argv 前缀**（由工具声明 pattern 从哪个字段来），而非整条命令；
   对「每次输入都是不同代码」的工具（`run_shell` / `process`）把「总是允许」降级为会话内条目
   （ZCode `askOptions.allowAlways: false | "session"` 的语义）。收 ② 的两面。
3. **allow 让位阈值**：L3 从「只让 critical」抬到「high 及以上不让 allow 批掉」。
   代价是自主档审批变多——与「自主档 ask 0%」的既有读数是同一处取舍，**需与判断层校准一起裁决**，
   别单独改（单独改会立刻把自主档变成逐次问）。
4. **威胁表补「写向重定向 / 钩子与 shell rc 路径」一类**：收 ④。这条是纯表条目，最便宜，
   但注意 `>\s*\/dev\/` 那条已存在，新增要与既有条目的 category 归属对齐，别开第七类。

## 锚点计划（施工时四条变异锚点，逐条「改什么必红」）

- 撤掉 `effectiveBinary` 的带值吞参 ⇒ ③ 的 `nice -n 5 git reset --hard` 必红（当前已红，锚点要锚住转绿后的态）。
- 把 `matchSegment` 退回裸 `startsWith` ⇒ ① 的 `/usr/bin/git`、`env FOO=1` 两条必红。
- 把 allow 的落库退回整条命令字面量 ⇒ ② 的 `echo hi >> ~/.zshrc` 必红。
- 从威胁表删掉新增的重定向写向条目 ⇒ ④ 的 `cat > .git/hooks/pre-commit` 必红。

反向对照（判据本身的可信度）：`git push --force` 与 `git status` 这一对必须分别保持 deny 与放行，
否则上面任何锚点都可能被「一律 deny」伪造成绿。

## 状态

未施工。动手前按仓规再核一次相交：`src/permissions/rules.ts`、`autonomy.ts`、`risk.ts`、
`src/agent/worker-shell-tools.ts`、`src/main/agent-runner.ts` 在本文落笔时对 HEAD 均干净
（主会话刚把在飞的 `scripts/mutate-verify.mjs` 提交，故锚点位也可用），但主树是并发工作区，**临改必重核**。

## 复跑与施工状态（09-22 追记，不回改上文原句——那是该日快照）

- **复跑**：`pnpm exec tsx scripts/probe-shell-bypass.ts` 在今天仍 **红 24 / 绿 9、退出码 1**，
  分节 ①9 / ②5 / ③6 / ④4 与本文落笔当天一字不差 ⇒ 缺陷未随别的提交被动收敛。
- **第一块砖已落**：`src/permissions/command-shape.ts` + `tests/command-shape.test.ts`（29 条，正例与反例成对）
  = 上文「修法形状」里那份**全仓唯一**的有效二进制解析：跳过前导环境赋值与 exec 包装器
  （含带值选项 `sudo -u root` / `timeout -k 5` / `nice -n 5`，以及 `timeout 30`、`nice 5` 这类位置值）、
  路径取基名（`/usr/bin/git` → `git`）、`shell -c` 载荷按同一套规则递归（深度上限 3，越界只少跳一层不崩）。
  **权限层与 worker 两支都要改吃它**——再写第三份就是本仓第七族的老路。
- **① 已收（同日紧接的一笔）**：`rules.ts:matchSegment` 的 deny/ask 改逐形态取最长命中，
  allow 刻意只认原形。探针读数 **红 24 / 绿 9 → 红 15 / 绿 18**，① 段 11 条全绿；
  离线面另加 6 条（`tests/permissions.test.ts`「规则匹配按有效二进制」一段，含
  「反例：git 只作为参数出现时不得命中」与「allow 只认原形」两条负控）+ 4 根锚点
  （`rule-matcher-deny-ignores-wrappers`、`rule-matcher-allow-widens-to-wrappers`、
  `shape-leading-env-assignment-not-skipped`、`shape-wrapper-value-opt-not-swallowed`）。
  回归面：`security-check` 43 ✅ / 0 ❌，权限邻域 4 份测 70 条全绿。
- 剩余施工顺序与判据不变：③ 接 `worker-shell-tools.ts`（补掉只 `has(word)` 不吞选项值的半截循环）
  → ② 那条「总是允许」存整条命令字面量的账（allow 已刻意不放宽，但 ② 的五条红是**载荷**方向：
  `echo hi > /tmp/pwned` 之类仍被放行）→ ④ 重定向写面进静态威胁表。
  收口判据 = 探针退出码 0，**且**反向对照那一对继续成立（`git push --force` 必拦、`git status` 必放行）——
  只有前一半的话，「一律 deny」也能伪装成绿。

### ③ 也已收（同日第三笔，探针红 15 → 9）

`worker-shell-tools.ts` 删掉自带的 `EXEC_WRAPPERS`/`SHELL_INVOKERS`/`gitInvocation` 三份副本，
改吃同一份解析件；`shell -c` 载荷那支也不再另发一条「内嵌」文案——**一种判定一份实现一条 reason**。
探针 ③ 段 11 条全绿（六支半截循环：`sudo -u root`、`timeout 30`、`nice -n 5`、`env -i`、
`command -p`、嵌套 `bash -c 'sudo -u root …'` 全部拦下），总读数 **红 9 / 绿 24**。
离线面：`tests/hardening2.test.ts` +2 条（含反例那一条：包装后的只读 git 与 `bash -c 'echo git push --force'` 必须放行）。
剩下的 ② 5 条与 ④ 4 条各自成笔，未动。

### ④ 也已收（同日第四笔，探针红 9 → 5）

`risk.ts` 的静态威胁表补进**重定向写面**四条（`redirectOnto()` 一处组式，四条共用）：
家目录 / 系统路径 / 执行与凭证面（`.git/hooks`、`.ssh`、`authorized_keys`、shell 启动文件、`crontab`）
各 **high**，工作区普通落盘 **medium**。刻意不做"一律 high"：`build > out.log` 这类天天发生，
全抬成 ask 只会让人闭眼点同意，那是比漏判更坏的风险稀释。
`>&1` 与 `>/dev/null` 由负向前瞻排除（不写进任何文件的复制/丢弃不算写面）——
这条反例本身也钉了锚点（`threat-redirect-devnull-exclusion-lost`），盯的是**判据自己变宽**。
探针 ④ 段 4 条 + 对照 1 条全绿，总读数 **红 5 / 绿 28**；离线面 `tests/permissions.test.ts`
「重定向写面进威胁表」一段 5 条（含链上取最高、`shell_ro` 仍不吃威胁表两条），锚点 +3，针脚体检 618 条 / 阻断 0。
**只剩 ②**（「总是允许」整条命令字面量被前缀命中，`echo hi > /tmp/pwned` 仍放行）——
它是 allow 语义的账，方向与前面几笔相反（要收紧同意范围，不是扩大检测面），单独一笔做。

⚠️ **本程自记一笔**：① 那笔（`5b6a7d5`）把 HEAD 弄红了一个 tsc 错——接线之后只跑了邻域测与
`security-check`，**没重跑 tsc**（`rule.pattern` 的收窄过不了 else-if 链）。这是「跑过邻域 ≠ 跑过那道门」
的同一条规矩在**类型门**上的复犯：改完 src 的接线，验证集里 `typecheck` 与 `test` 两门都不可缺。
本笔随 ③ 一起修回（`const pattern = rule.pattern` 取一次），并同步改掉两根锚点的针脚原文。
（09-22 复记：同一条又犯了一次——② 那笔的新测试里三处属性访问没过 tsc，靠"改完必重跑 typecheck"当场抓住。）

### ② 也已收（同日第五笔，探针红 5 → 0，四段全绿）

`allow` 的前缀命中之后如果还剩载荷（`>`、`>>`、`$(`、反引号、`${`、`|`），这一条**按 ask 走**：
用户点「总是允许 echo hi」时看见的不是 `echo hi > /tmp/pwned`。实现是 `rules.ts` 给命中打一个
`consentGap` 标（这条命中的行为就地从 allow 写成 ask，`ruleId` 仍是原 allow 条目 ⇒ 审计认得出是谁），
`autonomy.ts` 的 L2 支据此换一句理由：「『总是允许』不覆盖这条命令的载荷」而不是「ask 规则命中」。
第五支 `echo hi | sh` **不走这条**——它的 "echo hi" 段没剩载荷、"sh" 段压根没规则，
所以修法只能是威胁表补一条「管道进 shell」high（把 `ALLOW_PAYLOAD` 再拧一圈也管不到它）。
成对反例同批钉住：`echo hi`、`echo hi --version`、`git push origin main` 必须照旧 allow，
否则 allow 形同虚设；代价也写明——引号里的 `>` 会多问一次（选过问，不选漏问）。
读数：`tests/permissions.test.ts` 31 条绿、tsc 我的文件 0 错、针脚体检 620 条 / 阻断 0（锚点 +2、1 根针脚改原文）。

### 复现器自己有一条恒不成立的断言（同日发现并修）

② 段原先写的是 `check(…, "非 approve", got)` —— 拿字面量 `"非 approve"` 与实测串相等。
而实测串永远是 `ask@…` / `approve@…` 这种形状 ⇒ **这个期望不可能被满足**，产品修好了它也永远红。
门禁体检查恒真式与析取式，查不出这种恒假式；能试出来的只有"修好之后它必须能绿"这一步。
已改为 `checkNot(…, "approve", got)`（判 `!got.startsWith("approve")`），并且**先只改判据、不动产品**
复跑一次：仍红 5 / 绿 28、逐条与改前同形 ⇒ 这次改判据没有把红偷偷改成绿。

### 四段全绿之后的留位

* 探针仍是「非门禁」（`scripts/gate-manifest.ts` 未收它）。要收的是它独有的那件事：四道面
  （规则层 + 风险层 + 档位 + worker 静态闸）**合起来**的端到端判定——离线锚点各钉一支，没有一条钉住组合。
  收它要改 gate-manifest，而该文件此刻在别人的在飞改动集里。
* `consentGap` 只作用于 allow；deny/ask 的形态面与它正交（两根锚点各自钉住，不会互相掩盖）。
* 高熵规则的命名残留另有账（见 `stop-reason-blindspot-2026-09-21.md` 待办 15），本文不动。

### 收尾读数（`17deac2`，三态对照逐条归因）

* 工作树整表 `pnpm gates`：**绿 30 / 33，红 3**（门数从 31 涨到 33——并发会话新挂了
  `arch-boundary-check` 与 `mutate-needles-check`；**门数一律以 `pnpm gates` 的输出为准，本文不写死**）。
* 三道红逐条归因，**都不是本簇的回归**：
  ① `typecheck=2`：唯一报错在别人的未跟踪草稿 `scripts/sidebar-probe.ts`（断言体检同一笔也点了它的
  两处空断言）——同一 HEAD 开 worktree 跑 tsc = **0 错**，所以 HEAD 干净这句只在 worktree 读数下成立。
  ② `mutate-verify=1`：`src/main/sandbox.ts 相对 HEAD 有改动——属在飞改动集，拒绝变异`，
  这是**正确的红**（无回滚兜底时拒变，不是变异存活）。本簇 9 根新锚点单独在 /tmp 同 HEAD worktree
  逐条实跑，全部杀死。
  ③ `gym-check=1`（4 项失败）：**在飞集经重放路径带出来的**——同一份 `scripts/gym-check.ts`
  在干净 HEAD 的 worktree 里跑 = **33 ✅ / 0 ❌、exit 0**。⇒ 红的是别人在飞的 orchestrator/loop 改动，
  不是权限这一簇；等对方落库后复跑即可。
* 本簇自跑且与权限面直接相关的五道：`test` / `e2e` / `security-check` / `ipc:check` / `sandbox:check`
  全 **exit 0**（`e2e` 尤其要紧：它跑真 loop + 真闸门，而 frozen 判卷文件 sha256 逐字未变）。
* ⚠️ 两条自记：这五道里我先用 `pnpm run ipc-check` / `pnpm run sandbox-check` 跑，两条 exit 1 ——
  读执行器自己的报错行才看清是**脚本名写错**（真名带冒号 `ipc:check` / `sandbox:check`），
  换正确名字后两绿。退出码异常先怀疑命令写法，别急着记成被测代码的回归。
