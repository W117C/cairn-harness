# 台账未闭工单清单（2026-10-05）

**取料面（读数可回查，全部现读，不引旧凭证）**

- 台账：`PROGRESS.md`（本 worktree 与工作树同为 13,766 行）；扫到的是 2026-10-04 起 63 页（自第 334 页)＋第 391 页「未闭问题收口」＋第 392—401 页全文。
- 码面：独立 worktree `/Users/ze/Downloads/Cairn/deepseek harness/.qoder/worktrees/agent-general-purpose-949ab72b/`，`HEAD = 77f9c754`（第 401 页那笔），工作树干净。
- 撞面：`git status --porcelain` 取**主树** `/Users/ze/Downloads/Cairn/deepseek harness/`（`HEAD` 同为 77f9c754，脏 41 支已跟踪＋若干未跟踪），并逐棵 `git -C .qoder/worktrees/*/ status` 取在飞面。
- 针脚体检实跑于本 worktree：`node --import tsx scripts/mutate-verify.mjs --check-needles`。
- 本清单**只读不改**：除本文件外未新增或修改任何文件（跑判卷时临时借过主树 `node_modules` 的软链，已删除）。

**一句话结论**：台账第 401 页给的「等业主的格」6 条全部对得上码面；但第 391 页那张「备妥待落」表已经过期 4 条——`#69`、`#71`、`#50` 其实**已落库**，`#67` 的**前置已解除**。这正是本会话重派两次的成因。

---

## 表：未闭工单（按盘上证据定状态）

