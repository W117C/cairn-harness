# 渲染层还挂着演示数据的那一格：工作树看板「切分支」（2026-09-23）

## 一、现场（全部是可重跑的读数，不是推断）

- **桥接层根本没有 git 通道**（两条独立口径）：
  `grep -ci "git\|branch" src/preload/index.ts` → **0**（"git" 与 "branch" 两个词在整份桥接里一次都没出现）；
  主进程 `ipcMain.handle` 的 channel 去重后共 17 个，全是 `agent:*` 加一个 `plugin:decide`，**没有 git 类**。
  注意 `agent:state` 是**真**的（B18 就靠它数孤儿工作树）⇒ 缺的只是分支/HEAD 这一路，不是整条 git 面。
  ⇒ 分支面板不可能有事实源。
- **它却有一整套看起来会动 git 的界面**（`src/renderer/app.js`，改前）：
  `BRANCHES` 写死四条（`main` 当前 +2、`feat/ttl-rotation`、`fix/grace-window`、`chore/deps` 已合并），
  点一行 ⇒ 只把数组里的 `current` 翻过来、重绘、然后 `toast('已切换到分支「x」')`；
  「新建分支」输入框 + 按钮 ⇒ `BRANCHES.unshift(...)` + `toast('已创建并切换到「name」')`；
  上下文芯片印着 `工作树 · main`。
- **这一格从未有观测者**：`grep -rn "branchesViewHTML|branchPanel|createBranch|newBranch" scripts/ tests/` ⇒ **零命中**
  （命中的"工作树/分支"全是别的事：`agents-check` 的真 git 写痕、`panels-check` B18 的孤儿工作树）。

## 二、两条规矩打架，按哪一条裁决

`AGENTS.md` 同时写着：⑴「渲染层**不得**再挂任何演示常量：原先的 REVIEW / 终端 seeds 让真运行时显示
『本会话从未碰过的文件 +12 −4』，**假象比空白更坏**」；⑵「留位：`WORKSPACES` 与 `BRANCHES` 仍是演示数据，
真化需连 IPC，属 R2 范围」。

取向：**按 ⑴ 执行，⑵ 只保留"接口位"这半层意思**——留位的正确形状是"这一格明说自己没接入"，不是"先放一组假数据占着"。
差别在后果上：假数据会被用户当成仓库的真实状态，而这个产品是一个编程 agent，屏上说的正是它自己要动的东西。
能力 7（操作可审计）与 8（可协作、可接管）都挂在"屏上 = 真的"上。

## 三、改了什么（`src/renderer/app.js`，与判卷同笔提交）

- `branchesViewHTML()` 改为空态且**自己说原因**：`panelEmptyHTML('分支未接入：这一格要读仓库的 git 状态，而桥接层还没有该通道')`，
  容器带 `data-branch-state="unwired"` 给门禁一个不依赖中文文案的读点。
- 删：`BRANCHES`、分支点击/回车两套假处理、`createBranch()`、创建件（输入框 + 按钮）、随之无消费者的 `PLUS_ICON`。
- 上下文芯片不再印分支名：展开时是 `工作树 · 未接入`。
- 保留：`registerPop` 挂载与面板容器（接上 IPC 时是往同一格里填真数据，不必重搭）。

## 四、读数

| 相 | 结果 |
| --- | --- |
| 改前跑 B28（判据先写，后改实现） | **exit 1，5 条红**：`rows=4`、`create=true`、`body="分支 4mainfeat/ttl-rotationfix/grace-windowchore/deps已合并"`、`chip="工作树 · main"`、`fake=true` |
| 改后跑 `pnpm run panels-check` | **exit 0**，B28 六条全绿：`rows=0`、`create=false`、body 含「未接入」、`chip="工作树 · 未接入"`、`fake=false` |
| 新增单测 `tests/renderer-no-demo-data.test.ts` | 4 条全绿（去注释后的源码不许携带演示分支名；反面对手：注释里**允许**写这些名字，判据不许把人逼成不回写历史；那一格必须自己说未接入） |
| `pnpm typecheck` | 0 错（中途一次红是我自己的正则：`/…\n}/u` 在 unicode 模式下裸 `}` 非法，改 `\}`） |
| 全量测试 | **209 files / 2199 tests / 0 failed，exit 0**（同轮另有一次 18 条红，见下面第六节——是我这次改动造成的，已修） |
| 针脚体检（含本轮新锚点） | 767 条、改法语法体检全绿；新锚点 `branch-panel-restores-demo-rows` 的针脚在**提交前**被自己那两条 HEAD 判据点名（判卷文件未入库 + 钉在飞文本），提交后当场可跑 |

