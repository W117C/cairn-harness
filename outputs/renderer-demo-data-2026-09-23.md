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