| # | 一句话它在管什么 | 现在状态（盘上证据） | 缺的是裁决还是实现 | 会碰哪些文件（现读路径） | 撞面风险（此刻在谁手里） | 出处（页号） |
|---|---|---|---|---|---|---|
| `#69`／`#71`（同簇） | 撞 `maxSteps` 帽那条路也要留「验过／没验过」的证据；无进展阶梯 R1 要在生产里真开口 | **两半都已落库，第 391 页的「备妥待落」是过期话。** ①`src/agent/loop.ts:579` 现读 `if (step === maxSteps - 1 && sawToolCall)`，注释原文「#69：最后一步模型**仍在调工具**时，也让收束闸有机会留下证据」，落库笔 `5821de00`，判卷 `tests/loop-cap-verify-beat.test.ts:51` describe「撞帽路也要留证据（#69）」在库。②`src/agent/loop.ts:295` 注释原文「`no-progress.ts` 的**唯一生产消费者**（此前它全树零消费者，只在门里跑）」，落库笔 `c5ab9cad`，判卷 `tests/loop-no-progress.test.ts` 在库。③`goal_stopped` 那半（第 389 页）也在库：`tests/goal-stopped-on-throw.test.ts`。**残下来的只有一件事**：`.worktrees/verify-c7f2ea0f` 里那 9 项**基线是 `c7f2ea0f`（第 357 页，早于 HEAD 两天）**，其中 `tests/cap-hit-verify.test.ts` 与已入库的 `tests/loop-cap-verify-beat.test.ts` **同题两作** | **实现**（先重验「还剩哪几格真没落」再动手，别整簇并回）＋**裁决**（`#71` 的冻结登记：现读 `scripts/frozen-sha256.json` 里 `synth-red-repeat*` 命中 **0 条**，`tests/cap-hit-verify.test.ts` 不在库；这一步本仓写明只能人做） | `src/agent/loop.ts`、`src/agent/no-progress.ts`、`src/tools/run_shell.ts`、`scripts/frozen-sha256.json`、`tests/loop-cap-verify-beat.test.ts` | 主树这 4 支全 **clean**；但 `src/agent/loop.ts`＋`src/agent/no-progress.ts` 在 worktree `agent-general-purpose-6e462e1c` 里**正在飞**（`#93`）⇒ **并这一簇必撞它** | 361／363／364／389／**391**（过期处） |
| `#50` | 锚点债：`--check-needles` 的阻断数要归零 | **已清，第 391 页那句过期。** 本 worktree HEAD 77f9c754 现读：`针脚体检：1468 条 —— 阻断 0，待复认 2，未覆盖 1，逐行式 5，未入库面 0，钉在飞文本 0，killer 指针失效 0（其中 HEAD 侧 0）`，`改法语法体检：1468 条改法全部产出合法源文件 ✅`。第 391 页写的是「现读 1447 条，阻断 4 全是本轮未入库面，提交后复跑」——那 4 条随本轮落库已归零。**残留的 待复认 2／未覆盖 1／逐行式 5 是基线**，第 401 页已声明「四笔一根也没推高」 | 都不是：这一格可按**终态（已闭）**收口，只需补一笔指针 | `scripts/mutate-verify.mjs`（只读，不改） | `scripts/mutate-verify.mjs` 主树 **clean** | **391**（过期处）／398／401 |
| `#58` 第三格 | lsp 信任门的最后一环：`decideLspConfigTrust` 要有产品调用方 | **缺口证实，且第二半确实在库。** `grep -rn decideLspConfigTrust` 全仓只命中定义 `src/tools/lsp.ts:143`、注释 `src/tools/lsp.ts:110`（原文「产品路径不调它——产品路径要么经用户授权，要么被拦」）与 `tests/lsp-trust-gate.test.ts` 五处调用 ⇒ **零产品调用方**成立。门本体是**真门**不是话：`src/tools/lsp.ts:402`「fail-closed：pending 与 declined 都**不起进程**」在 `:431 spawn(server.command, …)` 之前，`:136` 取不到指纹即 `pending` | **裁决**（接到宿主批准流＝扩范围，第 391 页自己写了「登记不擅自施工」）；批了才是实现 | `src/tools/lsp.ts`、`src/main/ask-gate.ts`、`src/main/verify-trust-gate.ts`（可复用的那只问人形状）、`src/main/agent-runner.ts` | 除 `src/main/agent-runner.ts` **主树脏**（M）＋另在 4 棵 worktree 在飞（`06773eec`／`a1d1112f`／`a5ad4370`／`ee2b5204`）外，其余三支 **clean** | 391（第 3、5 条）／394 |
| `#67` | `apply_patch` 撞 CRLF 时的中间路：比较时剥 `\r`，命中后按行写回**原字节** | **未实现，但前置已解除——两处页面话与码面不符。** ①**没实现**：`src/tools/apply_patch.ts` 现读 `\r`／`CRLF`／`行尾` 命中 **0 处**。②第 391 页把它写成「待与别人的 **run_shell** 判卷对齐」，而 `#67` 本体按第 358／360 页的定义是 `apply_patch` 的**行尾**判卷，与 run_shell 无关。③第 360 页当时的拦路理由是「那支判卷现读**未跟踪、HEAD 里没有**⇒ 不能拿它当证人」——它**现在已入库**：`tests/apply-patch-lf-shapes.test.ts` 被跟踪且干净，`:14`／`:75` 两处注释把「不整文件剥 `\r`」的理由钉成判据 | **实现**（前置那句已作废；对齐点变成「改承诺面要同笔动那支已入库判卷」） | `src/tools/apply_patch.ts`、`tests/apply-patch-lf-shapes.test.ts` | **两支都 clean**（主树与全部 19 棵 worktree 都没人碰 apply_patch 这一面）⇒ 本轮**最干净的可施工面** | 358／360／**391**（误标处） |
| `#70` | 基准提示面自己教模型「改完 verify」，缺一个不教它的档位 | **缺口证实。** `src/agent/system-prompt.ts:29` 现读纪律 5「修改完成后调用 verify 跑测试」就在 `BASE_SYSTEM` 里；全仓没有第二份「不教 verify」的基准提示面。⇒ 第 362 页那个「翻默认有没有用」的量法永远带着自我实现的答案 | **裁决**（加一档＝改基准输入面，现存的留档读数全部要标「改前／改后面」，跨 run 不可比） | `src/agent/system-prompt.ts`、`scripts/loop-eval.ts`、`scripts/ga-strategy.ts`、`scripts/gate-check.ts` | `src/agent/system-prompt.ts` 主树**脏**（M，隔壁在飞）；三支脚本主树 **clean** | 362／367／391 |
| `#72` | 同一句身份行被抄在六处，其中五处还写着「桌面编程 agent」 | **漂移仍在盘上，且与既有裁决互相打脸。** 产品侧已改对：`src/agent/system-prompt.ts:23` = 「你是编程 agent：在指定工作区内读代码…」。 harness 侧**五处逐字仍是「桌面」**：`src/agent/gym/runner.ts:40`、`scripts/gate-check.ts:235`、`scripts/ga-strategy.ts:144`、`scripts/loop-eval.ts:102`、`scripts/autonomy-check.ts:360`。而 `docs/adr/0001-core-only-vs-desktop.md` 的裁决是「桌面层不作 v1 交付面」⇒ 基准与门现在**喂给模型的自我认定**与裁决不符 | **裁决**（单源化 vs 跨 run 读数可比性，第 367 页第 6 条列的两种修法与代价仍未拍）。纯措辞那一小刀不必等：它不改档位结构 | 同 `#70` ＋ `src/agent/gym/runner.ts`、`scripts/autonomy-check.ts` | `src/agent/system-prompt.ts` 主树**脏**；其余四支 **clean** | 367／391 |
| `#87`／`#88`／`#89`（一批三支） | 工具参数面缺三把：`read_file` 无 tail、`grep` 无 `--glob`／`files_with_matches`／`count`、超长行中段不可达 | **仍未实现，且前置第 391 页根本没重述。** ①`src/tools/read_file.ts:113-117` 现读只有 `offset`／`limit`，无 tail。②`src/tools/grep.ts` 现读参数只有 `pattern`／`path`／`context`／`type`，`glob`／`files_with_matches`／`output_mode` 命中 **0**。③第三格：`src/agent/glm-session.ts:66-79` 现读 `read_file` 申报的参数只有 `path`／`offset`／`limit`（全是**行号**维），没有任何字节／列窗口 ⇒ 一条比帽还长的单行，模型拿到的仍是首段，中段不可达这一格没变。④前置**依旧成立**：参数说明的那份事实源就是 `src/agent/glm-session.ts:71`／`:75`（`read_file` 的 description 与 `offset` 说明都在那儿），而该文件**主树脏（M）** ⇒ 第 381 页那句「规格面在隔壁手里」到今天没变 | **实现**，但被**文件归属**卡住（不是裁决）⇒ 等 `src/agent/glm-session.ts` 让位 | `src/agent/glm-session.ts`（规格事实源）、`src/tools/read_file.ts`、`src/tools/grep.ts` | `src/agent/glm-session.ts` 主树**脏**（M）＝正主在飞；两支工具文件 **clean** | 381（第 6 条）／391 **未收录** |
| `#93` | loop 侧的 verify 归因计数：被拒／环境拍不许记成代码红、不许烧模型修复额度 | **在飞，成品不在 HEAD。** `src/agent/loop.ts:221-222` 现读只有 `cause` 与 `isEnvVerifyCause` 那**一档**（来自 2026-09-23 的 `ca2e6b0d`，属既有面，不是本笔）；三档分账的成品在 worktree `agent-general-purpose-6e462e1c`（`src/agent/loop.ts`＋`src/agent/context.ts`＋`src/agent/no-progress.ts`＋未跟踪的 `tests/loop-verify-cause-accounting.test.ts`） | **实现**（别人正在做）⇒ **别重派** | `src/agent/loop.ts`、`src/agent/context.ts`、`src/events/index.ts` | `src/agent/loop.ts` 主树 clean 但**被 6e462e1c 占着**；`src/events/index.ts` clean（worktree `2d126352` 也在碰 `src/events/index.ts`） | 381／397／401（第 5 条） |
| `#99` 另一半 | `sed -i`／`tee`／`dd of=` 就地覆写也要留覆盖前原件；以及「还原」那一半 | **在飞，成品不在 HEAD。** `src/tools/snapshot.ts:112` 现读只有 `redirectWriteTargets`（重定向），第 388 页第 6 条自己写明的两格（不认就地覆写、没做还原）都没变。成品出现在**两棵** worktree：`07475095`（`src/tools/run_shell.ts`＋`src/tools/snapshot.ts`＋`src/agent/worker-shell-tools.ts`）与 `d999d8d2`（同两支＋已改过的 `tests/shell-redirect-snapshot.test.ts`）⇒ **同题两作，形状与 `#69`/`#71` 那次一样** | **实现**（两棵树里已有一份）⇒ **别重派；先并冲突** | `src/tools/snapshot.ts`、`src/tools/run_shell.ts`、`src/permissions/command-shape.ts`、`src/permissions/rules.ts` | 三支工具/权限文件主树 **clean**，但被上面两棵 worktree 占着 | 388／397／401（第 5 条） |
| `#102b` | 被拒／环境那两拍到底要不要让 CLI 退非零 | **归类与码面一致：确是裁决。** `src/cli.ts:151-159` 把「不改」的理由写进了源码注释：「**分档只改读数，不改退出码契约**…想裁『被拒/环境该不该让 CI 失败』是另一个工单，需要的是 README 那句退出码定义一起改」，`src/cli.ts:173-174` 现读 `runFailed` 仍把 `verifyBlockedBeats`／`verifyEnvBeats` 都算红 | **裁决**（且必须连 README 的退出码定义一起改，不能只改码） | `src/cli.ts`、`README.md`（「## 退出码」在第 315 行）、`src/agent/tool-choice.ts` | `src/cli.ts`、`src/agent/tool-choice.ts` **clean**；`README.md` 主树**脏**（M，隔壁在飞） | 392（第 2 条）／394／401（第 4 条） |
| `#106` | 派工前先查重：同一题不许派第二遍 | **零机制。** 全仓 `grep 查重|dedup|在飞` 在 `src/agent/spawn-surface.ts`／`src/agent/orchestrator.ts` 命中 **0**；代价本段已实测付过——第 392 页第 5 节 A／B 两簇各回来一份完整实现，第 394 页第 7 节 `#90` **同题三作**（第三份还在 `agent-general-purpose-6ad1f717` 里没并）。⇒ 「等业主」这一格里它其实**一半是流程、一半是码** | **裁决**（什么算同一题）＋**施工面未定** ⇒ 文件路径**无从判** | 无从判：现有码里没有「派工面」这一层（`src/agent/spawn-surface.ts` 只管 `spawn_agent` 的参数形状，不管跨会话查重） | 无从判（无既定落点） | 392（第 5 节）／394（第 7 节）／401（第 4 条） |
| `#107` | runner 级 worker 侧的 `trustResolver` 传参没有判卷，于是第三根 A 组锚点此刻写不得 | **缺口证实，但归类与第 401 页不符：它缺的是实现，不是裁决。** `src/main/agent-runner.ts:367` 现读 `...(trust.verifyTrust ? { trustResolver: trust.verifyTrust } : {})` 把同一个 resolver 递给 `workerVerify`；`grep -rn trustResolver tests/` 只命中 `tests/verify-trust-fingerprint.test.ts`（第 172、185、194… 行）——那些格**直接调 `createVerifyHook`**，走不到 runner 那一站。⇒ 第 392 页第 8 节自己写的是「补 runner 级 worker 那一格之后才配第三根 A 组针脚」，那是**写判卷**；第 401 页把它挪进「等业主的格」是归类升错 | **实现**（一支 runner 级 worker 判卷；批不批锚点另说，判卷本身不越范围） | `src/main/agent-runner.ts`、`tests/verify-trust-fingerprint.test.ts`、`tests/cascade-wiring.test.ts`（`workerVerify` 的既有喂法） | `src/main/agent-runner.ts` 主树**脏**（M）＋4 棵 worktree 在飞 ⇒ **这是全表撞面最狠的一支**；两支判卷文件 **clean** | 392（第 8 节）／394／401（第 4 条，归类不符） |
| `#108` | 逐靶翻转 ≥1 时，「净值涨了几分」这句话许不许出口 | **只印不拦，证实。** `scripts/eval/report.ts:436` 现读打印 `逐靶比较 N 个共同靶，flips: X（翻转靶：…）`，全段没有任何出口闸；动机是第 390/391 页那个读数——同一装配跑两遍，12 靶里 3 个自己翻面 | **裁决**（加不加拦是裁决不是施工；第 394 页第 7 条原文） | `scripts/eval/report.ts`、`src/agent/eval/`、`tests/eval-report.test.ts` | `scripts/eval/report.ts` 主树**脏**（M）＋两棵 worktree 在飞（`6ad1f717`、`8d9922a1`，后者正改 `tests/eval-report.test.ts`） | 394（第 7 条）／401（第 4 条） |
| `#109` | `bench` 四条都不带 `--keep` ⇒ 基准失败轨迹进不了 `gym-draft`（能力 10 断料） | **证实，而且开关本来就有。** `package.json` 第 53／55／56／57 行现读四条 bench（`bench`／`bench:long30`／`bench:chain32`／`bench:chain48`）**均无 `--keep`**；`scripts/loop-eval.ts:554` 现读 `if (argv.includes("--keep"))`——旗在，只是没人带。⇒ 不是缺实现，是缺一个成本决定：留档每臂 ≈0.2 MB、`--reps 6` ≈1.2 MB，会吃 `repo-hygiene-check` 那条 outputs 占比帽 | **裁决**（开关值 ≈1.2 MB/臂，不是免费） | `package.json`、`scripts/loop-eval.ts`、`src/agent/gym/draft.ts` | **三支全 clean**（主树脏的是 `apps/desktop/package.json`，与根 `package.json` 不同文件） | 394（第 7 条）／401（第 4 条） |
| `#110` | 桌面/渲染层的审批卡有没有「看得见自己批的是什么」的证人 | **证实，且比页面说得更硬。** `scripts/probe-promise-recall.ts:90` 现读 `export const UI_ROOTS = ["src/renderer/", "src/preload/"]`，而 `ls` 实测这两目录 **HEAD 上都不存在**；`:124` 那条 `UI_ROOTS.some(relFile.startsWith(root))` 因此**恒不命中** ⇒ 这张排除表是空取料。真 UI 在 `apps/desktop/src/renderer/`（存在），而根门与 CI 都不扫 `apps/`（AGENTS.md 明文）。同族形状第 392 页第 9 条已记过一次（「空取料，读数恒 0 不是没问题」） | **裁决**（给桌面配证人＝要么扩根门取料面、要么违 ADR-0001＋AGENTS.md）；**但其中一小刀是纯实现**：把空取料改成**出声**（点名「UI_ROOTS 一支都不在盘上」），不改范围、不动 `apps/` | `scripts/probe-promise-recall.ts`、`scripts/prose-needle-scan.ts`（同族取料面）、`docs/CODE-WIKI.md` | `scripts/probe-promise-recall.ts` **clean**；`apps/desktop/src/renderer/` 主树**脏**（10 支文件 M）＝桌面会话正握着 | 392（第 9 条）／400（第 6 条）／401（第 4 条） |
| `A7`／`W4` | `src/main/agent-runner.ts` 的体量帽与「W4 落地后逐档降帽」那条阶梯 | **余量已从 51 行缩到 30 行。** 现读 `wc -l src/main/agent-runner.ts` = **2970**，帽 `SRC_FILE_LINE_CAP = 3000`（`scripts/repo-hygiene-check.ts:67`）。第 391 页那句「2849 行、帽 2900、余量 51」已被第 394 页的抬帽**作废**（`2462e89d` 加了 132 行推过 2900）。阶梯也被现读证伪：`scripts/repo-hygiene-check.ts:101` 注释原文「W4 落地那一刻这顶帽要一次性跨两档（3000 → 2600 → 2400 中间那一档没有落点）」；W4 拆分**至今没人做** | **裁决**（跨几档、在哪个独占窗口做）＋一次真重构（第 383 页量过：`M4a 调度器` 35 条针脚不能动，sidechat 那段依赖 7 个模块级状态） | `src/main/agent-runner.ts`、`scripts/repo-hygiene-check.ts`、`tests/`（该文件 52 条针脚） | `src/main/agent-runner.ts` 主树**脏**＋4 棵 worktree 在飞＝**本轮最抢手的在飞面**；`scripts/repo-hygiene-check.ts` **clean** | 383／391（第 6 条，数已过期）／394 |

