/**
 * 前缀抖动门（cache churn / 装配前缀单调性）。
 *
 * 为什么判「我们这一侧」而不判命中率：真实录制显示命中/未命中是**全有或全无**（命中平均 86.6%、
 * 未命中 0%、41.5% 的暖轮整段归零），而归零发生在**上游** ⇒ 拿命中率当判据 = 一扇随机红的门。
 * 读数与判读：`outputs/prefix-churn-2026-09-23/00-实测发现.md`。
 * 本门钉的是那条**确定性**纪律：**没有声明的变异源时，装配必须逐字纯追加；易变块变了不得牵连
 * 可缓存前缀；工具面自己变了必须出声**。
 *
 * 口径：
 * - 判据全部住在 `src/agent/prefix-churn.ts`（纯函数），门与 `--self-test` 共用同一只。
 * - 观测来自**真 provider 真正发出去的那一对**（`transport(messages, _o, tools)`），不是源码形状断言。
 * - 分层按装配探针的词汇：可缓存面 = 首条 system + 工具面；易变面 = 其余 system 块。
 * - fail-visible：判据无分辨力（该变的没变）时**门自身红**，不报「通过」。
 *
 * 用法：`pnpm prefix-churn-check`｜反向对照 `pnpm prefix-churn-check -- --self-test`
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createEventLog } from "../src/events";
import { gateToolSpecs, sessionToolSpecs } from "../src/agent/glm-session";
import type { GlmMessage, GlmToolSpec } from "../src/providers/glm";
import {
  breakByFoldingVolatileIntoHead,
  breakByMiddleSplice,
  cacheableSurvivesVolatileChange,
  historyPurelyAppends,
  oversizedFaceIsDeterministic,
  toolFaceChangeIsNamed,
  type AssemblyObservation,
  type ChurnVerdict,
} from "../src/agent/prefix-churn";
import { planSurfaceBudget } from "../src/agent/model-surface";
import { pluginFixture } from "./model-surface-check";

const SYSTEM_TEXT = "你是前缀抖动门的固定基础提示。".repeat(8);
const CORE_NAMES: ReadonlySet<string> = new Set(gateToolSpecs().map((s) => s.function.name));

/** 驱动真 provider 走若干轮，收回每一轮真正发出去的 (messages, tools, note)。
 *  `volatileEachRound` ⇒ 易变块每轮不同（模拟记忆/skills 逐轮重读）；
 *  `faceChangeAt` ⇒ 第 n 轮起工具面少一把且带说明（模拟 run 中途 skill 摘除）。 */
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
    for (let r = 1; r <= opts.rounds; r++) {
      // requestFace 与 transport 是同轮的两个回调：note 走这只局部变量搭桥（不是模块级，避免轮间串台）
      let faceNote = "";
      const provider = createGlmSessionProvider(path, {
        map: false,
        workspace: dir,
        system: SYSTEM_TEXT,
        ...(opts.volatileEachRound ? { plugins: { deriveRemount: () => "REMOUNT-" + String(r) } } : {}),
        requestFace: () => {
          const base = sessionToolSpecs({
            mode: "default",
            ...(opts.pluginTools ? { pluginTools: opts.pluginTools } : {}),
          });
          if (opts.faceChangeAt !== undefined && r >= opts.faceChangeAt) {
            const dropped = base.specs[base.specs.length - 1];
            faceNote = "[skill 工具面] 本 turn 已按 disallowed-tools 从可见工具表摘除：" + String(dropped?.function.name ?? "?");
            return { tools: base.specs.slice(0, -1), note: faceNote };
          }
          return { tools: base.specs, note: "" };
        },
        transport: async function* (messages: GlmMessage[], _o: unknown, specs?: GlmToolSpec[]) {
          seen.push({ messages: [...messages], tools: specs ? [...specs] : undefined, faceNote });
          yield { type: "assistant_message" as const, content: "r" + String(r) };
        },
      });
      for await (const _ of provider.stream([])) void _;
      // 轮间发生的事：模型答一句、用户再问一句 ⇒ 历史确实逐轮变长（只用已确证形状的事件类型）
      await log.append({ type: "assistant_message", content: "r" + String(r) });
      await log.append({ type: "user_message", content: "Q-" + String(r) });
    }
  } finally {
    await log.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
  return seen;
}

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
      return oversizedFaceIsDeterministic(() => {
        const plan = planSurfaceBudget({ specs, systemChars: SYSTEM_TEXT.length, coreNames: CORE_NAMES });
        return plan.specs;
      }, 4);
    },
  },
];

/** 反向对照：每只判据喂一件故意做错的工件，要求它判假。 */
export function runChurnSelfTest(): { caught: string[]; missed: string[] } {
  const caught: string[] = [];
  const missed: string[] = [];
  const clean: AssemblyObservation[] = [1, 2, 3].map((n) => ({
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
        !historyPurelyAppends([
          ...clean.slice(0, 2),
          { ...clean[2]!, messages: breakByMiddleSplice(clean[1]!.messages) },
        ]).ok,
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
          const specs = sessionToolSpecs({ mode: "default", pluginTools: pluginFixture(60, 1_200) }).specs;
          const rotated = [...specs.slice(round), ...specs.slice(0, round)]; // 顺序抖动 = 降配集合跟着抖
          return planSurfaceBudget({ specs: rotated, systemChars: SYSTEM_TEXT.length, coreNames: CORE_NAMES }).specs;
        }, 3).ok,
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void main();
}
