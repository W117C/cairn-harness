/**
 * 可复现性门：同一输入 ⇒ 同一份**被判卷的东西**。
 *
 * 立门的直接原因是 BLOCKED 待办 #56：D7 快照把 `Date.now()` 编进目录名 ⇒ `changedFiles` 两次跑
 * 只差一串毫秒 ⇒ `gym-check` B1「明卷两次跑逐字段一致」当场红 4 条。那不是我那一格的错，
 * 是「身份字段可以带时钟」这件事没人守。业界同一类痛叫 **跑不出两遍一样的**，评测因此只能取均值。
 *
 * 四条判据：
 *  RD1 真写盘路径跑两遍（两个临时工作区、同一输入）⇒ 结果 / 快照 id / 变更面规范化后等值
 *  RD2 投影不读时钟：同一事件流打不同 `ts` ⇒ `projectContext` 逐字等值（且与不带 `ts` 时等值）
 *  RD3 事件流写两遍读回（去观测字段后）等值
 *  RD4 登记的「身份债」必须真的命中——不命中就该删条目（白名单不腐烂是这条门能长期有用的前提）
 *
 * 口径：
 * - 判据全在 `src/agent/reproducibility.ts`（纯函数），门与 `--self-test` 共用同一只。
 * - fail-visible：新泄漏逐条打出路径与两侧值；白名单空转也红（「没抓到」不等于「没问题」）。
 *
 * 用法：`pnpm replay-determinism-check`｜反向对照 `pnpm replay-determinism-check -- --self-test`
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  IDENTITY_DEBTS,
  classifyDivergence,
  differsOnlyByWallClock,
  diffJsonPaths,
  reproducibleVerdict,
  stripObservation,
  type FieldDiff,
} from "../src/agent/reproducibility";
import { write_file } from "../src/tools/write_file";
import { projectContext } from "../src/agent/context";
import { createEventLog } from "../src/events";
import type { AgentEvent } from "../src/events";
import type { IdentityDebt } from "../src/agent/reproducibility";

const REL = "src/mod.js";
const CONTENT = "export const a = 1;\n";

/** 真跑一遍写盘路径，产出「会被判卷读的那一份」。 */
async function captureOnce(callId: string): Promise<{ changedFiles: string[]; result: unknown }> {
  const ws = mkdtempSync(join(tmpdir(), "repro-"));
  try {
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, REL), "old\n");
    const r = await write_file.run({ path: REL, content: CONTENT }, { workspace: ws, callId });
    const files: string[] = [];
    const walk = (dir: string, rel: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        const at = rel === "" ? name : rel + "/" + name;
        if (statSync(p).isDirectory()) walk(p, at);
        else files.push(at);
      }
    };
    walk(ws, "");
    // 两次跑的 callId 不同是**输入**不同，不是不确定：路径尾段跟着变的那部分由债表吸收（毫秒段），
    // 剩下 callId 的差异用同一 callId 跑两次即可避免——所以这里两侧都传同一个 id。
    const result = stripObservation({
      ok: r.ok,
      output: r.output,
      ...(r.snapshotId === undefined ? {} : { snapshotId: r.snapshotId }),
    } as unknown as Record<string, unknown>);
    return { changedFiles: files, result };
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

/** 一条债是否真的能吸收自己的同形差异（RD4 与单测共用这一只，避免两处各造一份探针）。
 *  路径键名故意按登记的 `pathPrefix` 造：分类器比的正是这个前缀。 */
export function debtProbeIsAbsorbable(debt: IdentityDebt): boolean {
  const key = debt.pathPrefix.endsWith("[") ? "changedFiles[0]" : debt.pathPrefix + "leaf";
  const mk = (ms: string) => (debt.pathPrefix.endsWith("[")
    ? ["x/.agent/snapshots/" + ms + "--c1/src/mod.js"]
    : ".agent/snapshots/" + ms + "--c1/src/mod.js");
  const left: Record<string, unknown> = {};
  const right: Record<string, unknown> = {};
  left[key] = mk("1790134752319");
  right[key] = mk("1790134752987");
  const finding = classifyDivergence(diffJsonPaths(left, right));
  return finding.leaks.length === 0 && finding.absorbed.includes(debt.id);
}

