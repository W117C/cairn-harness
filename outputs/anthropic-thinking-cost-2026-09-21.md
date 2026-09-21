# Anthropic × thinking 计费影响量测（2026-09-21，任务 #4 的前置读数）

> **结论先行（三条，方向与前设不同）**：
> 1. **抬 `max_tokens` 本身不花钱**（计费按实际 usage），且**不需要改任何预算口径**——压缩侧早已按
>    `maxOutputReserve = 8_192` 给输出留位（`src/agent/compaction.ts:32`），而 Anthropic 实发只有 4096。
>    ⇒ 前一轮把"抬常量"当成高风险动作，**这个方向是错的**。
> 2. **真正贵的是 thinking token 自己**：官方最低预算 1024，而实测每轮平均只输出 **234 tok**
>    ⇒ 开最低一档 = **输出账面 ×5.4**（×9.7 @2048、×18.5 @4096）。这不是"多点开销"，是数量级。
> 3. **#4 的硬前置不是钱，是截断看不见**：三家适配器都把"为什么停了"收下不读
>    （`stop_reason` / `finish_reason` / `finishReason` 全仓**只有类型声明、零读者**）。
>    thinking 计入 `max_tokens` ⇒ 开它会把截断概率抬上去，而 harness 会在截断时**静默**。

> 基线 HEAD `977c67b`。语料 = `outputs/loop-eval-v2-{base,short}` 8 段 54 轮真钱会话。
> ⚠️ 该语料走 **GLM 支**（`scripts/loop-eval.ts:186` `createGlmSessionProvider`），而 GLM/OpenAI 的请求体
> **根本没有 `max_tokens` 字段**（`src/providers/openai.ts:123-127`）⇒ 下表的输出分布是
> 「同类任务本来要多长」的**代理**，**不是** Anthropic 截断的实测证据。

## 一、实测：输出分布（54 轮，Anthropic 硬顶从没咬过）

| 读数 | 值 |
|---|---|
| 轮数 / 总输出 tok | 54 / 12,653 |
| 每轮平均输出 | **234 tok** |
| min / p50 / p90 / p99 / max | 13 / 124 / 675 / 1430 / **1430** |
| ≥1024 | 4 轮（7.4%） |
| ≥2048 / ≥3072 / **≥4096** | **0 / 0 / 0** |

⇒ 当前 4096 上限在真实任务上有 **2.85× 余量**，一次都没成为约束。
⇒ 反过来说：**今天没有任何证据支持"因为 4096 太小所以需要抬"**，抬它的唯一理由是给 thinking 让位。

## 二、钱：thinking 每档的账面倍率

价表（`src/routing/pricing.ts:66-68`，`calibrated: true`）：cheap $1/$5、standard $2/$10、strong $5/$25
（in/out per M tok）。计费按实际 usage ⇒ **上限本身不进账单**。

| 档位（thinking 预算） | 每轮边际（output 价） | 同 54 轮输出账面倍率（三档同值） |
|---|---|---|
| +1024（官方下限） | cheap $0.0051 / standard $0.0102 / strong $0.0256 | **×5.4** |
| +2048 | ×2 | ×9.7 |
| +4096 | ×4 | ×18.5 |

三档倍率相同是必然的：倍率 = (12,653 + B·54) / 12,653，与单价无关；价表只定绝对美元。
绝对值：当前 54 轮输出在 standard 档 $0.127，开 +1024 到 $0.679。

⚠️ 两条方向性限定，别把上界当预测：
- `budget_tokens` 是**上限**，模型可不花满 ⇒ 真实倍率 ≤ 表中值（误差方向保守）。
- 分母 234 tok/轮 是 GLM 那两臂的产物；换 Anthropic 的 verbosity 会平移分母。
  ⇒ 复测路径见附录，接真 key 后第一段就该重算（这条是本文最容易过期的数）。

## 三、由此得出的映射（UI 五档 ↔ 可发行）

约束：thinking token **计入** `max_tokens`（官方核实），所以第 B 档可发的条件是
`B + 正文所需 ≤ max_tokens`。取正文所需 = 观测 p99 **1430**：

| 现 `max_tokens=4096` | 抬到 8192（预留已是 8192，零口径改动） |
|---|---|
| 可发 B ≤ 2666 ⇒ **关 / 1024 / 2048 三档** | 可发 B ≤ 6762 ⇒ 加 **4096 / 6144**，五档齐 |
| 「高 / 高+」发不出去，除非先截正文 | （B=3072 已越过 p99，属可观测退化区） |

