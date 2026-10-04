# 施工回执：§八 P0–P3 全条处理（2026-10-04）

用户 2026-10-03/04 指示「都做完了吗」→「全部都需要做」。
核对基准：[工具面与laya接入-专题研究结论 §八 状态附表](工具面与laya接入-专题研究结论-2026-10-03.md)。

**先说结论**：7 项里能做的都做了；剩下的**不是「不做」，是「缺外部输入」**——
本机没有 API key（模型调用这条路断的），也没有装 torch/onnx（laya 精度评测那条断的）。
两处都写进了文档并标明谁解得开，**没有拿合成数据冒充读数**。

---

## 一、§八 文档本身（原本就有缺口）

原 §八 那张表是 2026-10-03 的**原始计划**，读的人会以为 P2/P3 还在排期上。
现加了**状态附表**（逐条查代码现状得出，不凭印象）与 P0-a/P3 两节展开。

## 二、P0-b：含插件真实面 —— ✅ 已做

| 改动 | 位置 |
|---|---|
| `faceCost` 增第 4 参 `pluginTools`（不传时**逐字不变**，零回归支） | `scripts/prompt-cost.ts` |
| CLI 增 `--plugin-tools <file.json>`（读 `SessionPluginTool[]`） | 同上 |
| 输出**明说本次含不含插件** + 打印本仓三个插件发现入口的实况 | 同上 |
| 判据 5 条 | `tests/prompt-cost-plugin-face.test.ts` |

**为什么要「明说含不含」**：2026-10-03 我就是把「首方面」和「含插件面」混读，才得出「工具面已越线」
的错误结论。这条输出设计成让混读不可能发生。

**自曝一个我自己犯的错**：第一版 `pluginRootState()` 取根用了 `PI_SCRATCH_DIR`（临时目录，不是工作区），
把不存在的 `.agent/plugins` **报成「12 个条目」，而且不报错**。改用 `M2B_WORKSPACE ?? cwd`
（与 `glm-session.ts` 的 `opts.workspace` 同一来源）后复跑，三根全「不存在」。
这条教训与本仓纪律同款，已写进代码注释，并被判据 ③ / ③b 双向钉住
（空工作区报「不存在」；真有目录时报条目数——**不许恒报不存在**）。

实测：传 2 件 MCP 工具，default 面 17 件 2,501 tok → 19 件 2,634 tok。

## 三、P0-c：工具选择靶场 —— 尺子已造好，样本还没有

**新增** `src/agent/gym/tool-choice.ts`（纯函数、离线可测）+ `tests/gym-tool-choice.test.ts`（9 条判据）。
`GymExpect` 增**可选** `expectTools` / `forbidTools`。

**为什么是可选而不是必填**：`fixtures/gym/cases/**` 全在 `scripts/frozen-sha256.json` 里，
加必填字段会让全部既有 case 立刻变红 ⇒ 违反「不改冻结判据」这条第一纪律。改完复跑
`gym-check`：**33/33 绿**，冻结一字未动。

四条纪律（每条都对应本仓点过名的失败形状）：

| 纪律 | 防的是 |
|---|---|
| 分母 0 一律 `null`，不退回「默认全对」 | `tool-choice.ts` 开头点名的「代理量被当准确率读」——只要让「没声明」按全对算，选对率永远漂亮 |
| 只存原始计数，比率合并后才算 | 「平均的平均」（`tool-choice.ts` 同一手法） |
| 单 case 只有 0/1，没有率 | 跨 case 的量必须**面不一样大**才携带信息 |
| A/B 要求 case 集**完全对齐**才出差值 | 差值里混着「任务不同」与「面不同」，不可归因 |

**为什么今天出不了有意义的读数**（这是本项的真实状态，不是托词）：

- `GymModelKind = "scripted" | "real" | "probe"`。
- `scripted` 档的「选择」由脚本写死 ⇒ 量出来是「脚本有没有照脚本调」，**构造上同义反复**。
- `real` / `probe` 需要 API key。**本机没有**——`gym-check` 自己打印：
  「暗卷跳过（**无 CAIRN_API_KEY**）——缺席显式打印，不计入 pass」。

⇒ **P0-c = 尺子造好了，样本还没有。** 绝不拿 `scripted` 档的数字充数。

## 四、P1-b：A/B 对照 —— 机制已备，读数同缺

`toolChoiceAblation()` 强制 case 集对齐才出 `hitRateDelta` / `violationRateDelta`，
不齐直接返回 `{ok:false, why}` 并点名谁多谁少。跑不了的原因与 P0-c 同一条（无 key）。

## 五、P3：laya —— 前置前半已实测，后半需改环境

**实测（本机直取，未下载权重）**：HuggingFace API `?blobs=true`：

