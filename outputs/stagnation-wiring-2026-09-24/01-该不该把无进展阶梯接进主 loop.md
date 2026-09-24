# 能力 43 · 该不该把「无进展阶梯」接进主 loop：先把分母量出来（2026-09-24）

## 一、缘起：一只检测器在 `src/` 里零消费者

`src/agent/no-progress.ts` 里的 R1（`detectVerifyStagnation`）量的是**结论形状**：
同一条验证结论连红 ≥2 次、且中间**没有任何成功的写**（第二道抑制：中间用户说过话 ⇒ 目标被改写过，不算）。
它的阈值、真实录制正样本、造出来的负样本、以及门 `no-progress-check` 都在。

但按本仓那条机械找法（列 `src|scripts|tests` 三桶分别计数）实测：

```
detectVerifyStagnation   src=0 scripts=1 tests=1
noProgressLadder         src=0 scripts=1 tests=1
judgeNoProgressEvents    src=0 scripts=1 tests=1
```

⇒ **「只有验收脚本在调」那一族的新实例**：机器齐全，产品路径上一个调用者都没有。

主 loop 今天对"同一结论又红一次"的判断是**另一把更窄的尺**（`src/agent/loop.ts` 里 `verifyBeat` 的
`digest === lastVerifyDigest`）：
`digest === lastVerifyDigest` —— 只比**相邻**两拍的**逐字**摘要，命中时只把注入文案换成
`repeatDigestNote`，**修复额度照旧扣**。两把尺宽窄不同、各说各话，正是本仓点名的「同族出口副本」。

## 二、新复跑面 `replay:stagnation-burn` 的第一份读数

`scripts/replay/stagnation-burn.ts`（已登记进 `scripts/replay-readings.ts`）。
它**不另造谓词**：停滞与否只问现成那一只；自己只回读事件字段（`attempt` = loop 自己盖的额度账）。

```
TERM=dumb node --import tsx scripts/replay/stagnation-burn.ts   # 登记项：replay:stagnation-burn
```

当日实跑（HEAD `e6f1ea1` 之后、同一棵树）：

```
stagnation-burn：文件 20 · 流 32（有红拍 2 · 停滞 1 · 停滞且同流额度打满 0）
  红拍合计 3（已归因代码 0 / 环境 0 / **未归因（无 cause 字段）** 3） · 记进额度的红拍 3 · 触顶流 0
  · (main) 连红 2 次 · 额度打满 否 · 代码/环境/未归因红拍 0/0/2
    signature: pnpm run test#[ERR_PNPM_UNSAFE_MODULES_DIR] Refusing to remove the modules directory at "/…
  裁决：量不到：1 条停滞流上的红拍**没有 cause 字段**（语料早于归因落盘；全语料未归因红拍 3 个）⇒
        既不能读成「停滞都来自代码红」，也不能读成「来自环境」。
```

## 三、这把尺自己错过一次，错过的方式值得记

第一版我把产品的记账口径（`cause` 缺席 ⇒ 按 `"code"` 算，见 `src/events/index.ts` 的注释「零行为」）
直接搬进尺，于是那份语料报出「代码类红拍 3 / 环境 0」，裁决行印成**「该接：停滞落在代码红上」**。
而签名本身写着 `ERR_PNPM_UNSAFE_MODULES_DIR` —— **那是环境失败**（pnpm 拒绝删 modules 目录，本机沙箱宿主的老问题，
AGENTS.md 已备案）。产品口径在这里没有错：字段缺席时下游必须按 code 算，否则老会话流会改变行为；
错的是**读数面**把"看不见"当成了"看见了且是代码"。⇒ 红拍拆成三态：已归因代码 / 环境 / **未归因**，
裁决优先级 `已归因代码 > 未归因 > 纯环境`，并各配一次自检（⑦⑧⑧b）。
教训一句话：**默认值让"缺席"和"某一类"同行为时，读数面必须把缺席单列**（规则 143 的近亲）。

反向对照（当场造红，跑完即复原）：把那一句改成 `kind: "code"` ⇒ ① 这把尺自己印出
**「该接：1 条流在已归因的代码红上出现停滞」**（假结论上了台面）、② 自检 ⑦⑧ 红、`exit 1`；
③ `verify-claims` 的 43:C1 同时转「已失效」、`exit 1`。复原后：本面 `exit 0`（裁决回到「量不到」）、
`verify-claims` 48/48 全 ok。⇒ 这一格的三态不是注释里的自律，是**三条都会红的判据**。

