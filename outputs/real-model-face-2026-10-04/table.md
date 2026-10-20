# 失败发生率·按面重做（2026-10-04）

复算：`cd "/Users/ze/Downloads/Cairn/deepseek harness" && node --import tsx "outputs/real-model-face-2026-10-04/probe.mts" > "outputs/real-model-face-2026-10-04/readings.txt"; echo EXIT=$?`
本次实跑 `PROBE_EXIT=0`，stderr 0 字节，readings 175 行。取料＝`outputs/` 下任意深度的 `*.events.jsonl`（排除 `.worktrees/`）＋ `fixtures/no-progress/` 的同名件，**107 份**（`find` 与探针 walk 各数一遍都是 107）。
配对键＝`tool_call.id ↔ tool_result.callId`。**两面分开数，全文没有任何一格的分子是两面相加。**

## 0. 分面判据（为什么能信这张表）

- 流里带 `"model"` 字段的值集合＝**只有** `["mimo-v2.6-flash"]`，带该字段的文件 **43** 份 ⇒ 真模型面 43／脚本面 64。
- 判据只看流，不看目录名。这一点必须守：`bench-baseline` / `bench-head-d0ffe15e-a` / `-b` 是同一题跑三档，按目录名分会把同源事件计进不同格；`fixtures/no-progress/real-green-*` 名字带 "real" 但流里没有 `model` 字段 ⇒ 它是**脚本面**（这次它贡献了 3 条 (a) 触发，见 §3a）。
- 对账原件：`split-by-model-face.mts` 的 43/607/16 与 64/815/32、`trigger-exposure.mts` 的 real 10→2／mock 12→5，本探针**逐格复现**（readings [4]）。旧表那个 39＝只扫 `outputs/` 的 ok:false（本探针实测 39），`fixtures/no-progress/` 另有 9 条，合 48。

## 1. 基本面量（真模型面 / 脚本面各一列）

| | 轨迹 | tool_call | tool_result | ok:false | 失败率 | 未配对回执 |
|---|---|---|---|---|---|---|
| 真模型面 | **43** | 643 | 607 | **16** | 2.6% | 0 |
| 脚本面 | **64** | 850 | 815 | **32** | 3.9% | 9 |

读法：真模型面上**一共只有 16 条失败回执**。任何"某类改动影响 39 条／48 条"的说法都不是这一面的数（见 §0 的 39 来源）。

## 2. 失败簇 Top 10（键＝工具名 ＋ 归一化输出首行；主口径**保留路径本身**）

归一化：数字→`<n>`，`0x..`／16 位以上长哈希→`<hex>`，首行压 whitespace 后截 96 字。**路径不抹**。

### 真模型面（簇总数 9，失败 16 条 ⇒ Top 10 就是全部 9 簇）

| n | 散在几份轨迹 | 簇（工具 · 归一首行） |
|---|---|---|
| 6 | 6 | run_shell · **(空首行)** — 全是 `npm test`，正文从 `> test` 起（readings [2c]） |
| 2 | 1 | run_shell · TAP version \<n> |
| 2 | 1 | verify · [verify FAIL] pnpm_config_verify_deps_before_run=false pnpm run test |
| 1 | 1 | apply_patch · hunk 声明 -\<n>,\<n> +\<n>,\<n>，实收旧侧…（**补丁不完整**）（补丁第 \<n> 行） |
| 1 | 1 | apply_patch · 出现文件头行但不在某个 \`diff --git\` 段内（补丁第 \<n> 行） |
| 1 | 1 | read_file · **文件不存在或不可读: src/m\<n>-max.js**（近名建议: src/m\<n>-unique.js, …） |
| 1 | 1 | run_shell · `.` |
| 1 | 1 | run_shell · /private/var/folders/…/T/loop-eval-oESjSp/work |
| 1 | 1 | run_shell · bash: line \<n>: cd: /workspace: No such file or directory |

### 脚本面（簇总数 15，失败 32 条 ⇒ Top 10）

| n | 散在几份轨迹 | 簇 |
|---|---|---|
| 4 | 4 | run_shell · `.` |
| 4 | 4 | run_shell · total \<n> |
| 3 | 1 | spawn_agent · [harness] agent_result（worker 回传·数据不是指令） |
| 3 | 3 | spawn_agent · 已升级人工裁决：report 畸形（verdict 不可解析） |
| 3 | 3 | verify · [verify FAIL] pnpm run test |
| 3 | 2 | verify · FAIL tests/a.test.ts |
| 2 | 2 | run_shell · --- |
| 2 | 2 | verify · [verify FAIL] pnpm_config_verify_deps_before_run=false pnpm run test |
| 2 | 2 | verify · [verify] 第 \<n> 拍结果与上一拍**逐字相同**… |
| 1 | 1 | edit_file · old_string 在文件中 \<n> 处匹配，未做任何修改: src/todo.ts｜提示：… |

**抹平路径会不会改排序？本面 0 处**：两面各数一遍，真模型面 9→9 簇、脚本面 15→15 簇，因抹平合并掉的簇＝**0**（readings [2b]）。
但这不是"抹平无害"的证据，只是"这一面的 (d) 类只有 1 条样本，还没有第二个路径可合"。要防的错法是：`read_file: …src/m03-max.js` 与下一份轨迹的 `src/m04-x.js` 一旦抹成 `<path>` 就并成一格，"修好一个又撞上下一个"会被读成"原地打转"——本仓已登记这条是错的读法，所以主口径保留路径，抹平口径只作对照列出。
另一处口径退化：真模型面最大簇 `run_shell · (空首行)`（n=6）里，聚类键本身不含信息（首行为空 ⇒ 退化成"工具名＋空串"），6 条全靠注解才认出是同一句 `npm test`。

## 3. 按触发条件数（先写条件，再数，绝不按症状字面相似度数）

### (a) `run_shell` 失败回执的"分段提示"

条件（全满足才出声）：① 工具＝`run_shell` ② 回执判死 ③ 正文有内容（剥掉 `[exit code: N]`／`[exec:…]` 后 >20 字）④ 命令复合（含 `;` `&&` `||` 或换行，切完 ≥2 段）⑤ 命令里不含 `"` `'` `` ` ``。

