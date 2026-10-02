# 第 306 页 · 语义租约的波及闭包：第 305 页那条判据顺带改了它，而这一格当时没有观测者

任务 #19 的第一半（先量安全面，再谈改窄）。立案动因不是"想优化"，是上一笔落完后发现：
`affectedFilesOf`（spawn 准入那把语义租约的冲突预测器）对每个申报文件把它定义的每个符号的 `upward(...)` 全并进闭包
⇒ 第 305 页把归属判据接进 `upward` 的那一刻，**租约的闭包也跟着变窄了**，
而全量判卷一条没红——因为本仓所有租约判卷用的是合成图，真仓闭包大小从来没人数过（第十三族③：同一位置双向偏差）。

## 1 · 形状：把闭包收成一支，探针与生产取同一个函数

改动只在 `src/agent/impact/index.ts`：

```ts
export function closureFilesOf(graph: ImpactGraph, files: readonly string[]): string[]   // 新出口（并入行只在这里出现一次）
export async function affectedFilesOf(...)  // 入面（glob 过滤）+ 委派：return closureFilesOf(graph, declared);
```

为什么先抽函数再量：**不抽就只能让探针自己再写一遍那段循环**——那正是第 305 页造红台改名机器要防的那件事
（规则 236：探针重算＝假读数）。抽完之后，宽窄两臂、判卷、真仓读数走的都是同一支代码，差别只在一个输入（落料面给不给）。

## 2 · 现读：窄掉的是假冲突，真冲突一个没掉（`lease-ab.log`，`P_EXIT=0`、自检 ✅）

图＝生产缺省帽（`594 文件／候选 594｜帽 5000`），三态由图自己带：`kept=45239 dropped=1687 noEvidence=0`。
两臂＝**同一张图**，B 臂只把 `nameSources` 抹成空表（＝接第 305 页之前的行为），两臂都走 `closureFilesOf`。

| 申报文件 | 宽（旧行为） | 窄（第 305 页后） | 掉出 | 留下的可归引用点 |
| --- | --- | --- | --- | --- |
| `src/agent/ledger.ts` | 125 文件 | **18 文件** | 107 | 16 |
| `src/agent/impact/index.ts` | 16 | 16 | 0 | 44 |
| `src/events/index.ts` | 99 | 99 | 0 | 154 |
| `src/agent/loop.ts` | 34 | 34 | 0 | 33 |
| `src/main/settings.ts` | 10 | 10 | 0 | 11 |

- **阳性对照（不许窄过头）**：判据自己说"这一处归得到这份定义"的那些引用点，逐个查它还在不在窄闭包里——
  五个文件上 258 个可归引用点**一个都没掉**（掉了自检就退 1，不会让我把这份读数写进页）。
- **阴性对照（病确实被治了）**：把 `readFile` 明确绑到别处的引用方 110 个文件里 **107 个**从 `ledger.ts` 的闭包掉出。
- 四个枢纽文件闭包一字未变 ⇒ 这一窄不是"把所有申报都缩小一圈"，是**只砍有反证的那一批**。

## 3 · 判卷：2 条（`tests/impact-attribution.test.ts` 新增一个 describe）

1. `闭包只算归得到的引用方：绑到外部包的那一处掉出，真 import 与没有任何绑定的都留着（宽窄两臂同一张图）`
   —— 四条断言各司一职：正证留（`consumer.ts`）、无反证留（`legacy.js`）、反证掉（`nodeuser.ts`）、宽 ⊃ 窄且更宽。
   **并集口径那一格钉成了现状证人**：`otherdef.ts`（那处归到 `third.ts` 的另一份定义）**仍**在闭包里，
   断言的 message 明写"这一格是任务 #19 要收的口子……不是把它当正确行为藏起来"。
   写反了会当场红（第一版我就写反了：把它当"该掉出"，实测红 ⇒ 说明真实行为是并集，见 §5）。
2. `闭包只有一支：affectedFilesOf 走 closureFilesOf，不内联第二份循环`
   —— 结构钉：委派那一行必须在，且 `out.add(site.file)` 在全文件**只出现一次**（再抄一份就成 2 ⇒ 红）。

## 4 · 锚点：+1 新格，+1 重指（`red-machines-16.log`：16 台｜命中 16｜存活 0｜残骸 0｜16 个不同 killer）