---

## 页面与码面不一致的地方（本清单最有用的那一格）

1. **`#50` 已闭，台账还说它「备妥待落」。** 第 391 页第 5 条：「`#50`（锚点债：现读 1447 条，阻断 4 全是本轮未入库面，提交后复跑）」。盘上现读（HEAD 77f9c754 实跑）：`针脚体检：1468 条 —— 阻断 0 … killer 指针失效 0`。**引用**：`scripts/mutate-verify.mjs` 的 `--check-needles`。**后果**：谁照第 391 页派「清锚点债」，会重做一件已完成的事。
2. **`#69`／`#71` 已落库，台账还说它们在隔离树里「可并入」。** 第 391 页第 5 条：「备妥待落：`#69`／`#71`（9 项在 `.worktrees/verify-c7f2ea0f`…前置 `src/agent/loop.ts` 现读**不在**在飞清单 ⇒ 可并入）」。盘上：`src/agent/loop.ts:579`（注释自认 `#69`）与 `src/agent/loop.ts:295`（注释自认 no-progress 的唯一生产消费者）都已在 HEAD，判卷 `tests/loop-cap-verify-beat.test.ts`、`tests/loop-no-progress.test.ts` 都在 HEAD；那棵隔离树的基线是 `c7f2ea0f`（第 357 页，早于 HEAD 两天），且它的 `tests/cap-hit-verify.test.ts` 与已入库那支**同题**。**「可并入」是错的**：整簇并回＝第三次同题两作，而且 `src/agent/loop.ts` 此刻被 `agent-general-purpose-6e462e1c` 占着。
3. **`#67` 的前置已解除，且第 391 页认错了对象。** 第 391 页：「`#67`（待与别人的 **run_shell** 判卷对齐）」；第 360 页原文的前置是「隔壁今天写的那支判卷**还没入库**（未跟踪态，HEAD 里没有 ⇒ 本页不拿它当证人）」。盘上：`#67` 按第 358／360 页定义管的是 **`apply_patch` 的行尾**，而那支判卷 `tests/apply-patch-lf-shapes.test.ts` **现已入库且干净**。⇒ 状态从「等对齐」变成「现在就能做」，但台账里没人更新它。
4. **`#107` 被归错了层。** 第 392 页第 8 节：「补 runner 级 worker 那一格**之后**才配第三根 A 组针脚」＝写判卷；第 401 页第 4 条把它列进「**等业主**的格…它们缺的是**裁决**，不是实现」。盘上：`src/main/agent-runner.ts:367` 那行传参确实零判卷（`grep -rn trustResolver tests/` 只命中直接调 `createVerifyHook` 的那些格）。⇒ 缺实现，不缺裁决。
5. **`#72` 说「等裁决」，但它与一条已生效裁决直接冲突。** 第 391 页把 `#72` 归为待业主（理由是跨 run 可比性）；而 `docs/adr/0001-core-only-vs-desktop.md` 已 **Accepted**：桌面不作 v1 交付面。盘上 `src/agent/gym/runner.ts:40`、`scripts/gate-check.ts:235`、`scripts/ga-strategy.ts:144`、`scripts/loop-eval.ts:102`、`scripts/autonomy-check.ts:360` 五处喂给模型的自我认定仍是「桌面编程 agent」。⇒ 纯措辞那一刀不需要新裁决；需要裁决的只是「单源化会不会让基准读数不可比」。
6. **第 391 页的两组数已被第 394 页作废，但第 391 页没有回改标记。** 页面：「现读 `src/main/agent-runner.ts` **2849 行**、帽 2900 ⇒ 余量仅 **51 行**」。盘上：**2970 行**、帽 **3000**（`scripts/repo-hygiene-check.ts:67`）⇒ 余量 **30 行**。
7. **页号本身有撞面，按页号引用会指错。** `grep` 实测 2026-10-05 的页标题：`第 392 页` 出现 **2 次**（第 392 页「能力 5 断掉的那条链」与第 392 页「终局认证」），`第 394 页` 出现 **2 次**（「干净树杀锚点」与「agent-runner 推过帽」）。第 397 页第 5 ① 只把**自己**那页重编成 394，没动这两对。⇒ **本表引用页号时一律配 sha**（`5821de00`／`c5ab9cad`／`ca2e6b0d`／`c7f2ea0f`／`77f9c754`）。
8. **`BLOCKED.md` 那条无编号未闭项仍然没闭，而且是颗哑弹。** 页面请求：把 `tests/map-self-report.test.ts:95` 的 `toContain("rg")` 换成「原因非空且可辨」的断言（判据缺陷 ⇒ 换判据，不改码）。盘上：该行**逐字未改**，`src/agent/map/build.ts:231` 的 `why.slice(0, 200)` 截断也还在。它**在本 worktree 是绿的**（实测 `Test Files 1 passed (1)｜Tests 4 passed (4)`，因为借来的 `node_modules` 路径短）——红不红取决于 checkout 前缀长度，深路径嵌套 worktree 必红。⇒ 一条只在别人树上咬人的尺。
9. **无从判的两格**：① `#106` 的落点（本仓没有「派工面」这一层码，`src/agent/spawn-surface.ts` 管的是参数形状不是跨会话查重）；② 隔壁会话是否已经把 `src/agent/evolution/`＋`tests/evolution.test.ts`（主树新未跟踪）当成正式工单——它在 2026-10-04 起的台账里**零次出现**，我不给它编号。