⇒ **#4 的裁决可以是**：不动 `Provider` 契约谈判，先把 `max_tokens` 与既有 `maxOutputReserve` 对齐（8192），
它既解决五档里的后两档，又消掉 R9 那条"预留 8192 / 实发 4096"的两支无同源；
但**必须与"截断可见性"同批或后于它**（下条）。

## 四、真前置：三家「为什么停了」都是零读者

```
src/providers/anthropic.ts:46   stop_reason?: string | null;      // 只有类型
src/providers/openai.ts:54      finish_reason?: string | null;    // 只有类型
src/providers/gemini.ts:35      finishReason?: string | null;     // 只有类型
src/providers/glm.ts:3          注释提到「最后一个 chunk 带 finish_reason」
```
`anthropic.ts` 的 `message_delta` 分支（`:228-235`）只取 usage 四件套，`event.delta.stop_reason` **就地丢弃**。
⇒ 本仓反复出的那个形状在这里第三次复现：**装载收下、执行端不读**。
⇒ 与开 thinking 的耦合是实质的：预算吃满时 Anthropic 会 `stop_reason = "max_tokens"`，
正文被切而 harness 不知情（工具路径尚有 `parseArgs` 的 fail-loud 兜住损坏 JSON，**文本路径没有任何兜底**）。
⇒ 今天它不是现行红（第一节 0/54 咬顶），但它是"开最低档就 ×5.4"这个决策的**代价可见性**，
所以量测的结论是：**先补这条，再谈开档**。已单立任务 #6。

## 五、未证（不许当通过）

1. **零 Anthropic 真流量**：`ANTHROPIC_API_KEY` / `M0_API_KEY` 本轮均 unset ⇒ 官方字段能否被我们现有
   `toAnthropicBody` 形状接受、思考块的 `signature_delta` 回传是否必需，**都未真连验证**。
2. thinking token 是否被 `output_tokens` 全额覆盖（官方文档口径如此，但我们的 usage 面未实测）。
3. GLM 的"部分版本禁止关闭"落到我们档位表里的 `glm-5.2` / `glm-5.3-flash` 具体是哪一支，未证。
4. 分母：本文所有倍率建立在 n=54、4 个冻结 case 上，而靶面结果已饱和（`verifyOkLast` 绿 8/8）
   ⇒ **倍率可信，"开了更省钱/更快"不可推**。

## 附录：复跑

```sh
git rev-parse --short HEAD                       # 977c67b
ls outputs/loop-eval-v2-base outputs/loop-eval-v2-short   # 8 段 events
grep -h '"type":"usage"' outputs/loop-eval-v2-base/I1-rep1-base.events.jsonl | head   # usage 事件形状

# 分布 + 倍率（本文一/二节的唯一事实源；逐字可跑）
node -e '
const fs=require("fs");
const files=["base","short"].flatMap(s=>fs.readdirSync("outputs/loop-eval-v2-"+s)
  .filter(f=>f.endsWith(".events.jsonl")).map(f=>"outputs/loop-eval-v2-"+s+"/"+f));
const out=[];for(const f of files)for(const l of fs.readFileSync(f,"utf8").split("\n")){
  if(!l.trim())continue;let e;try{e=JSON.parse(l)}catch{continue}
  if(e.type==="usage"&&typeof e.outputTokens==="number")out.push(e.outputTokens)}
out.sort((a,b)=>a-b);const q=p=>out[Math.min(out.length-1,Math.floor(out.length*p))];
const sum=out.reduce((a,b)=>a+b,0);
console.log("n",out.length,"mean",(sum/out.length).toFixed(0),"p50",q(.5),"p90",q(.9),"max",out[out.length-1]);
for(const t of [1024,2048,4096])console.log(">=" + t, out.filter(v=>v>=t).length);
for(const B of [1024,2048,4096])console.log("+" + B + " 倍率 ×", ((sum+B*out.length)/sum).toFixed(1));
'

# 价表 / 预留 / 零读者（词边界与或运算一律走 -E：BSD grep 不支持 \| 且静默返回空）
grep -n "anthropic-" src/routing/pricing.ts | head -5
grep -n "maxOutputReserve: 8_192" src/agent/compaction.ts
grep -rnE "stop_reason|finish_reason|finishReason" src            # 期望：只有类型声明那几行
grep -rnE "max_tokens|maxTokens" src/providers/openai.ts src/providers/glm.ts   # 期望：0（GLM/OpenAI 不发上限）
```