- 新：`impact-lease-closure-bypasses-attribution` —— 闭包绕过 `upward` 直接吃名字图
  （`for (const site of graph.refs.get(sym) ?? [])`）。租约继续把 `node:fs` 的同名调用方算成冲突源，
  而边与读端已经收窄 ⇒ 同一张图三个消费者三种宽窄。killer＝§3 第 1 条，实测只红那一条（16ms）。
- 重指：`impact-closure-glob-broken`（上一笔就在的老锚点）——它原来钉的那行 `if (!globs.some(...)) continue;`
  随循环搬家而消失。针脚**跟着实现往前搬**（`graph.files.filter((file) => globs.some(...))`），
  **没有**改成 HEAD 里的旧写法去讨好门（规则 217 禁的就是那种修法）。重指后仍红在它自己那条
  `目录 glob 把整个子树的波及并进来`（12ms）。
- 秒级尺现读（`needles-precommit.log`，NEEDLES_EXIT=1＝同笔未落库）：
  `针脚体检：1310 条 —— 阻断 1，待复认 1，未覆盖 1，逐行式 5，未入库面 0，钉在飞文本 1，killer 指针失效 0`
  ＋`改法语法体检：1310 条改法全部产出合法源文件 ✅`。那唯一一条阻断就是重指过的 `impact-closure-glob-broken`
  （盘上判得通过而 HEAD 那份 0 处 ⇒ 提交即归零）。

## 5 · 一次"两态不同输出"把我自己的直觉拦住了

我写 §3 那条用例时，直觉是「按 def 逐条筛之后 `otherdef.ts` 也该掉出闭包」，于是断言写成 `not.toContain("src/otherdef.ts")`
——**当场红**：`expected [ 'src/consumer.ts', …(3) ] to not include 'src/otherdef.ts'`。
真实行为是 `upward` 的**并集口径**：`otherdef.ts` 那处归得到 `third.ts` 那份定义 ⇒ 它仍进闭包。
这一红恰好把任务 #19 剩下那一半指出来：**读端与租约要按 def 逐条筛，得单独改 `closureFilesOf`/`fileImpact`，判据本身不产出这个口径**。
处置没有改成"让它通过"：把断言翻成现状证人＋message 里写明这是待收的口子（这样 #19 落的那天，这条用例会红，而红得有出处）。

## 6 · 门与量纲

| 尺 | 现读 |
| --- | --- |
| typecheck | 0 条报错 |
| 本笔判卷面（attribution＋admission 两个文件） | 34 条全绿（`targeted-tests.log`） |
| 造红 16 台 | 每台跑自己那条判卷文件；基准两份都先绿 |
| `--check-needles` | 1310 条，阻断 1（同笔预期） |
| 全量核心判卷 | 293 文件／**4056 条全绿**，183.23s，`SUITE_EXIT=0`（`suite-full.log`）；比第 305 页那份 4054 条多 **2 条**＝本笔新增的两条用例 |

## 7 · 裁决与剩下的半格

- **这一窄是净收益，不用回滚**：少掉的是 107 个拿得出反证的"同名调用方"，而 258 个可归引用点一个没掉。
  语义租约从此与边／读端**同一把判据**，那句「无跨文件调用点，宁漏不误伤」不再靠"图是全的"这个假设撑着
  （非全量时仍会 `console.warn` 出声，那一支没动）。
- 剩下的半格（#19 的后半）：`closureFilesOf` 里那份**并集**口径 ⇒ 一份申报文件会把"另一份同名定义的调用方"也算成冲突源。
  要做的是按 def 逐条筛（判据已经在手），但必须先过两关：① 真轨迹里冲突判定翻转条数（要有同分母 A/B），
  ② 冻结夹具那条 note 的边口径管不管得到读端清单（属裁决，不许拿"边没变"当读端也可以变的理由）。

## 8 · 落库前后逐条读数

- 落库前（第 306 页那一笔 `c0c60da` 同笔入库）：`readings.md`＋`lease-ab.log`＋`targeted-tests.log`＋`red-machines-16.log`＋`needles-precommit.log`＋`suite-full.log`。
  （造红脚本沿用 `../impact-edge-attribution-2026-10-02/red-machines.mts`——它按 id 从锚点表解改法，加 id 就自动多一台，且每台跑**自己那条判卷文件**。）
- 落库后（凭证那一笔入库）：`postcommit-needles.log`（`阻断 0`）、`mutate-kill-c0c60da.log`（55/55 全杀、68.2s）、
  `head-cert-c0c60da.log`（22/22 门绿、干净树 286 文件／3911 条、收尾复核＝同一笔、220.05s）。读数与三处同分母自洽见 PROGRESS 第 306 页补凭证那一段。