---

## 我建议的下一批施工顺序

前置纪律：**每条开工前先重跑 `git status --porcelain -- <该条文件>` 现读归属**，主树或任一 worktree 脏就不动刀（第 391 页第 2 条立的就是这条契约）。

1. **`#67` — `apply_patch` 的 CRLF 中间路**（第一顺位）
   - 为什么动的是 agent 的真行为而不是尺：模型今天对 CRLF 文件打补丁会**整份被拒**（`src/tools/apply_patch.ts` 零行尾处理），要么它退化成 `write_file` 整文件重抄——正是 `src/agent/system-prompt.ts` 纪律 3 明令禁止的那个动作。改完是「一次调用改一行，其余行的行尾一个字节都不动」。
   - 爆破半径：**2 支文件，全干净**（`src/tools/apply_patch.ts`＋`tests/apply-patch-lf-shapes.test.ts`），无跨面依赖，不碰 `agent-runner.ts`。
   - 落了的证据：新格断言 CRLF 文件打补丁**成功**且未改动行 `toBe("line one\r\nline two\r\n")` 逐字节原样（现有 `:80` 那条只断「被拒时行尾不改」，形状不同）；一台造红＝按行写回时改成整文件 LF ⇒ 恰红这一条；`--check-needles` 阻断仍 0。