## 五、这一轮明确没做的（留名，不装作已覆盖）

1. **`WORKSPACES` 那三条假文件夹**（`coding-suite` / `docs-site` / `edge-gateway`，含假 `+12 −4`）仍在屏上，
   且 `selectWorkspace()` 仍是"只换个 toast"。同一族、同一个判据形状，但它多一层真东西（文件输入框登记的本机目录、
   「设置真实运行目录…」那一行是真的），要分开处理 ⇒ 独立任务；新单测里的 `demoTokens` 此刻**只收分支名**，
   就是为了不把没守的东西写成守住了。
2. **`AGENTS.md` 那句 ⑵ 现在过期**（BRANCHES 不再是演示数据，而是"明说未接入"）。该文件在别人在飞集里 ⇒ 只追加不改写，留任务。
3. `.branch-*` / `.b-*` 的 CSS 暂时成了死规则（不骗人，只是占位）；接 IPC 时会重新用上，本轮不删。
4. `proto/forge-prototype.html` 里有同一批假数据——那是设计稿、不在发货路径，明确不动。

## 六、我这次改动自己造成的红（18 条），与它暴露的那一类依赖

跑全量测试时第一次出现 **3 files / 18 tests 红**：`renderer-git-evidence`、`renderer-merge-review`、`renderer-orphan-worktrees`。
根因不是产品改错，而是这三个判卷用 **注释文本** 当切片边界——
`const b = source.indexOf('/* git 分支数据', a);`——我恰好在 1128 行换掉了那段注释，标记消失 ⇒ `indexOf` 返回 -1
⇒ `expect(b).toBeGreaterThan(a)` 红（"expected -1 to be greater than 43470"）。

修法：三支边界改成**代码标识** `source.indexOf('function branchesViewHTML', a)`（仓里切片界的真实顺序是
`gitViewHTML(1044) → orphanBlockHTML(1109) → branchesViewHTML(1132)`，改完三支全绿），**没有**动那三支的断言本体。

这类依赖是族，不是我这一次的偶然：`grep` 全仓，用注释文本当边界的切片判卷共 **10 个文件**
（`renderer-agents-view`、`renderer-scroll-follow`、`schedule-timezone-note`、`renderer-skip-reason`、
`renderer-collapse-single`、`renderer-truncation-label`、`renderer-modal-dismiss`、`renderer-terminal-liveness`、
`renderer-panel-state`——最后这支还专门测了"标记出现两次 ⇒ 切片悄悄撑大"，但没测"标记消失"）。
本轮**不做**批量迁移：把标记换成函数名要逐个核对切片区间是否等价，而"切片悄悄变小"是**静默通过**的那种错
（测得更少而门仍绿），比现在这种"一删注释就 18 条红"更坏。现状的代价是税，不是缺陷：**改注释 = 改判卷依赖面**，
这条已写进记忆（规则 55 的补充实例）。

---

## 七、工作区这半（第五节 ⑴ 的那条独立任务，同族第二格）

### 现场（B29 第一次跑出来的红，逐字）

```
❌ B29 面板里不许出现演示文件夹（发货路径没有事实源；实测 "…coding-suite~/dev/coding-suitedocs-site~/dev/docs-siteedge-gateway~/work/edge-gateway打开其他文件夹…"）
❌ B29 不许有「打开其他文件夹当工作区」那条假流程（…；实测 true）
❌ B29 面板行数与芯片读到的真配置同数（芯片="运行目录 · proj-ws" 判为已配置，实测 rows=3）
❌ B29 已配置时那一行必须就是芯片上那个目录名…（实测 names=["coding-suite","docs-site","edge-gateway"]）
```

比分支那半更糟：屏上列的三个目录用户**一个都没有**，而他真配的那个（`proj-ws`）**不列**——
芯片和面板同时说话，且互相矛盾。`#wsAdd` 那句「已切换工作区…」也是可证伪的：
`<input type=file webkitdirectory>` 只给目录名，给不出能当运行目录的绝对路径，
`selectWorkspace()` 换的是数组里的 `current` 指针，`configuredWorkspace` / `panelData.tree` 一字不动。