| 仓库 | 文件 | 体积 |
|---|---|---:|
| `convaiinnovations/laya` | `typed-decisions/model.safetensors` | 842.6 MB |
| `convaiinnovations/laya` | `model.safetensors`（base） | 842.6 MB |
| `convaiinnovations/laya` | `multilingual/model.safetensors` | 643.8 MB |
| `convaiinnovations/laya-multilingual` | `model.safetensors` | 643.8 MB |

**由源权重直接推得**（标明是推算、不是实测）：ONNX 的 FP32 体积不会小于源权重
⇒ **644–843 MB**；INT8 约四分之一 ⇒ **≈161–211 MB**（⚠️ 未实测，要变实测须装
torch/onnx/onnxruntime 并跑一次导出）。
官方自陈曾出现 per-channel 量化把决策模型打到与 eager 仅 **32% 一致** ⇒ INT8 不是免费午餐。

**另一条硬事实**：laya 仓库 HEAD `8a97646` 的提交日期是 **2026-10-03**（与本回执同日）。
日更 pre-1.0，文档 §五已把它列为时效风险。

**为什么停在这里**：跑精度/ECE 评测要装 torch + onnx + onnxruntime（约 2–3 GB）并下 644–843 MB 权重。
**那是改本机环境的动作，未擅自执行。** 等用户点头。

**另需摆正的一点**：P3 服务的是「laya 仅重排」变体，而该变体的收益**至今只有逻辑论证、从未实测**，
且 laya 在能力面上已被否决三次。为一个已被否决方向的一个变体花 2–3 GB 环境改造，
性价比需要用户自己判断——这一条我写进文档而不是替用户决定。

---

## 六、验证

| 项 | 结果 |
|---|---|
| 新增/改动判据 | `prompt-cost-plugin-face` 5 条、`gym-tool-choice` **10** 条，全绿 |
| 既有相关回归 | `surface-account` 10、`run-attachments` 7、`map-render` 5、`final-budget` 1、`compaction` 30 全绿 |
| **冻结守卫** | `gym-check` 无 key **33/33**；**带 key 34/34**（多出的那条是 B3 暗卷真跑通了）。`fixtures/gym/cases/**` 与 `index.json` 一字未动；工具选择 case 另起 `fixtures/gym/tool-choice/`，**不进 index.json** |
| 全量核心套件 | 302 文件（**注意本轮自己新增了 1 个 case 目录与 1 个脚本**）/ 4307 用例：**4305 通过、2 失败**。两条都是先前已归因的（`loop.test.ts` / `mutate-needles-check.test.ts`），见下表 |
| **本轮自己制造又修掉的一次红** | 我在 `src/agent/gym/case.ts` 的新注释里写了 fixture 里的 `scripts/generate.mjs`，被 `dead-script-refs` 判据抓住（「源码散文里点名盘上不存在的脚本」）⇒ 与先前 `observe-surface.ts` **同一类错**。改成「case fixture 里的生成脚本」后 12/12 绿 |
| typecheck | 本次改的文件**零报错**；唯一报错文件 `tests/autonomy.test.ts` 为旁 session 所有 |
| `node --import tsx scripts/typecheck.ts` | 本次改的文件**零报错**。唯一报错文件 `tests/autonomy.test.ts` 为 tracked 且脏、旁 session 所有（归因器已判） |
| `node --import tsx scripts/docs-check.ts` | 本次改的文档**零违规**。报出的 4 条 D-11 全在 `PROGRESS.md`（旁 session 正在改，引的是它自己未入库的 `outputs/cert-provenance-2026-10-04/` 工件），**不是本笔造成** |

## 六之二、两条失败的逐条归因（都不是本次改动）

| 失败 | 归因 | 证据 |
|---|---|---|
| `tests/loop.test.ts:197`<br>`expect(log.filter(e => e.type === "verify_result")).toHaveLength(0)` | 旁 session 未提交的 `src/agent/loop.ts` | 该测试文件本身干净（`git status` 无它）；`src/agent/loop.ts` 是 ` M`，其 diff 新增 `type: "verify_result"` 落盘，与这句断言直接冲突 |
| `tests/mutate-needles-check.test.ts:198`<br>`expect(c?.sha).toBe("1f16bea")`，实收 `1f16bea7` | **环境漂移，非回归**：该断言硬编码了 7 位短 sha，而 git 的自动缩写长度已随仓库对象数增长升到 8 位 | `git config --show-origin --get-all core.abbrev` **无任何来源**（local/global 皆空、`GIT_ABBREV` 未设）⇒ 是 git 自动缩放；同一提交的 `git log -S` 现在返回 `1f16bea7`。本次改动**未触碰**任何 needle / mutate / reproducibility 文件（`git status` 里那些全是旁 session 的 `outputs/*needles*` 与 `M scripts/mutate-verify.mjs`） |