2. **`#110` 的出声那一小刀 — `scripts/probe-promise-recall.ts` 的空取料点名**
   - 为什么算真行为：它不改范围，但把「UI 面承诺永远 0 条」这把**恒真读数**变成会点名的读数；仓里已有同族判据可对齐——`scripts/prompt-surface-check.ts:3` 与 `scripts/model-surface-check.ts:13` 都写着「取料面为空直接红（真空通过是本仓最忌的假绿）」，而 `scripts/probe-promise-recall.ts:90` 那张 `UI_ROOTS` 表正是**取料面为空却照样绿**的那一格。它挡住的正是下一次有人把「0 条 UI 承诺」当成「UI 没问题」。
   - 爆破半径：**1 支脚本，干净**；不动 `apps/`、不动根门集合（AGENTS.md 的「root gates never scan `apps/`」不动）。
   - 落了的证据：现跑 `scripts/probe-promise-recall.ts` 打印出一行点名「`UI_ROOTS` 两支目录都不在盘上」；造红＝把目录名改回存在的路径 ⇒ 该行消失，改松判据（只 warn 不点名）⇒ 判卷红。

3. **`#107` — 补 runner 级 worker 的 `trustResolver` 判卷**（先确认没人和你撞）
   - 为什么算真行为：`src/main/agent-runner.ts:367` 那行是「worker 侧要不要问人」的唯一通路；它零判卷意味着**把它摘掉今天没有一条用例会红**——自动验证在 worker 那条路上可以静默退化成常量 `false`（正是第 392 页 A 组刚修完的那个洞的姊妹格）。
   - 爆破半径：只加判卷（`tests/verify-trust-fingerprint.test.ts` 或 `tests/cascade-wiring.test.ts` 邻位），**不改生产码**；但 `src/main/agent-runner.ts` 是全表最脏的一支（主树 M＋4 棵 worktree 在飞）⇒ **开工前必现读**，且宜等 `#93`／A 组那几笔收口。
   - 落了的证据：新格在干净树里当得住一根真锚点（`git checkout` 后摘掉 `:367` 那行 ⇒ **恰红这一条**），并把 A 组第三根针脚从「写不得」变「可写」。