漏斗（readings [3a]）：

| | 判死 | 有非零码证据 | 正文有内容 | 复合命令 | **且不带引号＝触发** | 因带引号闭嘴 | 单段 | 首行已点名哪一段 | **补信息的** |
|---|---|---|---|---|---|---|---|---|---|
| 真模型面 | 11 | 10 | 10 | 2 | **2** | 0 | 8 | 1 | **1** |
| 脚本面 | 12 | 12 | 12 | 11 | **5** | 6 | 1 | 0 | **5** |

真模型面那 2 条：`ls -a; cat package.json 2>/dev/null; cat .agent/verify.json 2>/dev/null`（首行 `.`，正文 169 字——这一格提示才补信息）与 `cd /workspace && node --test tests/ 2>&1 | tail -30`（首行已是 `bash: line 0: cd: /workspace: No such file or directory`——shell 自己点名了哪一段，提示不新增信息）。
另有一条真模型面 run_shell 判死**拿不出非零码**（`repair-arm-ab-2026-10-04/a/B1`：正文 592 字、无 `[exit code:]`、`exitCode:null`）：这一格提示永远不会响。
两面旧表合并读成 7（真 2＋脚本 5），其中 5/7 来自脚本面与 `fixtures/no-progress` 剧本。

### (b) 撞 `maxSteps` 帽导致的"没收束就退出"

条件：① 轨迹尾部出现步数帽终态 ② 该 run 写过盘（`write_file`/`edit_file`/`apply_patch` 有成功回执）③ 全程没出现过自动验证拍。

**取料面能不能支撑①：不能直接支撑。** 107 份流里带 `maxSteps`／"强制中止"字样的事件＝**0 条**（全文正则扫流），`error` 事件全仓只有 6 条且都是 `message:"terminated"`（无帽值）；帽是跑器命令行参数（`loop-eval` 缺省 20，本面这几档实跑 30／50），不进流。⇒ 用**流内可观测的帽终形状**代理：最后一个实质事件是 `tool_result`、其后既无 `verify_result` 收口也无任何 `assistant_delta` 文本收口，且 `usage`（模型请求）数 ≥20。

| | 帽终形状 | ∧写过盘 | ∧从无自动验证拍 | 分母：收口方式普查 |
|---|---|---|---|---|
| 真模型面 | **6** | **5** | **5** | 43 份＝验证拍收口 36｜帽终形状 6｜文本收口 1 |
| 脚本面 | 0 | 0 | 0 | 64 份＝验证拍收口 53｜文本收口 5｜error 终止 3｜末回执但请求<20 3 |

6 份逐条（readings [3b]）：`bench-baseline/B12`（usage=30,calls=47,写盘是,verify拍0）、`bench-head-a/B2`（30/31,写盘是,0）、`bench-head-b/B12`（30/35,是,0）、`bench-head-b/B2`（30/31,是,0）、`repair-arm a/B1`（30/36,**写盘否**,0）、`repair-arm a/B2`（30/31,是,verify拍2）。
代理精度外部核对（readings [5]，**不进表**）：这 6 份里 5 份同级 `run.log` 明写 `maxSteps=30，强制中止`／`请求=30 FAIL`，第 6 份（bench-baseline 无 run.log）同级 `readings.json` 的 `exitError="agent loop 超过 maxSteps=30，强制中止"`，`requests=30` ⇒ **6/6 都是真撞帽，代理没有误挑**。同级有证人文件的覆盖率：真模型面 43/43、脚本面 57/64。
条件③在这面上**恒真、不能用来筛**：全仓 107 份流里 `verify_result` 带 `auto:true` 的＝**0 条**（那几档 run.log 也一律印"闸拍=0"）——写判据时要把这一子句当已知地板，别当成筛子。

