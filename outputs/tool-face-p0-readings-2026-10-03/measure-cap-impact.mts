// P0 读数（只读）：把**仓库真实的 `planSurfaceBudget`** 套到历史真实工具表上，
// 看降配梯**会丢掉谁**——这是 V6 剩下的那一半，不必等新构建。
//
// 为什么能这么干：`request/header` 里存着每次请求发出去的完整工具表
// （`{name, description, parameters}`），足够还原成 `GlmToolSpec`。于是「24k 帽对真实面做了什么」
// 是一个**纯函数问题**，可以直接在历史数据上跑，不需要模型、不需要改代码、不需要重建 app。
//
// 诚实边界（读的人必须先看）：
//   · 历史工具名是 **app 层名**（`bash`/`read`/`edit`），`src/tools/` 是**内核名**
//     （`run_shell`/`read_file`/`edit_file`）。两套名字不同，所以下面用两种 core 口径各跑一遍，
//     **不要把任一遍当作「仓库上线后必然如此」**——它是量级与形状的证据，不是逐字预言。
//   · `systemChars` 一律取 **0**（最有利假设：首条 system 不占字符）。真实值只会让降配**更狠**，
//     所以下面的丢弃量是**下界**。
//   · 因此若在 `coreNames=∅` 下都丢得很多，那是很强的结论；若某口径下丢得少，**不能**反推
//     真实上线后也丢得少。
//
// 用法：node --import tsx outputs/tool-face-p0-readings-2026-10-03/measure-cap-impact.mts [--json]
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { zstdDecompressSync } from "node:zlib";
import { MODEL_SURFACE_TOTAL_CHAR_LIMIT, planSurfaceBudget } from "../../src/agent/model-surface";
import { isCoreSurfaceTool } from "../../src/agent/glm-session";
import type { GlmToolSpec } from "../../src/providers/glm";

const ROOT = join(homedir(), ".dsh", "sessions");
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

async function findLogs(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await findLogs(p, out);
    else if (e.isFile() && e.name.endsWith(".jsonl.zstd")) out.push(p);
  }
  return out;
}

function decodeAllFrames(buf: Buffer): string {
  const starts: number[] = [];
  for (let i = buf.indexOf(ZSTD_MAGIC); i >= 0; i = buf.indexOf(ZSTD_MAGIC, i + 4)) starts.push(i);
  const parts: string[] = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1]! : buf.length;
    try {
      parts.push(zstdDecompressSync(buf.subarray(starts[k]!, end)).toString("utf8"));
    } catch {
      /* 非帧边界的伪魔数：跳过（真正的中断由调用方按帧数差兜底） */
    }
  }
  return parts.join("");
}

interface RawTool { name?: unknown; description?: unknown; parameters?: unknown }

/** 历史工具条目 → `GlmToolSpec`。形状对不上就返回 null，由调用方计数（不静默丢）。 */
function toSpec(t: RawTool): GlmToolSpec | null {
  if (typeof t?.name !== "string" || t.name.length === 0) return null;
  return {
    type: "function",
    function: {
      name: t.name,
      ...(typeof t.description === "string" ? { description: t.description } : {}),
      parameters: (t.parameters && typeof t.parameters === "object"
        ? t.parameters
        : { type: "object", properties: {} }) as Record<string, unknown>,
    },
  };
}

interface Request { specs: GlmToolSpec[]; names: string[] }

async function collect(): Promise<{ requests: Request[]; unmapped: number; sessions: number }> {
  const logs = await findLogs(ROOT);
  const requests: Request[] = [];
  let unmapped = 0;
  let sessions = 0;
  for (const p of logs) {
    let text = "";
    try {
      text = decodeAllFrames(await readFile(p));
    } catch {
      continue;
    }
    sessions++;
    for (const line of text.split("\n")) {
      if (!line.includes('"type":"request/header"')) continue;
      let tools: unknown;
      try {
        tools = (JSON.parse(line) as { data?: { header?: { tools?: unknown } } }).data?.header?.tools;
      } catch {
        unmapped++;
        continue;
      }
      if (!Array.isArray(tools)) {
        unmapped++;
        continue;
      }
      const specs: GlmToolSpec[] = [];
      for (const t of tools) {
        const s = toSpec(t as RawTool);
        if (s) specs.push(s);
        else unmapped++;
      }
      if (specs.length > 0) requests.push({ specs, names: specs.map((s) => s.function.name) });
    }
  }
  return { requests, unmapped, sessions };
}

const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

interface Scenario {
  key: string;
  label: string;
  coreNames: ReadonlySet<string>;
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const { requests, unmapped, sessions } = await collect();

  // 使用集（上一件读数的产出）：用来判「被丢掉的工具里，有没有真被用过的」。
  let usage: Map<string, { calls: number; sessions: number }> = new Map();
  try {
    const raw = JSON.parse(
      await readFile(join(import.meta.dirname, "used-tools.json"), "utf8"),
    ) as { tools: { name: string; calls: number; sessions: number }[] };
    usage = new Map(raw.tools.map((t) => [t.name, { calls: t.calls, sessions: t.sessions }]));
  } catch {
    console.warn("[warn] 读不到 used-tools.json —— 先跑 measure-used-tools.mts；本次不判「丢掉的有没有被用过」");
  }

  // 「每份请求都在」的工具 = 数据驱动的常驻集（近似 core）。
  const presence = new Map<string, number>();
  for (const r of requests) for (const n of new Set(r.names)) presence.set(n, (presence.get(n) ?? 0) + 1);
  const alwaysPresent = new Set([...presence.entries()].filter(([, c]) => c === requests.length).map(([n]) => n));

