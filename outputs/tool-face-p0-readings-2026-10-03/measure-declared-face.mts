// P0 读数（只读）：从历史会话日志里直接量**真实声明工具面**——这是 P0 的核心问题。
//
// 为什么这条能成立：`~/.dsh/sessions/**/session.v4.jsonl.zstd` 的 v4 词表里有
//   `{"type":"request/header","data":{"header":{"tools":[{"name","description","parameters"},…]}}}`
// ——**每次请求发出去的完整工具表都在里面**。所以「真实面多大、有没有撞 24k 帽」这一格
// 不必等 `surface_account` 落地后再跑新会话，**历史日志就能回答**。这是 2026-10-03 才发现的，
// 此前所有相关文档（含本次 P0 设计与评审）都以为事件流里没有这个信息。
//
// 口径（读的人必须先看）：
//   · 这里量的是**已发出去的**那份（post-degradation），即 `SurfacePlan.specs` 那一侧。
//     它**不是**声明面/入参那一份——降配梯吃掉的量在日志里看不见（那正是要新事件的理由）。
//   · 因此「字符数 < 24000」只能说**送出面**在帽内；不能证明降配梯没被触发过。
//     但反过来成立且有用：**若某个请求的工具表本身就 > 24000 字符，那这一轮降配梯必然开过火**
//     ——因为 24k 帽下正常的送出面不可能超（除非 core 装不下报 unresolvable）。
//   · 24k 帽是 `首条 system + 工具 JSON` 之和，这里只量了工具那一项。缺的这一项只会让
//     真实面**更大**，所以这里的越线判定是**保守**的（宁可漏报，不误报）。
//   · 与 `src/agent/model-surface.ts` 的 `surfaceSpecChars` 同口径：`JSON.stringify(tools).length`。
//
// 格式坑见 `measure-used-tools.mts` 头注（多帧 zstd；v4 词表 ≠ 内核词表）。
//
// 用法：node --import tsx outputs/tool-face-p0-readings-2026-10-03/measure-declared-face.mts [--json]
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { zstdDecompressSync } from "node:zlib";

/** 目标已存在时拒写（2026-10-12 加，同 `measure-used-tools.mts`）：本脚本从前**直写**本目录那份
 *  **已入库**的读数 ⇒ 谁再跑一次就把它静默顶掉。要另存 `--to=<路径>`，确实要覆盖再加 `--force`。 */
const TO_ARG = process.argv.find((a) => a.startsWith("--to="));
const OUT_PATH = TO_ARG !== undefined ? TO_ARG.slice("--to=".length) : join(import.meta.dirname, "declared-face.json");
if (existsSync(OUT_PATH) && !process.argv.includes("--force")) {
  console.error("[measure-declared-face] 目标已存在，拒写：" + OUT_PATH);
  console.error("  要另存：--to=<新路径>；确实要覆盖：再加 --force。");
  process.exit(2);
}

const ROOT = join(homedir(), ".dsh", "sessions");
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
/** 与 `src/agent/model-surface.ts` 的 `MODEL_SURFACE_TOTAL_CHAR_LIMIT` 同值。
 *  不 import 那个模块：本读数件只读历史日志，没必要把内核依赖链拉进来（`prompt-cost.ts` 有过同款裁量）。 */
const CAP_CHARS = 24_000;

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

function decodeAllFrames(buf: Buffer): { text: string; frames: number; framesFailed: number } {
  const starts: number[] = [];
  for (let i = buf.indexOf(ZSTD_MAGIC); i >= 0; i = buf.indexOf(ZSTD_MAGIC, i + 4)) starts.push(i);
  if (starts.length === 0) return { text: "", frames: 0, framesFailed: buf.length > 0 ? 1 : 0 };
  const parts: string[] = [];
  let frames = 0;
  let framesFailed = 0;
  let k = 0;
  while (k < starts.length) {
    const end = k + 1 < starts.length ? starts[k + 1]! : buf.length;
    try {
      parts.push(zstdDecompressSync(buf.subarray(starts[k]!, end)).toString("utf8"));
      frames++;
      k++;
    } catch {
      if (k + 1 < starts.length) {
        starts[k + 1] = starts[k]!;
        k++;
      } else {
        framesFailed++;
        k++;
      }
    }
  }
  return { text: parts.join(""), frames, framesFailed };
}

interface FaceReading {
  toolCount: number;
  toolChars: number;
  model: string;
  names: string[];
}

interface SessionFaces {
  path: string;
  isSubagent: boolean;
  faces: FaceReading[];
  malformedHeaders: number;
}

function readFaces(path: string, text: string, isSubagent: boolean): SessionFaces {
  const faces: FaceReading[] = [];
  let malformedHeaders = 0;
  for (const line of text.split("\n")) {
    if (!line.includes('"type":"request/header"')) continue;
    try {
      const ev = JSON.parse(line) as {
        data?: { header?: { tools?: unknown; config?: { model?: unknown } } };
      };
      const tools = ev.data?.header?.tools;
      if (!Array.isArray(tools)) {
        malformedHeaders++;
        continue;
      }
      const names = tools
        .map((t) => (t && typeof t === "object" ? (t as { name?: unknown }).name : undefined))
        .filter((n): n is string => typeof n === "string");
      const model = ev.data?.header?.config?.model;
      faces.push({
        toolCount: tools.length,
        // 与内核 `surfaceSpecChars` 同口径：序列化长度（不是名字长度之和）。
        toolChars: JSON.stringify(tools).length,
        model: typeof model === "string" ? model : "(未记)",
        names,
      });
    } catch {
      malformedHeaders++;
    }
  }
  return { path, isSubagent, faces, malformedHeaders };
}

