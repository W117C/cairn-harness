/**
 * 前缀抖动门（cache churn / 装配前缀单调性）。
 *
 * 为什么判「我们这一侧」而不判命中率：真实录制显示命中/未命中是**全有或全无**（命中平均 86.6%、
 * 未命中 0%、41.5% 的暖轮整段归零），而归零发生在**上游** ⇒ 拿命中率当判据 = 一扇随机红的门。
 * 读数与判读：`outputs/prefix-churn-2026-09-23/00-实测发现.md`。
 * 本门钉的是那条**确定性**纪律：没有声明的变异源时装配必须逐字纯追加；易变块变了不得牵连
 * 可缓存前缀；工具面自己变了必须出声；降配必须确定；压缩/裁剪造成的抖动必须留下证据。
 *
 * 口径：
 * - 判据全部住在 `src/agent/prefix-churn.ts`（纯函数），门与 `--self-test` 共用同一只。
 * - 观测来自**真 provider 真正发出去的那一对**（`transport(messages, _o, tools)`），不是源码形状断言。
 * - fail-visible：判据无分辨力（该变的没变）时**门自身红**，不报「通过」。
 *
 * 用法：`pnpm prefix-churn-check`｜反向对照 `pnpm prefix-churn-check -- --self-test`
 */
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createEventLog, replay } from "../src/events";
import { createMockSummarizer } from "../src/agent/compaction";
import { computePrune } from "../src/agent/prune";
import { freeRideCoincidence, thresholdKnobIsWired } from "../src/agent/prune-batching";
import { gateToolSpecs, sessionToolSpecs } from "../src/agent/glm-session";
import type { GlmMessage, GlmToolSpec } from "../src/providers/glm";
import {
  attributeChurn,
  breakByFoldingVolatileIntoHead,
  breakByMiddleSplice,
  cacheableSurvivesVolatileChange,
  cacheSurvivalAfterRewrite,
  churnIsAttributed,
  historyPurelyAppends,
  oversizedFaceIsDeterministic,
  toolFaceChangeIsNamed,
  type AssemblyObservation,
  type ChurnMutator,
  type ChurnVerdict,
} from "../src/agent/prefix-churn";
import { planSurfaceBudget } from "../src/agent/model-surface";
import { pluginFixture } from "./model-surface-check";

const SYSTEM_TEXT = "你是前缀抖动门的固定基础提示。".repeat(8);
const CORE_NAMES: ReadonlySet<string> = new Set(gateToolSpecs().map((s) => s.function.name));
const cjk = (n: number) => "的".repeat(n);

/* ============================ 驱动器 A：无变异源 ============================ */

/** 驱动真 provider 走若干轮，收每一轮真正发出去的 (messages, tools, note)。
 *  `volatileEachRound` ⇒ 易变块每轮不同（模拟记忆/skills 逐轮重读）；
 *  `faceChangeAt` ⇒ 从第 n 轮起工具面少一把且带说明（模拟 run 中途 skill 摘除）。 */