  const scenarios: Scenario[] = [
    {
      key: "core=仓库口径（app 名多半匹配不上）",
      label: "仓库 core 口径：`isCoreSurfaceTool()` 直接问 app 层名字（预期多半落空）",
      coreNames: new Set([...presence.keys()].filter(isCoreSurfaceTool)),
    },
    {
      key: "core=数据驱动（每份请求都在）",
      label: "数据驱动 core：出现在**每一份**请求里的工具不许被砍",
      coreNames: alwaysPresent,
    },
    {
      key: "core=∅（最坏）",
      label: "最坏情况：没有任何 core 保护，全部可丢",
      coreNames: new Set<string>(),
    },
  ];

  const results = scenarios.map((sc) => {
    const droppedByRequest: string[][] = [];
    const shortenedByRequest: string[][] = [];
    let unresolvable = 0;
    for (const r of requests) {
      const plan = planSurfaceBudget({ specs: r.specs, systemChars: 0, coreNames: sc.coreNames });
      if (plan.dropped.length > 0) droppedByRequest.push(plan.dropped);
      if (plan.shortened.length > 0) shortenedByRequest.push(plan.shortened);
      if (plan.unresolvable) unresolvable++;
    }
    const droppedCounts = droppedByRequest.map((d) => d.length);
    const perName = new Map<string, number>();
    for (const d of droppedByRequest) for (const n of d) perName.set(n, (perName.get(n) ?? 0) + 1);
    const topDropped = [...perName.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, times]) => ({
        name,
        times,
        calls: usage.get(name)?.calls ?? null,
        sessions: usage.get(name)?.sessions ?? null,
      }));
    // 关键一问：被丢掉的工具里，有多少是**真实会话用过**的。
    const droppedUsedTools = new Set([...perName.keys()].filter((n) => usage.has(n)));
    const droppedCallMass = [...droppedUsedTools]
      .reduce((s, n) => s + (usage.get(n)?.calls ?? 0), 0);
    const totalCallMass = [...usage.values()].reduce((s, v) => s + v.calls, 0);
    return {
      key: sc.key,
      label: sc.label,
      coreSize: sc.coreNames.size,
      requestsDroppingAnything: droppedByRequest.length,
      requestsShortening: shortenedByRequest.length,
      requestsUnresolvable: unresolvable,
      droppedPerRequest: {
        min: droppedCounts.length ? Math.min(...droppedCounts) : 0,
        p50: quantile(droppedCounts, 0.5),
        p90: quantile(droppedCounts, 0.9),
        max: droppedCounts.length ? Math.max(...droppedCounts) : 0,
      },
      distinctDropped: perName.size,
      droppedUsedToolCount: droppedUsedTools.size,
      /** 被丢掉的工具在真实会话里承载的调用量占比——>0 即「丢了真在用的」。 */
      droppedCallMassPct: totalCallMass === 0 ? null : (100 * droppedCallMass) / totalCallMass,
      topDropped: topDropped.slice(0, 15),
    };
  });

  const report = {
    root: ROOT,
    sessions,
    requests: requests.length,
    unmappedToolEntries: unmapped,
    capChars: MODEL_SURFACE_TOTAL_CHAR_LIMIT,
    alwaysPresentCount: alwaysPresent.size,
    scenarios: results,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("== P0 读数：把仓库真实的 planSurfaceBudget 套到历史真实工具表上 ==");
  console.log("取料：" + ROOT);
  console.log("口径：`systemChars=0`（最有利假设，真实值只会丢得更多）；工具名是 app 层名，");
  console.log("      与内核名不同 ⇒ 看形状与量级，**不要**当逐字预言。");
  console.log("");
  console.log("  会话 " + report.sessions + " 份｜请求 " + report.requests + " 次｜形状对不上的条目 " + report.unmappedToolEntries);
  console.log("  每份请求都在的工具（数据驱动 core 的候选）：" + report.alwaysPresentCount + " 把");
  console.log("");

  for (const r of results) {
    console.log("  ── " + r.key + "（core " + r.coreSize + " 把）");
    console.log("     会丢东西的请求   " + r.requestsDroppingAnything + " / " + report.requests);
    console.log("     会压描述的请求   " + r.requestsShortening + " / " + report.requests);
    console.log("     unresolvable     " + r.requestsUnresolvable + " / " + report.requests);
    console.log("     每次丢几把       min " + r.droppedPerRequest.min + " / p50 " + r.droppedPerRequest.p50
      + " / p90 " + r.droppedPerRequest.p90 + " / max " + r.droppedPerRequest.max);
    console.log("     丢过的不同工具   " + r.distinctDropped + " 把"
      + (r.droppedUsedToolCount > 0
        ? "，**其中 " + r.droppedUsedToolCount + " 把是真实会话用过的**（承载 "
          + (r.droppedCallMassPct ?? 0).toFixed(1) + "% 的调用量）"
        : "（没有一把被真实用过）"));
    console.log("     最常被丢的：");
    for (const t of r.topDropped.slice(0, 8)) {
      console.log("        " + t.name.padEnd(28) + " 被丢 " + String(t.times).padStart(4) + " 次"
        + "｜真实调用 " + (t.calls === null ? "从未" : String(t.calls)));
    }
    console.log("");
  }

  await writeFile(
    join(import.meta.dirname, "cap-impact.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );
  console.log("  明细已写：" + join(import.meta.dirname, "cap-impact.json"));
}

await main();