4. **`#72` 的措辞那一刀（不动单源化形状）**
   - 为什么算真行为：这五串是**真喂给模型的 system 面**（`scripts/loop-eval.ts`／`scripts/ga-strategy.ts`／`scripts/gate-check.ts`／`src/agent/gym/runner.ts`／`scripts/autonomy-check.ts`），模型按它认定自己的交付面；ADR-0001 已裁决「桌面不作 v1 交付面」，这是执行既有裁决而不是新裁决。
   - 爆破半径：5 支脚本文件，全 clean；**风险在读数可比性**——`scripts/loop-eval.ts` 与 `scripts/ga-strategy.ts` 一变，留档的基准/策略读数就分「改前／改后面」⇒ 落笔前要在同一页写明这点，别偷偷换分母。
   - 落了的证据：`grep` 现读「桌面编程」在 `src/`＋`scripts/` 命中 **0**；`tests/base-system-discipline.test.ts:22` 那条「身份行没有旧品牌串、也不自称桌面」（`:25-26` 逐字 `not.toContain("M0")`／`not.toContain("桌面")`）只钉产品侧那一份，改完它仍须绿——它现在管不到这五处 harness 面，这正是 `#72` 单源化要不要一并收的口径差。

5. **`#69`／`#71` 的**残格**重验（只此一件，不整簇并回）**
   - 为什么还要动：隔离树里唯一还没落的两格是 `run_shell` 分段回执与那 2 支未登记 fixtures；其余已被 HEAD 覆盖。先**逐格现读**再决定，否则会第三次同题两作。
   - 爆破半径：`src/agent/loop.ts`（被 `agent-general-purpose-6e462e1c` 占）＋`src/tools/run_shell.ts`（被 `07475095`／`d999d8d2` 占）⇒ **两条都在别人手里**，本条排最后，且大概率只能做成「给业主的一张冻结登记单」而不是施工。
   - 落了的证据：若真并，先证明新判卷与 `tests/loop-cap-verify-beat.test.ts` 不同题（两支 describe 标题逐字不同、用例不重叠），再由业主在 `scripts/frozen-sha256.json` 登记 3 个新面（现读 `synth-red-repeat*` 命中 0）。

