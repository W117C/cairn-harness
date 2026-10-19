// 判卷 · 两条**裸复跑面**的保护（`replay:lessons-offline` / `replay:lessons-round-ab`）。
//
// 立这份的理由：这两条面在 `tests/` 里**一条判据都没有**——它们只被人手工跑、没人钉。
// 一条只被人手工跑的面会在两种方向上悄悄坏掉而没有任何人知道：
//   ① 面自己崩了 / 退了非 0，而没人看；
//   ② 面里那句**照实写的不可达声明**被谁图省事删掉，于是它看起来像「两轮 A/B 全测了」。
// 所以本判卷真起进程跑它们，钉的是「**跑得过**」与「**该说的话还在**」，不是钉读数本身的值
// （两个面的读数都随本机语料变化，钉死值只会训练人在语料一变时改判据）。
//
// 这也是 `replay-readings.ts` 那张登记表的等价物（业主口径）：面进了判卷面，才算真被门看着。
//
// ⚠️ 两条面都会**扫本机真会话目录**（`~/Library/Application Support/cairn-harness/sessions`）：
// 那是**只读**的，本判卷不写也不删那边的任何东西。
// `lessons-round-ab.ts` 从前**不是**只读面：它把靶子 `fixtures/todo-app` 当自己的运行工作区
// （往 `.agent/memory` 写教训、覆盖 `src/todo.ts`、往 `.agent/snapshots/` 落快照），收尾那句
// `rm -rf fixtures/todo-app/.agent/memory` 会把该目录里**先于它存在**的内容一起删掉。
// 本轮已把它改成在 `.tmp/` 下建**隔离工作区**、收尾只回收那一份 ⇒ 靶子全程只读，
// 下面那条「整树递归哈希前后逐字节相同」的硬不变量把它钉死。
// 那层「先快照 `.agent/memory` 再原样恢复」的护栏（`withFixtureMemoryKept`）留着不撤：
// 它是这条不变量的第二道保险——万一有人把面改回去动靶子，护栏至少在判卷自身这侧不留净副作用。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireAppFixtureLock } from "./app-fixture-lock";

const HERE = resolve(fileURLToPath(import.meta.url), "../..");
/** 面的墙钟预算：离线面实测 <1s、round-ab 实测 ~2s；给足余量以吸收冷启动与并发负载
 *  （vitest 自己的 `testTimeout` 是 30s，也在同一条线上兜底）。 */
const RUN_TIMEOUT_MS = 120_000;
const FIXTURE_TREE = join(HERE, "fixtures", "todo-app");
const MEMORY_DIR = join(FIXTURE_TREE, ".agent", "memory");

/** 递归哈希一整棵树：**工作区相对路径 + 内容字节**进哈希（软链取链接文本，不跟随）。
 *  含 `src/`、`tests/`、`.agent/` 下所有文件的名字与内容——不只是判卷面的那三份，
 *  也不漏 `node_modules/`（它也在靶子树里）。两次哈希相等 ⇔ 这面没往靶子上写过一个字节。 */