async function drive(opts: {
  rounds: number;
  volatileEachRound: boolean;
  faceChangeAt?: number;
  pluginTools?: readonly { name: string; description: string; parameters: Record<string, unknown> }[];
}): Promise<AssemblyObservation[]> {
  const dir = mkdtempSync(join(tmpdir(), "prefix-churn-"));
  const path = join(dir, "events.jsonl");
  const log = createEventLog(path);
  const seen: AssemblyObservation[] = [];
  try {
    await log.append({ type: "user_message", content: "TASK-0" });
    const { createGlmSessionProvider } = await import("../src/agent/glm-session");
    // provider **只建一次**：一个 run = 一个 provider 实例，跨请求的状态（压缩重写代价的头部存活比、
    // 已压次数）本来就挂在 provider 级。每轮新建会把状态洗掉——第一版就是这么把 PC7 量成
    // 「开与关逐字同值」的（读起来像策略坏，其实是驱动器不像生产）。
    let roundIndex = 0;
    let faceNote = "";
    const provider = createGlmSessionProvider(path, {
      map: false,
      workspace: dir,
      system: SYSTEM_TEXT,
      ...(opts.volatileEachRound ? { plugins: { deriveRemount: () => "REMOUNT-" + String(roundIndex) } } : {}),
      requestFace: () => {
        const r = roundIndex;
        const base = sessionToolSpecs({
          mode: "default",
          ...(opts.pluginTools ? { pluginTools: opts.pluginTools } : {}),
        });
        if (opts.faceChangeAt !== undefined && r >= opts.faceChangeAt) {
          const dropped = base.specs[base.specs.length - 1];
          faceNote = "[skill 工具面] 本 turn 已按 disallowed-tools 从可见工具表摘除：" + String(dropped?.function.name ?? "?");
          return { tools: base.specs.slice(0, -1), note: faceNote };
        }
        faceNote = "";
        return { tools: base.specs, note: "" };
      },
      transport: async function* (messages: GlmMessage[], _o: unknown, specs?: GlmToolSpec[]) {
        seen.push({ messages: [...messages], tools: specs ? [...specs] : undefined, faceNote });
        yield { type: "assistant_message" as const, content: "r" + String(roundIndex) };
      },
    });
    for (let r = 1; r <= opts.rounds; r++) {
      roundIndex = r;
      for await (const _ of provider.stream([])) void _;
      // 轮间只用已确证形状的事件类型：历史照样逐轮变长，前缀判据不受影响
      await log.append({ type: "assistant_message", content: "r" + String(r) });
      await log.append({ type: "user_message", content: "Q-" + String(r) });
    }
  } finally {
    await log.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
  return seen;
}

/* ============================ 驱动器 B：真触发变异源 ============================ */

/** 驱动一条**真会触发某个变异源**的会话。
 *  证据不是猜的：压缩 = 事件流里多了 `type:"compaction"`；裁剪 = `prune-attachments/` 多了文件。
 *  两个痕迹都是 harness 自己落的，所以「认账」不依赖「看到抖了就当它声明过」。
 *
 *  两个样本的尺寸都是被实测逼出来的（第一次双双失败，原因各不同）：
 *  · 压缩样本**不能**用大工具结果撑上下文——prune 会先把上下文裁小，压缩阈值反而永远够不到；
 *    于是增长全走 user/assistant 文本，并把 tail 预算调小（否则整段会话都在 tail 里，
 *    压缩会以「无可压缩事件（会话在 tail 预算内）」正当拒绝）。
 *  · 裁剪样本要的不是「总量够大」而是**保护区边界在驱动期间越过某条老结果**：
 *    每轮都裁同一批旧结果时，已发出的历史仍逐字纯追加，量不到抖动。
 *    配方由 `scripts/probe-prune-recipe.mts` 实跑定出（2026-09-25 自 `outputs/prefix-churn-2026-09-23/` 迁入）：
 *    每轮 `user_message + tool_call + 20k 字结果 + assistant_message`、**种子只给 2 轮**
 *    （`RECENT_ROUNDS_EXEMPT = 2`）⇒ 替换集从第 3 轮起每轮恰好多一个键（3 → 3,7 → 3,7,11 …）。 */
async function driveMutating(opts: {
  kind: "compaction" | "prune" | "both";
  rounds?: number;
  amortize?: boolean;
  batching?: boolean | { minSavedTokens?: number };
  /** 把整张工具面按字符放大（只动 description）——`--sweep` 用，问「这条策略在别的面尺寸上还成不成立」。
   *  不传 = 逐字旧行为；PC7 本体不传，所以这条不影响任何断言。 */
  facePadChars?: number;
  /** 结构对照旋钮：多给一把合成工具，放**面尾**或**面首**（字节量级与 pad 相当，但面多一条）。
   *  为什么要分位置：`aa30513` 是在 `spawn_agent.properties` **中间**插了一整个对象。
   *  若机制是「插入点之后的字节从此不再共享前缀」，那面尾该不动读数、面首该动——这就是本格的判据。 */
  faceAddSpec?: "tail" | "front";
}): Promise<{
  obs: AssemblyObservation[];
  firedPerPair: ChurnMutator[][];
  /** 每次压缩的触发种类（`threshold` / `overflow`）——摊销只管 threshold，读数必须分开算。 */
  triggers: string[];
  /** 逐轮三读数：决策时刻有多少可剪的量 / 本轮压了几次 / 本轮落了几份附件。
   *  PC9 判的就是这三者之间的** coincidence**，光看"抖没抖"判不出来。 */
  perRound: { prunableAtDecision: number; compactions: number; attachments: number }[];
}> {
  const dir = mkdtempSync(join(tmpdir(), "prefix-churn-mut-"));
  const path = join(dir, "events.jsonl");
  const attachments = join(dir, "prune-attachments");
  const obs: AssemblyObservation[] = [];
  const firedPerPair: ChurnMutator[][] = [];
  const triggers: string[] = [];
  const perRound: { prunableAtDecision: number; compactions: number; attachments: number }[] = [];
  const log = createEventLog(path);
  // "both" = 既给大结果（让 prune 真有活干）又给小窗口（让压缩真会打断头）——PC9 要的就是这两件事同场。
  const bigResults = opts.kind !== "compaction";
  const mayCompact = opts.kind !== "prune";
  const roundEvents = (i: number) => [
    { type: "user_message", content: "Q" + String(i) },
    { type: "tool_call", id: "c" + String(i), name: "read_file", args: { path: "f" + String(i) } },
    { type: "tool_result", callId: "c" + String(i), ok: true, output: cjk(20_000) },
    { type: "assistant_message", content: "A" + String(i) },
  ];
  try {
    if (bigResults) {
      for (let i = 0; i < 2; i++) for (const e of roundEvents(i)) await log.append(e as never);
    } else {
      await log.append({ type: "assistant_message", content: cjk(4_000) });
      await log.append({ type: "user_message", content: "q0" });
    }
    await log.close?.();
    const { createGlmSessionProvider } = await import("../src/agent/glm-session");
    let beforeCompact = countCompactionEvents(path);
    let beforeAttachments = countAttachments(attachments);
    // 与驱动器 A 同理：**一个 run 一个 provider**，跨请求的状态才量得到（PC7 的摊销判定读的就是它）。
    let roundIndex = 0;
    let faceNote = "";
    const provider = createGlmSessionProvider(path, {
      map: false,
      workspace: dir,
      system: SYSTEM_TEXT,
      // 分批裁剪的 A/B 开关（PC8）。不传 = 逐字旧行为。
      ...(opts.batching === undefined ? {} : { pruneBatching: opts.batching }),
      ...(mayCompact
        ? {
            compaction: {
              // ratio 取 0.35：阈值必须**在驱动中途**才够得到（首轮就压没有上一轮可比），
              // 且窗口要大于估算，让触发停在 **threshold**（overflow 那一支按设计不摊销）。
              // tail 三个旋钮刻意不覆盖：拿生产缺省（tailMin 2,000 / tailMax 15,000 / ratio 0.25），
              // 否则 tail 预算落到工作集下限之下，摊销按设计拒绝动作（第一版就踩在这)。
              // inputLimit 在 PC7/PC9 各取一份：PC9 要「大结果 + 压缩」同场，窗口必须容得下 40k 结果
              // 又能在几轮后够到阈值（实测 60,000 ⇒ 8 轮压 3 次，逐轮交替）。
              config: { inputLimit: opts.kind === "both" ? 60_000 : 12_000, maxOutputReserve: 400, ratio: 0.35, retryBackoffMs: 1 },
              summarizer: createMockSummarizer("SUMMARY：前文已压缩为一段，结论与未收口项都在里面。".repeat(12)),
              amortizeRewriteCost: opts.amortize === true,
            },
          }
        : {}),
      requestFace: () => ({ tools: maybeAddSpec(padFace(sessionToolSpecs({ mode: "default" }).specs, opts.facePadChars), opts.faceAddSpec), note: faceNote }),
      transport: async function* (messages: GlmMessage[], _o: unknown, specs?: GlmToolSpec[]) {
        obs.push({ messages: [...messages], tools: specs ? [...specs] : undefined, faceNote });
        yield { type: "assistant_message" as const, content: "round-" + String(roundIndex) };
      },
    });
    for (let r = 0; r < (opts.rounds ?? 4); r++) {
      roundIndex = r;
      // 决策时刻的"有多少可剪的量"：直接问那只纯函数（它不落盘、无副作用），读的是这一轮
      // assemble() 看得见的同一份事件。没有这个正读数，"推迟了"就只能靠没落盘反推——那是沉默，不是证据。
      const prunableAtDecision = bigResults
        ? (computePrune({ events: await replay(path) }).replacements.size)
        : 0;
      for await (const _ of provider.stream([])) void _;
      const fired: ChurnMutator[] = [];
      const afterCompact = countCompactionEvents(path);
      if (afterCompact > beforeCompact) fired.push("compaction");
      perRound.push({
        prunableAtDecision,
        compactions: afterCompact - beforeCompact,
        attachments: 0,
      });
      beforeCompact = afterCompact;
      const afterAttachments = countAttachments(attachments);
      if (afterAttachments > beforeAttachments) fired.push("prune");
      perRound[perRound.length - 1]!.attachments = afterAttachments - beforeAttachments;
      beforeAttachments = afterAttachments;
      if (r > 0) firedPerPair.push(fired);
      // 轮间追加：裁剪样本整轮追加（含 user_message ⇒ 免剪边界前移），压缩样本每轮长一块
      if (bigResults) {
        for (const e of roundEvents(100 + r)) await log.append(e as never);
      } else {
        await log.append({ type: "assistant_message", content: cjk(4_000) });
        await log.append({ type: "user_message", content: "after-" + String(r) });
      }
    }
    // 触发种类必须在 rmSync 之前读——文件已删就什么都读不到（这个坑踩过一次，表现是「种类=[无]」）
    triggers.push(...readCompactionTriggers(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
    return { obs, firedPerPair, triggers, perRound };
}

/** 从事件流里读每次压缩的触发种类（真实痕迹，不是推断）。 */
function readCompactionTriggers(path: string): string[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.includes('"type":"compaction"'))
      .map((l) => {
        try {
          return String((JSON.parse(l) as { trigger?: string }).trigger ?? "?");
        } catch {
          return "?";
        }
      });
  } catch {
    return [];
  }
}

function countCompactionEvents(path: string): number {
  try {
    return (readFileSync(path, "utf8").match(/"type":"compaction"/g) ?? []).length;
  } catch {
    return 0;
  }
}
function countAttachments(dir: string): number {
  try {
    return readdirSync(dir).length;
  } catch {
    return 0; // 目录不存在 = 还没裁过
  }
}

/* ============================ 诊断模式：--sweep（不判绿） ============================ */

/** 把整张工具面按字符放大（只动 description）：名字 / 参数 / 条数都不动 ⇒ 改的是**尺寸**，不是形状。
 *  单位与 `AssemblyOverhead.toolSchemaChars`（= `JSON.stringify(tools).length`）同一把尺。 */
function padFace(specs: GlmToolSpec[], pad: number | undefined): GlmToolSpec[] {
  if (pad === undefined || pad <= 0 || specs.length === 0) return specs;
  const filler = "面".repeat(Math.ceil(pad / specs.length));
  return specs.map((s) => ({ ...s, function: { ...s.function, description: s.function.description + filler } }));
}

/** 结构对照：多一把合成工具（名字唯一 + 一段与 `aa30513` 同量级的 description）。
 *  与 `padFace` 的差别就是这一格要问的：**条数/键变了** vs **只有字节变了**。 */
function maybeAddSpec(specs: GlmToolSpec[], at: "tail" | "front" | undefined): GlmToolSpec[] {
  if (at === undefined || specs.length === 0) return specs;
  const twin = specs[0]!;
  const probe: GlmToolSpec = { ...twin, function: { ...twin.function, name: "sweep_probe_tool", description: "结构对照用合成工具。".repeat(60) } };
  return at === "front" ? [probe, ...specs] : [...specs, probe];
}

/** PC7 那对 A/B 在**四个面尺寸**上各跑一遍，再跑一组**结构**对照。
 *  为什么要有：PC7 的红（第 44 页 §十三）只说
 *  「当前面上，开臂压缩次数不再更少」，答不出这是**刀界**（尺寸挪一点就翻回来）还是**趋势**（面越大越亏）——
 *  两种读法对产品是相反的决定（改尺 vs 改策略），所以先把矩阵打出来。本模式**一条断言都不下**。 */
async function runFaceSweep(): Promise<void> {
  let driveRounds = 8;
  console.log("[prefix-churn] --sweep 诊断模式：**不判绿**，exit 0 不代表门过（断言在 PC7 本体，本模式一条不下）");
  const tally = (r: Awaited<ReturnType<typeof driveMutating>>) => {
    const attrs = r.obs.slice(1).map((cur, i) => attributeChurn(r.obs[i]!, cur, r.firedPerPair[i] ?? []));
    return {
      compactions: attrs.filter((a) => a.fired.includes("compaction")).length,
      rewrote: attrs.reduce((n, a) => n + a.rewroteChars, 0),
    };
  };
  // 上限刻意留在 6,000：实测 pad=40,000 会让 `glm-session` 抛 `[context_budget_exceeded]`
  // （final estimated input 11606 > available 11600，请求根本不发）——这既是 fail-visible 的好行为，
  // 也说明**面字节确实进了估算**，所以下面「加 60% 尺寸读数一动不动」不是接线断，是真的不敏感。
  // **真发出去的那份**才作数：「我要的」是我自己重算的，与实发不等就说明旋钮没穿到装配面（那是没尺，不是读数）。
  const sentChars = (r: Awaited<ReturnType<typeof driveMutating>>) => JSON.stringify(r.obs[r.obs.length - 1]?.tools ?? []).length;
  const row = async (label: string, pad: number, at: "tail" | "front" | undefined) => {
    const want = JSON.stringify(maybeAddSpec(padFace(sessionToolSpecs({ mode: "default" }).specs, pad), at)).length;
    const offRun = await driveMutating({ kind: "compaction", rounds: driveRounds, facePadChars: pad, ...(at ? { faceAddSpec: at } : {}) });
    const onRun = await driveMutating({ kind: "compaction", rounds: driveRounds, amortize: true, facePadChars: pad, ...(at ? { faceAddSpec: at } : {}) });
    const a = tally(offRun), b = tally(onRun);
    console.log("  " + label + " 面(我要的)=" + String(want) + " 面(实发 关/开)=" +
      String(sentChars(offRun)) + "/" + String(sentChars(onRun)) +
      " ⇒ 关 压 " + String(a.compactions) + " 次 / 重写 " + String(a.rewrote) +
      " ｜开 压 " + String(b.compactions) + " 次 / 重写 " + String(b.rewrote) +
      " ⇒ 次数 " + (b.compactions < a.compactions ? "更少" : b.compactions === a.compactions ? "同" : "更多(红形)") +
      "、字节 " + (b.rewrote < a.rewrote ? "更省" : "更多(红形)"));
    // 次数相同不代表「同一份时刻表」：把逐轮触发序列一起打出来，才能分辨
    // 「估算随面变但没跨过任何一次触发（离散化）」与「估算根本不随面变（线断了）」——这两种处置相反。
    const sched = (r: typeof offRun) => r.perRound.map((x) => String(x.compactions)).join("");
    console.log("      时刻表 关=" + sched(offRun) + " 开=" + sched(onRun));
  };
  for (const pad of [0, 1_500, 3_000, 6_000]) await row("尺寸 pad=" + String(pad) + "        ", pad, undefined);
  await row("结构 面尾 +1 把      ", 0, "tail");
  await row("结构 面首 +1 把      ", 0, "front");
  await row("结构 面首 +1 把 + p1500", 1_500, "front");
  // 第二轮：把驱动拉长，看关那一支会不会**出现空档**。两臂都几乎每轮触发 = 台架饱和，
  // 那时"摊销把接下来几次省掉"这件事根本没有可观察的空间（时刻表只能差最后一轮）。
  console.log("  —— 加长驱动，找'关臂有空档'的那一段（饱和时 PC7 的对照问不出问题）——");
  driveRounds = 12;
  await row("轮=12 pad=0", 0, undefined);
  driveRounds = 16;
  await row("轮=16 pad=0", 0, undefined);
}

if (process.argv.includes("--sweep")) {
  await runFaceSweep();
  process.exit(0);
}

/* ============================ 规则表 ============================ */

export interface ChurnRule {
  id: string;
  why: string;
  run: () => Promise<ChurnVerdict> | ChurnVerdict;
}

export const CHURN_RULES: readonly ChurnRule[] = [
  {
    id: "PC1-历史逐轮纯追加",
    why: "没有任何变异源时，装配必须是上一轮的严格前缀。这一条一旦破了，整段可缓存前缀每轮重写——而这正是我们说自己「省 token」时最容易偷偷做的事",
    run: async () => historyPurelyAppends(await drive({ rounds: 4, volatileEachRound: false })),
  },
  {
    id: "PC2-易变块变了不牵连可缓存前缀",
    why: "记忆/skills 每轮重读是既有语义；它们变了只该从自己那一段起抖。「可变内容后置」一旦被破（把易变文本折进首条 system），每轮都在重写整段前缀",
    run: async () => cacheableSurvivesVolatileChange(await drive({ rounds: 4, volatileEachRound: true })),
  },
  {
    id: "PC3-工具面自己变了必须出声",
    why: "清单与上一轮不同却不说明 = 让模型自己猜哪把没了（本仓反复出现的静默面缺陷族）",
    run: async () => toolFaceChangeIsNamed(await drive({ rounds: 4, volatileEachRound: false, faceChangeAt: 3 })),
  },
  {
    id: "PC4-超限工具面降配是确定的",
    why: "同一份超限面重复装配必须逐字同一。降配若带抖动（或依赖遍历顺序），等于每轮再花一次缓存重写，把省下的字节还回去",
    run: () => {
      const specs = sessionToolSpecs({ mode: "default", pluginTools: pluginFixture(60, 1_200) }).specs;
      return oversizedFaceIsDeterministic(
        () => planSurfaceBudget({ specs, systemChars: SYSTEM_TEXT.length, coreNames: CORE_NAMES }).specs,
        4,
      );
    },
  },
  {
    id: "PC5-压缩抖了要认账",
    why: "阈值摘要替换历史 = 前缀中段必然重写，这本身是合法代价；不可接受的是它发生时没留下证据——那样每一次压缩都在悄悄付缓存重写的钱",
    run: async () => {
      const { obs, firedPerPair } = await driveMutating({ kind: "compaction" });
      const attrs = obs.slice(1).map((cur, i) => attributeChurn(obs[i]!, cur, firedPerPair[i] ?? []));
      const verdict = churnIsAttributed(attrs, true);
      const saw = attrs.some((a) => a.fired.includes("compaction"));
      const rewrote = attrs.find((a) => !a.pureAppend);
      return {
        ok: verdict.ok && saw,
        detail: verdict.detail + "｜认账来源=" + (attrs.find((a) => a.fired.length > 0)?.fired.join("+") ?? "无") +
          (rewrote ? "｜" + cacheSurvivalAfterRewrite(rewrote) : ""),
      };
    },
  },
  {
    id: "PC6-裁剪抖了要认账",
    why: "类型化裁剪改写的是**历史中段**的旧工具结果 ⇒ 那之后的前缀作废。上日 §2.3 的假设（「prune 每触发一次打掉其后缓存命中」）至今没人量过，这条就是量它的",
    run: async () => {
      const { obs, firedPerPair } = await driveMutating({ kind: "prune" });
      const attrs = obs.slice(1).map((cur, i) => attributeChurn(obs[i]!, cur, firedPerPair[i] ?? []));
      const verdict = churnIsAttributed(attrs, true); // 转轮上老结果被换 = 历史中段重写 ⇒ 期望「抖了且有证据」
      const saw = attrs.some((a) => a.fired.includes("prune"));
      const worst = attrs.reduce((m, a) => (a.rewroteChars > m.rewroteChars ? a : m), attrs[0]!);
      return {
        ok: verdict.ok && saw,
        detail: verdict.detail + "｜认账来源=" + (attrs.find((a) => a.fired.length > 0)?.fired.join("+") ?? "无") +
          (worst ? "｜最大抖动 " + String(worst.rewroteChars) + " 字符 @第 " + String(worst.firstRewriteIndex) + " 条" : ""),
      };
    },
  },
  {
    id: "PC7-摊销确实少付账（A/B 同一条会话）",
    why: "断点位置 = 第一个被摘除的消息，与这次摘掉多少**无关** ⇒ 既然横竖要断一次，就该这一次多压一点。这条判据要的是同一会话上的对照读数，不是「逻辑上应该会少」\n" +
      "    2026-09-26（`outputs/pc7-amortize-tradeoff-2026-09-26/`）：这一格在 HEAD 上就是红的，且红得有内容——" +
      "摊销把重写从 42,588 降到 34,925 字符（它宣称的那个量），代价是多付一次摘要调用（压缩 5→6 次）。" +
      "两支都处在「每轮都踩在阈值上」的饱和区：关那支到第 7 对不再压（尾部已到底，只能发一份超量的 12,608 字符请求），" +
      "开那支还能继续压所以多一次。⇒ 红不是回归也不是抖动，是「省字节 vs 多一次 LLM 调用」这笔交换没裁过；" +
      "detail 里那两组数（压缩落在第几对 / 逐轮发送量）就是为这一步归因加的。",
    run: async () => {
      const rounds = 8;
      const off = await driveMutating({ kind: "compaction", rounds });
      const on = await driveMutating({ kind: "compaction", rounds, amortize: true });
      const tally = (r: typeof off) => {
        const attrs = r.obs.slice(1).map((cur, i) => attributeChurn(r.obs[i]!, cur, r.firedPerPair[i] ?? []));
        return {
          compactions: attrs.filter((a) => a.fired.includes("compaction")).length,
          rewrote: attrs.reduce((n, a) => n + a.rewroteChars, 0),
          threshold: r.triggers.filter((t) => t === "auto" || t === "threshold").length,
          overflow: r.triggers.filter((t) => t === "overflow").length,
          kinds: r.triggers.join(",") || "无",
          // 归因用（PC7 红过之后要能说出"多出来的那一次发生在哪儿"）：逐轮发送量 + 压缩落在第几对
          sent: r.obs.map((o) => o.messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0)),
          firedAt: attrs.map((a, i) => (a.fired.includes("compaction") ? i + 1 : 0)).filter((n) => n > 0),
        };
      };
      const a = tally(off), b = tally(on);
      return {
        ok: a.compactions >= 2 && b.compactions < a.compactions && b.rewrote < a.rewrote,
        detail: `同一条会话 8 轮：关 ⇒ 压缩 ${String(a.compactions)} 次、重写 ${String(a.rewrote)} 字符；` +
          `开 ⇒ 压缩 ${String(b.compactions)} 次、重写 ${String(b.rewrote)} 字符` +
          `｜触发种类 关=[${a.kinds}] 开=[${b.kinds}]` +
          `｜压缩落在第几对 关=[${a.firedAt.join(",") || "无"}] 开=[${b.firedAt.join(",") || "无"}]` +
          `｜逐轮发送量 关=[${a.sent.join(",")}] 开=[${b.sent.join(",")}]` +
          (a.compactions < 2 ? "（关那一支都没连压两次 ⇒ 样本无分辨力，门自身红）" : ""),
      };
    },
  },
  {
    id: "PC8-分批裁剪确实少断前缀（A/B 同一条链）",
    why: "裁剪的隐藏成本不是省得少，是**每次越界都整段作废已发前缀**（PC6 量到一次 ~40,299 字符）。攒够再剪就是把这个次数压下来——前提：证据链仍然齐全（真落盘过附件）",
    run: async () => {
      const rounds = 6;
      const off = await driveMutating({ kind: "prune", rounds });
      const on = await driveMutating({ kind: "prune", rounds, batching: true });
      const tally = (r: typeof off) => {
        const attrs = r.obs.slice(1).map((cur, i) => attributeChurn(r.obs[i]!, cur, r.firedPerPair[i] ?? []));
        return {
          rewrites: attrs.filter((a) => !a.pureAppend).length,
          rewrote: attrs.reduce((n, a) => n + a.rewroteChars, 0),
          prunes: attrs.reduce((n, a) => n + a.fired.filter((f) => f === "prune").length, 0),
          maxRewrite: attrs.reduce((m, a) => Math.max(m, a.rewroteChars), 0),
        };
      };
      const a = tally(off), b = tally(on);
      return {
        // 「至少省一半」而不是「少一次就算数」：只要求 `b < a` 的话，把策略喂累计值
        // （第一轮照样推迟、之后每轮照剪）也能过——实测就是这么让一条针脚存活的。
        ok: a.rewrites >= 4 && b.rewrites * 2 <= a.rewrites && b.prunes >= 1 && b.rewrote > 0 && b.rewrote < a.rewrote,
        detail: `同一条链 ${String(rounds)} 轮：不分批 ⇒ 断 ${String(a.rewrites)} 次 / 作废 ${String(a.rewrote)} 字符；` +
          `分批 ⇒ 断 ${String(b.rewrites)} 次 / 作废 ${String(b.rewrote)} 字符（单次最大 ${String(b.maxRewrite)}）` +
          `｜分批那支真裁过 ${String(b.prunes)} 次` +
          (a.rewrites < 4 ? "（不分批只断 <4 次 ⇒ 样本短到量不出『省一半』，门自身红）" : ""),
      };
    },
  },
  {
    id: "PC9-免费车只在断过头的那一轮放行",
    why: "既然前缀本轮已被压缩打断，攒批就没有可省的东西——顺手剪是免费的（省掉将来那一次断）。但这条支路写错方向（无条件放行 / 旗标忘清零变成每轮放行）省的就不是缓存而是失控。判法：把攒批门槛抬到不可能达到，此后**落盘的轮次集合必须恰好等于压缩的轮次集合**——两侧都判，只判一侧两种错法各能过一种",
    run: async () => {
      // 窗口取 60k/结果 20k：这是实测唯一让压缩与裁剪**同场**的配方（12k 窗口配 20k 结果是每轮
      // overflow 压、裁剪攒不到 ⇒ 那条链上根本没有免费车，PC8 用的就是它）。
      const { perRound } = await driveMutating({ kind: "both", rounds: 8, batching: { minSavedTokens: 1_000_000_000 } });
      const v = freeRideCoincidence(perRound);
      // 对照臂：门槛压到 1（等于"有活就剪"），必须看到**没压缩的那一轮也落盘**。
      // 没有这条，主判据的"只有压缩轮落盘"可能只是因为别的轮本来没活——那它就不是免费车在挑时机。
      const ctrl = await driveMutating({ kind: "both", rounds: 8, batching: { minSavedTokens: 1 } });
      const wired = thresholdKnobIsWired(ctrl.perRound);
      return {
        ok: v.ok && wired.ok,
        detail: `门槛不可达（10^9）下 8 轮：${v.detail}｜对照臂 ${wired.detail}`,
      };
    },
  },
];

/** 反向对照：每只判据喂一件故意做错的工件，要求它判假。造不出红的规则等于摆设。 */
export function runChurnSelfTest(): { caught: string[]; missed: string[] } {
  const caught: string[] = [];
  const missed: string[] = [];
  const clean = [1, 2, 3].map((n) => ({
    messages: [
      { role: "system", content: SYSTEM_TEXT },
      { role: "system", content: "VOL-" + String(n) },
      ...Array.from({ length: n }, (_, i) => ({ role: "user", content: "m" + String(i) } as GlmMessage)),
    ] as GlmMessage[],
    tools: gateToolSpecs(),
    faceNote: n === 3 ? "[skill 工具面] 摘除 grep" : "",
  }));
  const probes: { id: string; predicateSaysRed: () => boolean }[] = [
    {
      id: "PC1-历史逐轮纯追加",
      predicateSaysRed: () =>
        !historyPurelyAppends([...clean.slice(0, 2), { ...clean[2]!, messages: breakByMiddleSplice(clean[1]!.messages) }]).ok,
    },
    {
      id: "PC2-易变块变了不牵连可缓存前缀",
      predicateSaysRed: () =>
        !cacheableSurvivesVolatileChange(clean.map((o) => ({ ...o, messages: breakByFoldingVolatileIntoHead(o.messages) }))).ok,
    },
    {
      id: "PC3-工具面自己变了必须出声",
      predicateSaysRed: () =>
        !toolFaceChangeIsNamed([clean[0]!, { ...clean[1]!, tools: gateToolSpecs().slice(0, -1), faceNote: "" }]).ok,
    },
    {
      id: "PC4-超限工具面降配是确定的",
      predicateSaysRed: () =>
        !oversizedFaceIsDeterministic((round) => {
          const specs = gateToolSpecs();
          return [...specs.slice(round), ...specs.slice(0, round)]; // 顺序抖动 ⇒ 降配集合跟着抖
        }, 3).ok,
    },
    {
      id: "PC5-压缩抖了要认账",
      predicateSaysRed: () => !churnIsAttributed([attributeChurn(clean[0]!, clean[1]!, [])], true).ok,
    },
    {
      id: "PC6-裁剪抖了要认账",
      predicateSaysRed: () => !churnIsAttributed([attributeChurn(clean[0]!, clean[1]!, ["prune"])], false).ok,
    },
    {
      // PC7 的分辨力：拿「开的那支反而更多」的对照喂进去必须红（否则 A/B 是装饰）
      id: "PC7-摊销确实少付账（A/B 同一条会话）",
      predicateSaysRed: () => {
        const a = { compactions: 2, rewrote: 5_000 };
        const b = { compactions: 3, rewrote: 6_000 };
        const holds = a.compactions >= 2 && b.compactions < a.compactions && b.rewrote < a.rewrote;
        return !holds;
      },
    },
    {
      // PC8 的分辨力：把「分批反而更多」的对照喂进去必须红（否则 A/B 是装饰）
      id: "PC8-分批裁剪确实少断前缀（A/B 同一条链）",
      predicateSaysRed: () => {
        // 与 PC8 的判据同式（否则自检证明的是另一件事）：这里造「分批只省了一次」的样本，
        // 它过得了旧条、过不了「至少省一半」——正是让那条针脚存活的形态。
        const a = { rewrites: 5, rewrote: 200_000, prunes: 5 }, b = { rewrites: 3, rewrote: 150_000, prunes: 3 };
        const holds = a.rewrites >= 4 && b.rewrites * 2 <= a.rewrites && b.prunes >= 1 && b.rewrote > 0 && b.rewrote < a.rewrote;
        return !holds;
      },
    },
    {
      // 「无分辨力」本身必须红：易变块一整轮都不变时，PC2 不得报通过
      id: "PC2 无分辨力也判红",
      predicateSaysRed: () =>
        !cacheableSurvivesVolatileChange(clean.map((o) => ({
          ...o,
          messages: o.messages.filter((m) => !(m.role === "system" && String(m.content).startsWith("VOL-"))),
        }))).ok,
    },
    {
      // PC9 的三种错法各能吃掉一条判据，所以三种样本都得红（只测一种 ⇒ 另一种针脚存活）：
      // ① 旗标忘清零 / 无条件放行 ⇒ 落盘轮比压缩轮多；
      // ② 整支删掉 ⇒ 落盘轮为空，而压缩确实断过三次头（白断不顺手剪）；
      // ③ 那条链本来没活干 ⇒ 「推迟」是沉默而不是策略，判据无分辨力。
      // 正样本先要绿，否则这三条红是"永远红"的假严格。
      id: "PC9-免费车只在断过头的那一轮放行",
      predicateSaysRed: () => {
        const good = [
          { prunableAtDecision: 2, compactions: 0, attachments: 0 },
          { prunableAtDecision: 3, compactions: 1, attachments: 2 },
          { prunableAtDecision: 3, compactions: 0, attachments: 0 },
          { prunableAtDecision: 4, compactions: 1, attachments: 2 },
        ];
        const sticky = good.map((r) => ({ ...r, attachments: 2 }));
        const removed = good.map((r) => ({ ...r, attachments: 0 }));
        const idle = good.map((r) => ({ ...r, prunableAtDecision: 0 }));
        // 对照臂自己的红绿：门槛拨到 1 时**每轮都该落盘**（含没压缩的轮）；
        // 若那条读数仍是"只在压缩轮落盘"，主判据的 coincidence 就毫无意义。
        const knobGreen = [
          { prunableAtDecision: 2, compactions: 0, attachments: 2 },
          { prunableAtDecision: 3, compactions: 1, attachments: 2 },
          { prunableAtDecision: 3, compactions: 0, attachments: 2 },
        ];
        const knobRed = [
          { prunableAtDecision: 2, compactions: 1, attachments: 2 },
          { prunableAtDecision: 3, compactions: 0, attachments: 0 },
        ];
        return (
          freeRideCoincidence(good).ok &&
          !freeRideCoincidence(sticky).ok &&
          !freeRideCoincidence(removed).ok &&
          !freeRideCoincidence(idle).ok &&
          thresholdKnobIsWired(knobGreen).ok &&
          !thresholdKnobIsWired(knobRed).ok
        );
      },
    },
  ];
  for (const p of probes) {
    let red = false;
    try {
      red = p.predicateSaysRed();
    } catch {
      red = false;
    }
    (red ? caught : missed).push(p.id);
  }
  return { caught, missed };
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--self-test")) {
    const r = runChurnSelfTest();
    console.log(`[prefix-churn-check] --self-test：造得红 ${String(r.caught.length)}/${String(r.caught.length + r.missed.length)}`);
    for (const id of r.caught) console.log(`  ✅ 造得红 ${id}`);
    for (const id of r.missed) console.log(`  ❌ 造不红 ${id} —— 这条判据是摆设`);
    process.exit(r.missed.length === 0 ? 0 : 1);
  }
  let failed = 0;
  for (const rule of CHURN_RULES) {
    let verdict: ChurnVerdict;
    try {
      verdict = await rule.run();
    } catch (err) {
      verdict = { ok: false, detail: "抛异常：" + (err instanceof Error ? err.message : String(err)) };
    }
    if (!verdict.ok) failed++;
    console.log(`  ${verdict.ok ? "✅" : "❌"} ${rule.id} — ${verdict.detail}`);
    if (!verdict.ok) console.log(`     为什么要有这条：${rule.why}`);
  }
  console.log(failed === 0 ? `[prefix-churn-check] ${String(CHURN_RULES.length)}/${String(CHURN_RULES.length)} 通过` : `[prefix-churn-check] ❌ ${String(failed)} 条不过`);
  process.exit(failed === 0 ? 0 : 1);
}

// 入口判定：单测 import 本模块不得把门跑起来（照 scripts/arch-boundary-check.ts 的写法）。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void main();
}