**不建议现在派的**：`#93`、`#99` 另一半（成品已在别人的隔离树里，第 401 页第 5 条已声明在飞）、`A7`／`W4`（真重构＋独占窗口，且 `src/main/agent-runner.ts` 正在被四个会话改）、`#102b`／`#108`／`#109`／`#70`／`#106` 与 `#58` 第三格（缺的是裁决，码面上今天没有一道门因它们而红）。

---

## 并回注记（2026-10-06 第 403 页，主树）

- **这份清单原本躺在子代理的隔离树里没并回**：`outputs/ledger-open-items-2026-10-05/` 在 `agent-general-purpose-949ab72b` 是**未跟踪**状态，主树既没有它也没有引用它的页面。⇒ 它的所有读数当时**不可回查**（D-9 那格的成因）。现在把它放进主树并随第 403 页一起入库。
- **它写于 HEAD `77f9c754`（第 401 页那笔），本并回发生在 `31829658`（第 402 页）之上**：中间隔了一笔，而 `#109` 的改动又落在它引用过的 `scripts/loop-eval.ts` 上 ⇒ **两处行号已下移**，正文保持原样（那是当时的取料面），现读如下：
  - `--keep` 旗标：原引 `:554` ⇒ 现读 `scripts/loop-eval.ts:79`（`const KEEP_ALL = argv.includes("--keep")`）。
  - 身份行：原引 `:102` ⇒ 现读 `scripts/loop-eval.ts:110`（那句仍自称「桌面编程 agent」，`#72` 的读数和结论不变）。
- **`src/main/agent-runner.ts` 的行数要分面读**：清单里那句「2970 行」取在 `77f9c754`；主树现读 **3011 行**（隔壁在飞的自进化那一段 hunk 把它推过了 `SRC_FILE_LINE_CAP = 3000`）。⇒ 帽不是被我抬的，也不是本簇动的；这一格属于「等让位」，不属于「等裁决」。
- **本清单的第 1／2／3／4 条过期处，业主已在 2026-10-05 的卡片上答过其中四格**（`#102b` 保持现状、`#66` 只补装配那一半、`#110` 不纳桌面、`#108` 维持只印不拦），正文见第 403 页。清单里剩下的真待决格：`#58` 第三格、`#70`、`#72` 单源化、`#106`、`A7`／`W4`。