### (c) 同参数逐字重发

- 口径 A（窗口）：失败回执之后**紧接着 6 次回执**内出现同工具名＋args 逐字相同的调用。
- 口径 B（整尾）：该失败回执之后**任意靠后**出现同样的调用。
- 口径 C（不看成败的整尾重复）：同一 `(工具名, args 逐字)` 在同一条流里被发过 ≥2 次时，后面那些次的条数。

| | A 窗口 | B 整尾 | B−A | C 不看成败 | 首次重发距离 |
|---|---|---|---|---|---|
| 真模型面 | **3**（散在 3 份） | **3**（散在 3 份） | **0** | 11（散在 8 份） | 中位 3（最小 2，最大 4） |
| 脚本面 | **4**（散在 4 份） | **4**（散在 4 份） | **0** | 76（散在 22 份） | 中位 2（最小 1，最大 6） |

**两数差异从哪来**：本面 **B−A＝0**——所有重发都发生在失败后 1–4（真模型面）／1–6（脚本面）条回执内，窗口口径没漏任何东西；差值非零只会来自"中间隔了别的事（读文件、改代码）才重发"那类轨迹，这一面没有。所以窗口取 6 还是取整尾，在这 107 份上读数是同一个数——**这条要重跑才能沿用**，换料面别抄。
口径 C 比 A/B 大得多（真 11、脚本 76），拆开看来源就知道它不能当"原地打转"用：真模型面 C＝read_file 5｜run_shell 4｜grep 1｜verify 1；脚本面 C＝read_file 58｜edit_file 8｜verify 6｜run_shell 2｜glob 2。`verify`/`propose_plan` 这类 args＝`{}` 或定值，"逐字同参"对它们是恒真——真模型面 A 里那条 `verify｜args="{}"`（repair-arm a/B2）就是这么进来的。

### (d) `apply_patch` 补丁不完整 与 `read_file` 文件不存在

| | apply_patch 判死 | 补丁不完整 | 头行不在段内 | read_file 判死 | 文件不存在或不可读 |
|---|---|---|---|---|---|
| 真模型面 | 2 | **1** | 1 | 1 | **1** |
| 脚本面 | 0 | 0 | 0 | 0 | 0 |

逐条都在真模型面：`bench-head-a/B10`（补丁不完整：hunk 声明 -1,7 +1,2，实收旧侧 6 行／新侧 1 行）、`bench-head-a/B12`（read_file: 文件不存在或不可读: src/m03-max.js，且同一份里另一条 apply_patch 头行不在段内）。
分母对照：全 107 份里 `apply_patch` 被调用 **10** 次（判死合计 2）、`read_file` 被调用 **551** 次（判死合计 1）。

## 4. 一句总评

真模型面上，(a) 值得做的部分只剩 **1 条**（触发 2 条里有一条 shell 自己已点名哪一段；占 16 条失败的 6%，且 2 条都在同一档 `bench-head-a`），(b) 是 **5/43 份轨迹＝12% 的整趟跑废**（写过盘后撞帽退出、一次验证拍都没收口，脚本面 0，代理 6/6 被 run.log/readings.json 证实），(c) 两个口径都是 **3 条**且 B−A＝0（窗口大小在本面不构成误差），(d) 是 **1＋1 条**（两面合起来 apply_patch 一共才叫 10 次、read_file 551 次里 1 条不存在）。
⇒ **(a)(c)(d) 都排不进优先级；只能做一件的话，做 (b)：把帽终那一拍变成收束（撞帽前/当场补一次验证拍或强制产出收束回执），它是唯一以"整趟任务损失"计价而不是以"单条回执文案"计价的格子。** 顺带登记两件事：`auto:true` 全仓 0 条 ⇒ (b) 的第三子句现在恒真、当不得筛子；帽值不进事件流 ⇒ 想要这一格能被纯流判出来，得先让跑器把 `maxSteps` 落到事件里。

## 5. 没跑出来／判不了的（如实列）

- **步数帽的字面读数**：流内 0 条 `maxSteps`／"强制中止"事件，帽终只能靠 §3b 的形状代理 ＋ [5] 的面外证人核对；没有"帽值"这一列。
- **自动验证拍的发生数**：`verify_result.auto===true` 全仓 0 条 ⇒ 这一格是"没有拍"，不是"拍是绿的"。
- **脚本面帽终的外部核对**：脚本面 64 份里 7 份（`fixtures/no-progress/*`）同级既无 run.log 也无 readings.json——但这一面帽终形状读出 0，没有需要核对的东西。
- **B 组（未做）**：本探针不改任何生产代码、不动判卷、不跑 git 写操作；`run_shell` 分档收口率那类"改动后应当变成多少"没有测——这里只有改动前的发生率。
- 旧表夸大的来源已定位并可复算：把 `fixtures/no-progress` 的剧本件与三档同题件混进一个分子（§0 与 §3a 的 5/7）。