async function treeEntries(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (rel: string): Promise<void> => {
    const abs = rel === "" ? dir : join(dir, rel);
    const entries = (await readdir(abs, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const childRel = rel === "" ? e.name : rel + "/" + e.name;
      // `node_modules/.vite` 是 vitest 自己的结果缓存树，不是靶子资产：fixture 里的
      // `pnpm test`（隔壁 gated-tools / runner-gates 的用例）会刷新它，与本面是否越界无关。
      // 两跑里它都被误判成「面改了靶子」（单跑绿、全量红）。只跳过这一棵工具缓存树；
      // `node_modules/` 其余文件仍逐字节进哈希。
      if (childRel === "node_modules/.vite") continue;
      if (e.isSymbolicLink()) {
        out.set(childRel, "L " + (await readlink(join(dir, childRel))));
      } else if (e.isDirectory()) {
        out.set(childRel, "D");
        await walk(childRel);
      } else if (e.isFile()) {
        out.set(childRel, "F " + createHash("sha256").update(await readFile(join(dir, childRel))).digest("hex"));
      }
    }
  };
  await walk("");
  return out;
}

function hashEntries(entries: Map<string, string>): string {
  const h = createHash("sha256");
  for (const [rel, mark] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) h.update(rel + " " + mark + "\n");
  return h.digest("hex");
}

/** 差异必须**点名具体路径**：只说「整棵树变了」的失败读不出是谁写的（实测并行后这条断言会红，
 *  而旧文案只给一份面自己的输出）。 */
function diffEntries(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const changed: string[] = [];
  for (const rel of [...paths].sort()) {
    const a = before.get(rel);
    const b = after.get(rel);
    if (a === b) continue;
    changed.push((a === undefined ? "新增 " : b === undefined ? "删除 " : "改动 ") + rel);
  }
  return changed;
}

function runFace(script: string): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(HERE, script)], {
    cwd: HERE, encoding: "utf8", timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/** 跑一件会**删掉** `fixtures/todo-app/.agent/memory` 的事，并保证净零副作用：先快照、后恢复。
 *  目录本来就不存在 ⇒ 跑完也不留（不凭白造一个目录出来）。
 *  `preserveTimestamps` 是刻意的：这份目录的**文件 mtime** 正是「上一次事故」的证据面
 *  （见上面那段注释），一次判卷跑不该把那份证据的时间戳刷新一遍。 */
async function withFixtureMemoryKept<T>(fn: () => T): Promise<T> {
  const had = existsSync(MEMORY_DIR);
  const backup = await mkdtemp(join(tmpdir(), "dsh-faces-guard-"));
  if (had) await cp(MEMORY_DIR, join(backup, "memory"), { recursive: true, preserveTimestamps: true });
  try {
    return fn();
  } finally {
    await rm(MEMORY_DIR, { recursive: true, force: true });
    if (had) await cp(join(backup, "memory"), MEMORY_DIR, { recursive: true, preserveTimestamps: true });
    await rm(backup, { recursive: true, force: true });
  }
}

// 下面那条「整树逐字节不变」要求靶子在整个文件期间没有别的写入方：与 gated-tools / runner-gates
// 共用一把锁（此前靠全表串行，实测并行后同一份断言会红）。
let releaseAppFixture: (() => Promise<void>) | undefined;
beforeAll(async () => { releaseAppFixture = await acquireAppFixtureLock(); }, 360_000);
afterAll(async () => { await releaseAppFixture?.(); });

describe("复跑面保护 · replay:lessons-offline（读数面，只 print）", () => {
  it("真跑：exit 0，且新复发读数那一节与分母侧硬门那行都在", () => {
    const { code, out } = runFace("scripts/replay/lessons-offline.ts");
    expect(code, out.slice(-3000)).toBe(0);
    // 老读数还在（回归保护：新一节不许把旧读数挤掉）。
    expect(out).toContain("合计：产出教训");
    // 分母侧硬门那一行「无归属红」仍在，且此刻读数为 0（它就是硬门在拦的量）。
    expect(out).toContain('"orphanFail":0');
    // 新的一节：抬头 + 两组的字段都印出来了（否则「新读数」只是个标题）。
    expect(out).toContain("复发读数");
    expect(out).toContain("已可用组");
    expect(out).toContain("尚不可用组");
    // 口径随读数一起印（explicit：这不是因果）。
    expect(out).toContain("不是因果");
  });
});

describe("复跑面保护 · replay:lessons-round-ab（可达那一半 + 诚实声明面）", () => {
  it("真跑：exit 0，且「不可达」那句声明仍在（防被删掉、让这面看起来测了全部）", async () => {
    const { code, out } = await withFixtureMemoryKept(() => runFace("scripts/replay/lessons-round-ab.ts"));
    expect(code, out.slice(-3000)).toBe(0);
    expect(out).toContain("在 mock 靶上不可达");
    expect(out).toContain("结构不可达");
    // 诚实声明面那一节本身也在（它是这面带出去的主要产物）。
    expect(out).toContain("=== 诚实声明 ===");
  });

  it("硬不变量：跑前跑后 fixtures/todo-app **整棵树**逐字节不变（面只动自己的隔离目录）", async () => {
    const before = await treeEntries(FIXTURE_TREE);
    const { code, out } = await withFixtureMemoryKept(() => runFace("scripts/replay/lessons-round-ab.ts"));
    const after = await treeEntries(FIXTURE_TREE);
    expect(code, out.slice(-3000)).toBe(0);
    const changed = diffEntries(before, after);
    expect(changed, "靶子 fixtures/todo-app 被这面改动了（逐路径）：\n" + changed.join("\n") + "\n\n" + out.slice(-3000)).toEqual([]);
    expect(hashEntries(after)).toBe(hashEntries(before));
    // 顺带：面把隔离工作区路径印在输出里，回读那一行确认它跑完已被回收（不留残留）。
    const marker = "[隔离] 隔离工作区（跑完回收）= ";
    const line = out.split("\n").find((l) => l.startsWith(marker));
    expect(line, out.slice(-3000)).toBeTruthy();
    const isolated = line!.slice(marker.length).trim();
    expect(isolated).toContain(join(".tmp", "lessons-round-ab-"));
    expect(existsSync(isolated), "隔离工作区跑完没被回收：" + isolated).toBe(false);
  });
});
