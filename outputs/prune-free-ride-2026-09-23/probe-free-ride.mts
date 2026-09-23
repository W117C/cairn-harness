/** 免费车（freeRide）可达性探针：压缩打断前缀那一轮顺手剪一刀，这条支路在真 provider 上
 *  到底走不走得到？门槛抬到不可能达到的量（`minSavedTokens`），于是「剪了」只剩一种解释。
 *  跑法：TERM=dumb node --import tsx outputs/prune-free-ride-2026-09-23/probe-free-ride.mts
 *  参数：PROBE_INPUT_LIMIT / PROBE_RATIO / PROBE_ROUNDS / PROBE_RESULT_CHARS 控制配方。 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog } from "../../src/events";
import { createMockSummarizer } from "../../src/agent/compaction";
import { sessionToolSpecs } from "../../src/agent/glm-session";
import type { GlmMessage, GlmToolSpec } from "../../src/providers/glm";

const cjk = (n: number) => "的".repeat(n);
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const INPUT_LIMIT = num(process.env.PROBE_INPUT_LIMIT, 60_000);
const RATIO = num(process.env.PROBE_RATIO, 0.35);
const ROUNDS = num(process.env.PROBE_ROUNDS, 8);
const RESULT_CHARS = num(process.env.PROBE_RESULT_CHARS, 20_000);
const SEED_ROUNDS = num(process.env.PROBE_SEED, 2);

const dir = mkdtempSync(join(tmpdir(), "free-ride-probe-"));
const path = join(dir, "events.jsonl");
const attachments = join(dir, "prune-attachments");
const log = createEventLog(path);

const roundEvents = (i: number) => [
  { type: "user_message", content: "Q" + String(i) },
  { type: "tool_call", id: "c" + String(i), name: "read_file", args: { path: "f" + String(i) } },
  { type: "tool_result", callId: "c" + String(i), ok: true, output: cjk(RESULT_CHARS) },
  { type: "assistant_message", content: "A" + String(i) },
];
for (let i = 0; i < SEED_ROUNDS; i++) for (const e of roundEvents(i)) await log.append(e as never);
await log.close?.();

const countCompact = () => (readFileSync(path, "utf8").match(/"type":"compaction"/g) ?? []).length;
const countAttach = () => {
  try {
    return readdirSync(attachments).length;
  } catch {
    return 0;
  }
};

const debugs: string[] = [];
const origDebug = console.debug;
console.debug = (...a: unknown[]) => {
  debugs.push(a.map(String).join(" "));
};

const { createGlmSessionProvider } = await import("../../src/agent/glm-session");
let roundIndex = 0;
const provider = createGlmSessionProvider(path, {
  map: false,
  workspace: dir,
  system: "你是免费车探针的固定基础提示。".repeat(8),
  // 门槛抬到 10^9：除了免费车，没有别的理由可以让它剪。
  pruneBatching: { minSavedTokens: 1_000_000_000 },
  compaction: {
    config: { inputLimit: INPUT_LIMIT, maxOutputReserve: 400, ratio: RATIO, retryBackoffMs: 1 },
    summarizer: createMockSummarizer("SUMMARY：前文已压缩为一段，结论与未收口项都在里面。".repeat(12)),
  },
  requestFace: () => ({ tools: sessionToolSpecs({ mode: "default" }).specs, note: "" }),
  transport: async function* (_m: GlmMessage[], _o: unknown, _s?: GlmToolSpec[]) {
    yield { type: "assistant_message" as const, content: "round-" + String(roundIndex) };
  },
});

let beforeCompact = countCompact();
let beforeAttach = countAttach();
for (let r = 0; r < ROUNDS; r++) {
  roundIndex = r;
  debugs.length = 0;
  for await (const _ of provider.stream([])) void _;
  const c = countCompact(), a = countAttach();
  console.log(
    "轮", String(r + 1),
    "压缩+", String(c - beforeCompact),
    "附件+", String(a - beforeAttach),
    "|", debugs.filter((d) => d.includes("[prune]")).map((d) => d.slice(0, 120)).join(" / ") || "（无推迟出声）",
  );
  beforeCompact = c;
  beforeAttach = a;
  for (const e of roundEvents(100 + r)) await log.append(e as never);
}
console.debug = origDebug;
console.log("合计：压缩", String(countCompact()), "次 / 附件", String(countAttach()), "份 / 输入上限", String(INPUT_LIMIT), "ratio", String(RATIO), "结果字符", String(RESULT_CHARS), "种子轮", String(SEED_ROUNDS));
rmSync(dir, { recursive: true, force: true });