## 四、现成分类器认得这条 ⇒ 缺陷不在今天，在语料的年龄

```
classifyVerifyFailure({timedOut:false, exitCode:1, output:"[ERR_PNPM_UNSAFE_MODULES_DIR] Refusing to …"})
  ⇒ "pkg-manager"（∈ ENV_VERIFY_CAUSE_SET ⇒ 环境红 ⇒ 不占修复额度、不驱动升档、不进沉淀）
classifyVerifyFailure({…, output:"FAIL src/a.test.ts\n expected 1 to be 2"}) ⇒ "code"
```

也就是说：**跑过新码的语料里，这一类环境红已经不再白烧额度**。今天这份语料是归因落盘之前录的
（`replay:verify-cause-mix` 同口径：带 cause 的红命令 = 0）。所以这条唯一的停滞**不能**当作
"接了 R1 就能省下额度"的证据。

## 五、裁决与下一步（不偷做）

1. **不动内核**：`noProgressLadder` / R1 接进主 loop 这件事，今天的分母是「量不到」，
   不是「该接」也不是「别接」。按规则 129，空载棘轮不许靠加接线来制造存在感。
2. **便宜的可测下一步（不花钱）**：让 `pnpm e2e`（mock provider，零真钱）产出**带 cause 的**新语料，
   再重跑本面。三条分支都已写死在尺里：出现「已归因代码红上的停滞」⇒ 接（且环境拍另走抑制）；
   仍全是未归因 ⇒ 说明 e2e 那条路根本没触发验证红，要先补那一格；全落在环境红 ⇒ 先给 R1 加 cause 抑制。
3. **留位（接的那天再裁）**：
   ① 本面**每流只报第一段停滞**（那只谓词的设计），所以「停滞流数」是**下界**——能证明 ≥1，不能证明总量；
   ② 主 loop 那把窄尺（相邻逐字）与 R1（签名 + 落盘抑制）**并存**是要收的：接的那天该让 loop 问 R1，
      而不是再抄第三把；
   ③ 早前裁决「主循环只提示、绝不停闸」仍然有效（本面不改它）——要接的只是"同一结论没改盘就再红一次"
      该说句话、且**不该记在模型账上**，不是"停下来等人"。
4. **本笔未做**：未动 `src/`（未接线、未加抑制）、未立门；`src/agent/no-progress.ts` 当天在别人的写作窗里
   （它正被加 `userSpokeSinceLast` 那一道抑制），本笔刻意只读不写它。

## 七、同一格的前提被做成判据：「语料年龄」（同轮追补）

「量不到」这个结论本身依赖一个前提：**语料比归因落盘还老**。前提不该只写在页里——
`replay:verify-cause-mix` 现在自己把它量出来并印在输出末尾：

```
语料年龄= 2026-09-20 · cause 落盘= 9499a9f / 2026-09-23 ⇒ 语料最新事件早于 cause 落盘（9499a9f）⇒ 这个 0 是**数据年龄**，不是归因失效
```

四态各一格（`tests/replay-verify-cause-dating.test.ts` 6 条）：已归因 / 数据年龄 / **有更新的流却仍无 cause ⇒ 归因没落地**（红，`exit 1`）/ 不可测
（无红样本、或 git 查不到那个提交 ⇒ **不许拿"年龄"替 0 开脱**）。红那一格当场造过：把喂进去的时间戳推后 30 天 ⇒
`exit 1` 且理由换成「归因路径没落地」，随后复原。

顺带一条自己造的坑，值得留在页里：守卫先写成 `resolve(argv[1]) === pathToFileURL(import.meta.filename).href` ⇒
**仓库路径里有空格**，右边把空格编码成 `%20`，两边永不相等 ⇒ 脚本"exit 0 且什么都不印"。
现改成两侧都解码后比（`fileURLToPath`），注释里写明别再写反。全仓另有三处同类守卫用的是
`import.meta.url === pathToFileURL(realpathSync(argv[1])).href`（同向，无此问题）。

## 判据表（供 claim-coverage.mts 机器抽取；页号见同目录 page.txt）

| 判据 | 断言的是今天的世界，须有可跑谓词 | 复跑面 |
|---|---|---|
| C1 | 今天必红的是反向那一形：把「未归因红拍」并进代码类，`stagnation-burn` 的自检第 ⑦⑧⑧b 条立刻红（尺会对着老语料印出"该接"）——所以三态与裁决优先级此刻是活的 | `verify-claims.mts` 43:C1（直接 import 该面导出的 `selfCheck()`，八条必须全过；任一失败本条转假） |