const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const logs = await findLogs(ROOT);
  const sessions: SessionFaces[] = [];
  const unreadable: { path: string; error: string }[] = [];

  for (const p of logs) {
    try {
      const decoded = decodeAllFrames(await readFile(p));
      const head = JSON.parse(decoded.text.split("\n")[0] ?? "{}") as { parentSession?: unknown };
      const isSubagent = typeof head.parentSession === "string" && head.parentSession.length > 0;
      sessions.push(readFaces(p, decoded.text, isSubagent));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      unreadable.push({ path: p, error: msg });
      console.error("[读不开] " + p + " —— " + msg);
    }
  }

  const allFaces = sessions.flatMap((s) => s.faces);
  const counts = allFaces.map((f) => f.toolCount);
  const chars = allFaces.map((f) => f.toolChars);
  const over = allFaces.filter((f) => f.toolChars > CAP_CHARS);

  // 声明宇宙：所有请求里出现过的工具名并集（**历史真实可见面**，不是使用集）。
  const universe = new Map<string, number>();
  for (const f of allFaces) for (const n of f.names) universe.set(n, (universe.get(n) ?? 0) + 1);

  // 逐会话内工具表是否变过（变小 = 降配梯开过火 / skill 摘除；变大 = 中途装载）。
  const changedWithin = sessions
    .filter((s) => s.faces.length > 1)
    .map((s) => {
      const ns = s.faces.map((f) => f.toolCount);
      const min = Math.min(...ns);
      const max = Math.max(...ns);
      return { path: s.path, isSubagent: s.isSubagent, requests: s.faces.length, min, max, changed: min !== max };
    });
  const shrinkers = changedWithin.filter((c) => c.changed);

  const malformed = sessions.reduce((s, x) => s + x.malformedHeaders, 0);

  const report = {
    root: ROOT,
    sessions: sessions.length,
    sessionsUnreadable: unreadable,
    sessionsWithHeaders: sessions.filter((s) => s.faces.length > 0).length,
    requestsWithHeader: allFaces.length,
    malformedHeaders: malformed,
    capChars: CAP_CHARS,
    toolCount: {
      min: counts.length ? Math.min(...counts) : 0,
      p50: quantile(counts, 0.5),
      p90: quantile(counts, 0.9),
      max: counts.length ? Math.max(...counts) : 0,
    },
    toolChars: {
      min: chars.length ? Math.min(...chars) : 0,
      p50: quantile(chars, 0.5),
      p90: quantile(chars, 0.9),
      max: chars.length ? Math.max(...chars) : 0,
    },
    requestsOverCapOnToolsAlone: over.length,
    overCapExamples: over.slice(0, 5).map((f) => ({ toolCount: f.toolCount, toolChars: f.toolChars, model: f.model })),
    declaredUniverseSize: universe.size,
    declaredUniverse: [...universe.entries()].sort((a, b) => b[1] - a[1]).map(([name, reqs]) => ({ name, requests: reqs })),
    sessionsWithVaryingFace: shrinkers,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("== P0 读数：历史日志里的真实**工具面**（每次请求发出去的那份）==");
  console.log("取料：" + ROOT);
  console.log("口径：这是**送出面**（post-degradation）。>24k 字符 ⇒ 该轮降配梯必然开过火；");
  console.log("      <24k 只能说明送出面在帽内，**不能**反推没触发过（缺的首条 system 只会让真实面更大）。");
  console.log("");
  console.log("  会话              " + report.sessions + " 份（带 request/header 的 " + report.sessionsWithHeaders + " 份）");
  console.log("  请求（头）        " + report.requestsWithHeader + " 次");
  if (report.malformedHeaders > 0) console.log("  头解析失败        " + report.malformedHeaders + " 次（已点名，不静默）");
  if (unreadable.length > 0) console.log("  读不开            " + unreadable.length + " 份");
  console.log("");
  console.log("  工具件数      min " + report.toolCount.min + " / p50 " + report.toolCount.p50
    + " / p90 " + report.toolCount.p90 + " / max " + report.toolCount.max);
  console.log("  工具字符      min " + report.toolChars.min + " / p50 " + report.toolChars.p50
    + " / p90 " + report.toolChars.p90 + " / max " + report.toolChars.max);
  console.log("  **工具单项 > " + CAP_CHARS + " 字符的请求**  " + report.requestsOverCapOnToolsAlone + " 次");
  for (const e of report.overCapExamples) {
    console.log("      " + e.toolCount + " 把 / " + e.toolChars + " 字符  (" + e.model + ")");
  }
  console.log("");
  console.log("  **历史可见工具宇宙**  " + report.declaredUniverseSize + " 把（所有请求里出现过的名字并集）");
  console.log("");
  console.log("  同一会话内工具表变过的会话：" + report.sessionsWithVaryingFace.length + " 份");
  for (const c of report.sessionsWithVaryingFace.slice(0, 10)) {
    console.log("      " + (c.isSubagent ? "子代理" : "主会话") + " 请求 " + String(c.requests).padStart(3)
      + " 次｜件数 " + c.min + "→" + c.max);
  }

  await writeFile(
    OUT_PATH,
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );
  console.log("");
  console.log("  明细已写：" + OUT_PATH);
}

await main();