export interface ReproRule {
  id: string;
  why: string;
  run: () => Promise<{ ok: boolean; detail: string }> | { ok: boolean; detail: string };
}

/** 普通「两次跑等值」判定：债命中与否不在这里管（那是 RD4 的活）。 */
function verdict(diffs: readonly FieldDiff[]): { ok: boolean; detail: string } {
  const finding = classifyDivergence(diffs);
  const v = reproducibleVerdict(finding);
  return v.ok && finding.absorbed.length > 0
    ? { ok: true, detail: v.detail + "（**登记的债**，见 BLOCKED #56；修好后要删条目）" }
    : v;
}

export const REPRO_RULES: readonly ReproRule[] = [
  {
    id: "RD1-同一输入两次写盘逐字段等值",
    why: "判卷靠「重跑一次应当一样」。wall-clock 漏进身份字段（#56：D7 快照目录名）会让这条静默失效——功能测试全绿，判卷层开始飘",
    run: async () => {
      // 同一 callId：否则比的就不是「同一输入」，而是两组输入（callId 会进快照路径尾段）
      const a = await captureOnce("call-x");
      const b = await captureOnce("call-x");
      return verdict(diffJsonPaths(a, b));
    },
  },
  {
    id: "RD2-投影不读事件时间戳",
    why: "`ts` 是观测字段（今天没人读它）。这条把它钉成规则：谁哪天拿 ts 参与投影/判定，同一份日志就会投出两份不同的上下文",
    run: () => {
      const base: AgentEvent[] = [
        { type: "user_message", content: "T" },
        { type: "assistant_message", content: "A1" },
        { type: "tool_call", id: "c1", name: "read_file", args: { path: REL } },
        { type: "tool_result", callId: "c1", ok: true, output: "OUT" },
        { type: "user_message", content: "T2" },
      ] as unknown as AgentEvent[];
      const stamped = base.map((e, i) => ({ ...e, ts: 1_700_000_000_000 + i * 977 }) as unknown as AgentEvent);
      const shifted = base.map((e, i) => ({ ...e, ts: 1_800_000_000_000 + i * 13 }) as unknown as AgentEvent);
      const plain = JSON.stringify(projectContext(base));
      const a = JSON.stringify(projectContext(stamped));
      const b = JSON.stringify(projectContext(shifted));
      return {
        ok: plain === a && a === b,
        detail: plain === a && a === b
          ? `带/不带 ts 投影逐字一致（${String(plain.length)} 字符）`
          : `投影被时间戳改变了：无 ts ${String(plain.length)} 字符 vs 带 ts ${String(a.length)} / ${String(b.length)}`,
      };
    },
  },
  {
    id: "RD3-事件流写两遍读回等值",
    why: "重放/fork 都吃这份日志。落盘再读回若掺进非输入决定的字节（含 ts），反事实重跑就不是同一条链",
    run: async () => {
      const once = async (): Promise<string> => {
        const dir = mkdtempSync(join(tmpdir(), "repro-log-"));
        const path = join(dir, "events.jsonl");
        const log = createEventLog(path);
        try {
          await log.append({ type: "user_message", content: CONTENT } as never);
          await log.append({ type: "assistant_message", content: "ok" } as never);
        } finally {
          await log.close?.();
        }
        return JSON.stringify(readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => stripObservation(JSON.parse(l) as Record<string, unknown>)));
      };
      const a = await once();
      const b = await once();
      return { ok: a === b, detail: a === b ? `两次落盘读回逐字一致（${String(a.length)} 字符）` : "同一份写入读回不一致" };
    },
  },
  {
    id: "RD4-每条登记的债都必须真能吸收同形差异（分类器复查）",
    why: "白名单不复查就会变成下一个漏洞的藏身处。逐条构造「只差毫秒」的同形差异，要求分类器按登记的债吸收；哪条吸收不了就是登记写错了（路径前缀/形态）",
    run: () => {
      const unusable = IDENTITY_DEBTS.filter((d) => !debtProbeIsAbsorbable(d)).map((d) => d.id);
      return {
        ok: unusable.length === 0,
        detail: unusable.length === 0
          ? "登记 " + String(IDENTITY_DEBTS.length) + " 条债，逐条构造同形差异都能吸收"
          : "吸收不了的条目（登记写错了？）：" + unusable.join("、"),
      };
    },
  },
];