### 改法（`src/renderer/app.js`）

- 真运行时那一支的唯一来源改成桥接段注入的 `realWorkspaceRows()`：`configuredWorkspace === null ? [] : [那一条]`。
  没配 ⇒ 一行都不列，并明写「未指定运行目录：使用宿主环境 / 默认目录」（`data-ws-state="unconfigured"`）。
- 演示数组 **不删**：`WORKSPACES` 是浏览器直接打开这份文件时（`window.agent` 缺失）的正当用途，
  注释改成「**仅原型态**」。撤的是它进入发货路径的那条路，不是它本身。
- 真那一行用 `div` + `aria-current`，不再做 `role="radio"`——没有能生效的切换，就不该长得像能切。
- `#wsAdd` 与 `selectWorkspace` 那条假流程在真运行时一并撤。

### 判卷（三处，快 → 慢）

1. 静态（`tests/renderer-no-demo-data.test.ts`）：`demoTokens` **不收**工作区名——收了等于逼自己删掉正当用途；
   那一半改由 ⑵ 的"跑 shipped 代码"守着。注释里写明了这个分工。
2. 离线切片（同文件新增 4 条）：vm 真跑 `workspaceViewHTML`，两支都对——
   agent 态注入 `[{proj-ws}]` ⇒ 只列它、`<div class="ws-row is-current"`、无 `role="radio"`、
   无三个演示名、无 `wsAdd`；`rows=[]` ⇒ 出「未指定运行目录」；
   **反面对手**：同一个函数在原型态**确实**画那三条 ⇒ 上面那条绿不是靠"整块删掉渲染"变绿的。
3. 真窗口（`panels-check` B29 五条）：**以芯片为准做两侧对照**（芯片文字由桥接段覆写，是可证伪的真值）：
   配了 ⇒ 恰好 1 行且那行名字 = 芯片后缀；没配 ⇒ 0 行且 0 个名字。

### 我自己写坏的那半，被全量门抓住

B29 第一次落笔是 `unconfigured || (names.length === 1 && …)`。
`tests/assertion-health-scan.test.ts` 报：
`disjunction scripts/panels-check.ts:1933 → 断言含 ||（任一析取项成立即通过）`。
这不是误报也不是格式洁癖——未配置那一支会让后半句**恒真**，
即"名字对得上芯片"这半句在真窗口里从未被读过过。改成两侧各断一件事（未配置那支断 `names.length === 0`）。
**同一族第二次**：规则 58 记的就是「跑改动邻域 ≠ 跑那道门，全量门抓出我自己留在 HEAD 的析取断言」。
这一次门在**在飞阶段**就抓住了，没进 HEAD——同一条规矩的价值。

### 复跑读数

- `panels-check`（改判据后重跑，不沿用改前那次绿）：B29 五条全 ✅，
  `names=["proj-ws"] chip="运行目录 · proj-ws"`、`add` 实测 `false`、`rows=1` ⇒ 「全部断言通过 ✅」exit=0。
- `pnpm typecheck` → `tsc --noEmit 通过（0 条报错）✅`。
- 切片判卷 8 条全绿（含改边界那次）。

### 这一笔**没有**提交的：锚点

新锚点 `workspace-panel-unwraps-agent-branch`（关掉 `if (window.agent)` 那支 ⇒ 产品态退回演示列表）
留在工作树里没入库，原因是 `scripts/mutate-verify.mjs` 同一时刻被**别人的原子簇**占着：
`no-progress` 那 6 条锚点（`np-*`）在文件里，而 `src/agent/no-progress.ts`、`tests/no-progress.test.ts`、
`scripts/no-progress-check.ts` **三个都不在 HEAD**（`git cat-file -e` 实测均报缺）。
整文件一并提交 = 亲手造出 6 条指向不存在文件的悬空锚点，正是 #37 / #57 / #59 / #61 一路在收的那个坑。
⇒ 只提交自己的三面（`app.js` + `panels-check.ts` + 切片判卷），锚点另立任务等那一簇落地。
另外：锚点要跑起来本来也得先提交——`preflightRefusals` 拒 src/test 相对 HEAD 有脏的锚点。