**第二条我没有去「修」**：它要么把断言改成不依赖缩写长度（比前缀），要么用 `rev-parse --short` 比对——
两种都是**改判据**。判据不许为了让环境漂移而变绿，这条得用户决定，不由我顺手改。

## 六之三、第二轮（2026-10-04 01:00 之后）：端点到位，实测跑起来了

用户提供了模型端点（`agnes-3.0-flash`）并要求安装。凭据落 `~/.config/cairn/env`（**600，仓库外，
不进记忆、不进提交**），正好对上仓库已有的三个环境变量（`CAIRN_ENDPOINT` / `CAIRN_API_KEY` /
`CAIRN_MODEL`，`src/providers/glm.ts:5,35`），**零代码改动**。

### 1. 端点实测

| 检查 | 结果 |
|---|---|
| 基本对话 | ✅ HTTP 200 |
| `tool_stream` 字段（`glm.ts:50-56` 明说第三方中转会因未知字段 400） | ✅ 本端点**收**，两种都 200 ⇒ 不需要 `CAIRN_GLM_TOOL_STREAM=0` |
| 靶场 4 条 case 真模型 | ✅ **4/4 score=1**（一条一条跑；`--all` 连着跑会 429） |
| `gym-check` 带 key | ✅ **34/34**（比之前多一条：B3 暗卷真跑通了） |

### 2. 新增的东西

| 文件 | 作用 |
|---|---|
| `fixtures/gym/tool-choice/timeout-config/` | 工具选择 case（**另起 case 根，不进 `index.json`** ⇒ 不碰冻结）。含真实干扰项：`run_shell` 能用 sed 把活干完，所以是**真干扰**不是摆设 |
| `scripts/gym-tool-choice.ts` | 读数跑法：`--case <id> --arm full\|pruned` / `--ab`。缺省 real；无 key 显式跳过 |
| `src/agent/gym/runner.ts` | `RunCaseOptions` 增**可选** `omitTools`（不传逐字不变，判据锁三种「没给」） |

### 3. P1-b 实测：**结论出不来**

4 次真模型跑（2 臂 × 2 轮）：**第 1 轮 pruned 更贵，第 2 轮 pruned 便宜一半——方向相反**；
被禁的 `run_shell` 四轮里出现三次、两臂都有。⇒ 差值与重复跑波动不可区分，
**不许**据此说「摘工具更好/更差」。这一格的价值在于**实证了纪律不是空话**。

### 4. P3 实测：**结果对这个方向不利**

真跑了 ONNX 导出（隔离 venv `~/.local/share/cairn-laya-venv`，源码 `~/.local/share/laya-src/laya`）：

- **FP32 落地 1,290.5 MB**＝源权重（643.8 MB）的 **2.00 倍**（导出脚本自带 1e-4 自校验，通过）
- INT8：`encoder` ✅ **309.5 MB**（4.17×）；`head` ❌ **ShapeInferenceError，量化直接失败**
- 即使 head 也能按同等比例压（**推算非实测**），INT8 合计仍约 **560 MB**

**这一轮推翻了我自己上一轮的两个推算值**（都因「拿源权重比例套导出产物」）：
我写过「FP32 不会小于源权重、644–843 MB」→ 实测 1,290.5 MB；
我写过「INT8 ≈161–211 MB」→ encoder 就 309.5 MB 且 head 压不动。

**又一次自曝**：量体积的第一版脚本只数 `*.onnx` 图、漏了 `*.onnx.data` 外部权重，
报出「2.8 MB」——**比真值小 470 倍**，且不报错。

### 5. 样本量为什么上不去

`agnes-3.0-flash` 是**免费档，有速率限制**：四条 case 连着跑即 HTTP 429
（`You've reached the API rate limit for free users`）。上面 4 次是我一条一条、中间加 20–25 秒
间隔跑出来的。要把 n 提到能出结论的量级，要么升 Token Plan，要么长时间挂机。

## 七、仍未达成 / 待用户决定

| 项 | 卡在哪 | 谁能解 |
|---|---|---|
| P0-a「真实读数」 | 本仓无真实使用 ⇒ 造不出 3 个含 `surface_account` 的真实会话 | 真实用一段时间之后 |
| **P0-c 选对率** | ✅ **已跑通**（尺子 + 真模型读数） | — |
| **P1-b A/B 结论** | 跑通了，但 **n=2/臂 且两轮方向相反 ⇒ 出不了结论** | 升 Token Plan 或长时间挂机把 n 提上去 |
| P3 中文工具描述离线评测（覆盖率 + ECE） | 未做（要每条 case 一次真前向） | 用户决定是否值得；本轮实测已对该方向不利 |
| P3 base 零样本复现 | 未做 | 同上 |