# 第 392 页取料：四簇并回与两处「同题两作」的处置（2026-10-05）

本页代码与判卷来自并行子代理。本目录登记的是**取料面**——哪些实现进了树、哪些没有、为什么。

## 一、四簇清单（并回面＝主树工作树，基线 `95e0b96c`）

| 簇 | 落地的实现 | 落地的判卷 | 树来源 |
| --- | --- | --- | --- |
| A verify 信任门（业主裁决「指纹＋首次问人」） | `src/agent/verify-trust.ts` ＋`src/agent/verify.ts` ＋`src/main/verify-trust-gate.ts`（新）＋`src/main/agent-runner.ts` ＋`src/agent/plugins/index.ts` | `tests/verify-trust-fingerprint.test.ts`（21 格） | `agent-general-purpose-ee2b5204` |
| B `#102` 计数读归因 | `src/cli.ts` ＋`src/agent/tool-choice.ts` | `tests/verify-count-by-cause.test.ts`（21 格） | `agent-general-purpose-6343e288` |
| C 定时五件按需挂载 | `src/main/agent-runner.ts`（`automationsScheduled`／`installTimeAutomationFace`／`automationArmedOnce`） | `tests/automation-mount-conditional.test.ts`（16 格） | `agent-general-purpose-a5ad4370` |
| D `#90` 评估身份键与逐靶配对 | `scripts/eval/report.ts` ＋`scripts/loop-eval.ts` | `tests/eval-report.test.ts` ＋`tests/loop-eval-invocation-face.test.ts` | `agent-general-purpose-8d9922a1` |

并回方式：`git -C <树> diff -- <逐文件路径> > /tmp/merge-391/<簇>.patch` → 主树 `git apply --3way`，未跟踪新文件 `cp` 后逐条核字节。
四个补丁全部 `Applied … cleanly`，`grep '^<<<<<<<'` 在 `src/ scripts/ tests/` 命中 **0**。

## 二、两处「同题两作」——重复派工的代价与取舍依据（不是运气）

上下文压缩后我按「仍在跑」的记录重派了 A 与 B 两簇，结果**两簇各来了两份成品**：

| 簇 | 第一份（压缩前派） | 第二份（压缩后重派） | 取哪份 ＋ 依据 |
| --- | --- | --- | --- |
| A | `ee2b5204`：21 格，含**键域标签** `#verify` 与 `trustFilePathOf` 路径单点化 | `06773eec`：18 格，判卷逐字照抄契约文件；路径在 agent-runner 里另算一遍 | 取 `ee2b5204`。两条硬理由：① 无标签时 `TrustStore.hit` 那条**明文备案的裸路径兼容**（给插件历史留的）可以顺带免掉「执行仓库自带命令」那一问；② 路径算法出现第二处＝本仓零容忍的「第二份事实源」 |
| B | `6343e288`：三档计数＋**退出码契约逐字保留**，并写明保留理由 | `e300d437`：三档计数＋**改掉退出码**（环境拍不再置红） | 取 `6343e288`。这不是「谁更严」的取舍：`runFailed`（`src/cli.ts:159`，出口在 `src/cli.ts:1222`）是**用户可见契约**，两份读到的事实相同（同一因在两路上会异果——手动拍另有一条 `tool_result{ok:false}` 走 `plainToolFailures`），改不改属裁决，不属施工。第二份的口径登记为 `#102b` 等业主 |

**这条要记的形状**：重派前没有现读「哪棵树里已经有这支的在飞工作」。两次重复派工＝两份完整实现被丢弃一份，而第一份并不比第二份差（它只是先跑完）。
按本仓「重复疏忽要搬进工具」那条，收手机械化的正解是让**派工面**自己记下那一格（派工前先 `git worktree list` ＋逐棵 `status --porcelain` 问「这题有没有人已经在做」）；本轮先把依据落在本页，工具化留下一格（见 `#106`）。

## 三、A 簇补的那一环为什么是能力 5 的断点（现读，不是推断）

装配点写的是常量：`trustedRepo: opts.trustedRepo ?? false`（三处），生产入口没有任何一条路能把它置真
⇒ `createVerifyHook` 的 `surface()` 恒 false ⇒ 缺省开着的自动验证拍**整段跳过**
⇒ 48 份归档轨迹里 `verify_result{auto:true}` **0 条**。判卷 ⑦ 那三格跑的是 runner 级生产装配，
它是「常量 false 时代永远到不了这里」这一句的证人——不是单元级手搭 outcome。

## 四、本轮新增变异锚点（15 根，与实现同笔）