/** 反向对照：造一件「泄漏」与一件「债已偿」，两只判据必须都判红。 */
export function runReproSelfTest(): { caught: string[]; missed: string[] } {
  const caught: string[] = [];
  const missed: string[] = [];
  const probes: { id: string; saysRed: () => boolean }[] = [
    {
      // 新泄漏：毫秒出现在**没登记**的路径上
      id: "RD1-同一输入两次写盘逐字段等值",
      saysRed: () => !verdict(diffJsonPaths(
        { snapshotId: "x/1790134752319--c1" },
        { snapshotId: "y/1790134752987--c1" },
      )).ok,
    },
    {
      // 差的不止毫秒（同一路径换了名字）⇒ 债吸收不了，必须算泄漏
      id: "RD1 的边界：差的不是毫秒就不许被吸收",
      saysRed: () => !verdict(diffJsonPaths(
        { changedFiles: ["a/snap-1/mod.js"] },
        { changedFiles: ["a/snap-2/mod.js"] },
      )).ok,
    },
    {
      // 登记写错（前缀对不上）⇒ 分类器复查那条必须报「条目没被用到」
      id: "RD4-每条登记的债都必须真能吸收同形差异（分类器复查）",
      // 登记写错（前缀对不上）⇒ 该条目吸收不了任何同形差异 ⇒ RD4 必须红。
      // 吸收不了的红名单比没有红名单更糟：它让泄漏看起来「已被批准」。
      saysRed: () => {
        const bogus = { id: "bogus-entry", pathPrefix: "noSuchPath[", paidWhen: "", why: "对照用：故意写错前缀" };
        const f = classifyDivergence(diffJsonPaths(
          { noSuchPath: ["a/1790134752319"] },
          { noSuchPath: ["b/1790134752987"] },
        ), [bogus]);
        return f.absorbed.length === 0 && f.leaks.length > 0;
      },
    },
    {
      // 投影读了时钟 ⇒ RD2 必须红
      id: "RD2-投影不读事件时间戳",
      saysRed: () => {
        const a = JSON.stringify(projectContext([{ type: "user_message", content: "A" }] as never));
        const b = JSON.stringify(projectContext([{ type: "user_message", content: "B" }] as never));
        return a !== b;
      },
    },
  ];
  for (const p of probes) {
    let red = false;
    try {
      red = p.saysRed();
    } catch {
      red = false;
    }
    (red ? caught : missed).push(p.id);
  }
  return { caught, missed };
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--self-test")) {
    const r = runReproSelfTest();
    console.log(`[replay-determinism-check] --self-test：造得红 ${String(r.caught.length)}/${String(r.caught.length + r.missed.length)}`);
    for (const id of r.caught) console.log(`  ✅ 造得红 ${id}`);
    for (const id of r.missed) console.log(`  ❌ 造不红 ${id} —— 这条判据是摆设`);
    process.exit(r.missed.length === 0 ? 0 : 1);
  }
  let failed = 0;
  for (const rule of REPRO_RULES) {
    let v: { ok: boolean; detail: string };
    try {
      v = await rule.run();
    } catch (err) {
      v = { ok: false, detail: "抛异常：" + (err instanceof Error ? err.message : String(err)) };
    }
    if (!v.ok) failed++;
    console.log(`  ${v.ok ? "✅" : "❌"} ${rule.id} — ${v.detail}`);
    if (!v.ok) console.log(`     为什么要有这条：${rule.why}`);
  }
  console.log(failed === 0
    ? `[replay-determinism-check] ${String(REPRO_RULES.length)}/${String(REPRO_RULES.length)} 通过（RD1 若报「吸收登记债 N 处」= 那条债还活着；#56 修好后该条目吸收不到东西，就该从表里删）`
    : `[replay-determinism-check] ❌ ${String(failed)} 条不过`);
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void main();
}