| id | 被测面 | 针脚（盘上唯一命中） | killer 用例标题 |
| --- | --- | --- | --- |
| `verify-trust-table-never-consulted` | `src/agent/verify.ts` | `if (await resolver.isTrusted(req)) return …trusted: true });` | 批准过一次之后，全新钩子＋全新信任表实例读同一份文件 ⇒ 零新卡且仍然真跑 |
| `verify-face-asked-twice-per-beat` | `src/agent/verify.ts` | `if (alreadyAsked.has(fingerprint)) return …` | 同一次 run 里同一面只问一次：自动拍的 surface() + run() 不出两张同样的卡 |
| `verify-fingerprint-blind-to-test-bucket` | `src/agent/verify-trust.ts` | `test: config.test ?? [],` | 改过 test 命令之后同目录再问一次，且新面没批过就跑不起来 |
| `verify-trust-key-tag-dropped` | `src/agent/verify-trust.ts` | `return repoDir + VERIFY_TRUST_KEY_TAG;` | 旧版插件信任留下的**裸路径**条目顶不掉这一门（键域标签不是装饰） |
| `trust-file-path-recomputed-at-call-site` | `src/agent/plugins/index.ts` | `return opts.trustFile ?? join(…);` | 那张批准落在**插件信任那一份文件**里（一把表两个门；没有 M2E_TRUST_FILE 时走 pluginDataRoot） |
| `verify-card-non-approval-grants` | `src/main/verify-trust-gate.ts` | `if (r.outcome !== "approved") return false;` | 首次那张卡被拒 ⇒ 那一拍不发生（不假绿也不假红）、命令没跑、条目没写 |
| `verify-unattended-emits-a-card` | `src/main/verify-trust-gate.ts` | `if (deps.askGate === null \|\| deps.unattended === true) return false;` | 无人值守那道闸住在这一门里：门被配成可答的交互门也不发卡、不悬等、不记账 |
| `runner-leaves-verify-trust-unwired` | `src/main/agent-runner.ts` | `trustResolver: verifyTrust, // 生产那一半` | 首次那张卡被批准 ⇒ 那一拍真发生且仓库自带的命令真跑（常量 false 时代永远到不了这里） |
| `cli-verify-beat-charged-before-cause` | `src/cli.ts` | `…!e.ok) tallyVerifyBeat(verifyBeats, e.cause);` | CLI：skipped 拍不置红，只加被拒档 |
| `cli-cause-classification-rehardcoded` | `src/cli.ts` | `if (!isEnvVerifyCause(cause)) {` | 未归因（cause 缺席）按 code 算——两处都不许把它当成环境拍 |
| `tool-choice-blocked-bucket-collapsed` | `src/agent/tool-choice.ts` | `else if (e.cause === "skipped") out.verifyBlocked++;` | tool-choice：skipped 拍不进 verifyFailures，只加 verifyBlocked |
| `automation-face-latch-removed` | `src/main/agent-runner.ts` | `return installed ? installedAutomation : automationArmedOnce;` | 第一场假 ⇒ 执行面定终身：第二场盘上有了任务也不许翻（不抛、不「看得见调不到」） |
| `automation-judgement-blind-to-disk` | `src/main/agent-runner.ts` | `if (!automationArmedOnce && await automationsScheduled(workspace)) …` | 盘上有任务：判据真 ⇒ 面上五件按 AUTOMATION_TOOLS 声明序齐全 |
| `eval-run-identity-keys-rehardcoded` | `scripts/eval/report.ts` | `export const RUN_IDENTITY_KEYS = [...IDENTITY_KEYS, ...PAIR_EXTRA_IDENTITY_KEYS] as const;` | ★ 缺任一身份键 ⇒ 落进 unknown-face、绝不并进任何可比面 |
| `eval-rows-not-stamped-with-identity` | `scripts/loop-eval.ts` | `r: { …x.r, headSha, ranAt, maxSteps: MAX_STEPS, reps: REPS, arm: ARM },` | 写 readings.json 时逐条盖 headSha／ranAt／maxSteps／reps／arm（不是只盖 run.json 那一份旁证） |

针脚自检（脏主树那遍）读数：**1462 条 —— 阻断 28，待复认 2，未覆盖 1，逐行式 5，未入库面 15，钉在飞文本 13，killer 指针失效 0**。
阻断 28 ＝ 本笔 15（未入库面）＋ 13（钉在飞文本），落库后应归零；`killer 指针失效 0` 是「15 个 expectFail 标题在判卷里逐字找得到」的读数。

**刻意不写的锚点（写出来就是空操作）**：`src/main/agent-runner.ts:367` 那条 worker 侧 `trustResolver` 与
`:1698` 的 `opts.unattended` 传参——runner 级 worker 装配此刻没有对应判卷格，问「生产行变了这条用例会红吗」答不出「会」，
就不配当 killer。登记为 `#107`：补 runner 级 worker 那一格之后才配第三根 A 组针脚。

## 五、D 簇落地前改掉的那一格（子代理成品里的「第二份派生」）

`tests/…` 之外，子代理在 `scripts/eval/report.ts` 里把身份键**又抄了一遍**：既有 `IDENTITY_KEYS = ["headSha","ranAt","model"]`
（身份闸，第 344 页立的），新代码另写 `RUN_IDENTITY_KEYS = ["headSha","ranAt","model","maxSteps","reps","arm"]`。
两表同值但各处一份 ⇒ 以后往身份闸加一枚，配对那一层会静默少认一枚。改成派生：

```ts
export const RUN_IDENTITY_KEYS = [...IDENTITY_KEYS, ...PAIR_EXTRA_IDENTITY_KEYS] as const;
export const PAIR_FACE_KEYS: readonly EvalIdentityKey[] = RUN_IDENTITY_KEYS.filter((k) => k !== "ranAt");
```

配针脚 `eval-run-identity-keys-rehardcoded` 钉住这条派生式（把派生退回硬抄且漏掉基三枚 ⇒ 缺 headSha 的读数照样成对 ⇒ 点名用例红）。

## 六、C 簇判卷落地时抓到的 5 条类型红（门替我抓的，不是我读出来的）

`tests/automation-mount-conditional.test.ts` 有 5 处把说明文字写在 `toBe(false, "…")` 的**第二参**上，
vitest 的 `toBe` 只收 1 个实参 ⇒ `tsc` 报 TS2554 五条。子代理报的是「scoped tsc EXIT=0」——它跑的那把尺比本仓那道门窄。
判卷把消息位退回 `expect(value, "…")`。这条的形状与既有规则同一句：**「scoped 绿」不等于门绿，交笔前跑门自己那一遍。**
