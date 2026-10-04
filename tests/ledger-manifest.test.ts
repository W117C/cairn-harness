// observation ledger 的信任边界：manifest 的逐条校验 + 键的形状（2026-10-02 普查增补）。
//
// 立项动因（实测）：`src/agent/ledger.ts` 384 行、**零**变异锚点，但覆盖面其实很扎实
// （`tests/ledger.test.ts` 13 条：durability / session 隔离 / UTF-8 分页 / 同尺寸损坏的哈希核对 /
// 非常规对象 / 硬链接 / 配额跨重启 / 孤儿对象 / 崩溃锁 / 删除墓碑……另有 symlink 锁与工具面各一组）。
// 普查按 §7.6 的顺序问「哪些**形状**还没有证人」，查到一处：
//
//   `manifest()` 的**逐条**校验（键 ID 正则、sha256 hex、bytes/lines 是安全整数且在范围内、
//   `lines <= bytes`）——**一条断言都没有**。
//   既有的 "rejects … corrupted manifests" 只喂了 `index.json = "null"`（整个文件是 null），
//   逐条那一层从未被触发过。
//
// 为什么值得补：这一层是**唯一**挡「一份被改过的 index.json 指向盘外/超大/畸形对象」的东西。
// 实测 11 种畸形全部被正确拒（ECORRUPT），所以**这不是 bug 修补，是把已有的正确行为钉住**——
// 免得将来有人简化成「只查顶层」时无人发现。
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  FULL_SENDS,
  LEDGER_THRESHOLD_BYTES,
  OBSERVATION_SESSION_ID,
  ObservationLedger,
  RECALL_MAX_BYTES,
  RECALL_MAX_LINES,
  observeId,
} from "../src/agent/ledger";

/** 取 manifest 里第一条 entry（改它用）。 */
function firstEntry(m: Record<string, unknown>): Record<string, unknown> {
  const e = m.entries as Record<string, Record<string, unknown>>;
  return e[Object.keys(e)[0]!]!;
}

/** 把第一条 entry 的**键**换成给定的（值原样带走）。键形状那一族畸形共用这一个动作。 */
function renameFirstEntryKey(m: Record<string, unknown>, key: string): void {
  const e = m.entries as Record<string, unknown>;
  const old = Object.keys(e)[0]!;
  const value = e[old];
  delete e[old];
  e[key] = value;
}

/** 一个已归档过一条的 ledger + 它的记录 + index.json 路径与原始全文。
 *
 *  根目录必须**不在软链上**（macOS 的 `/tmp` 是）——`directoryCheck` 会判 ELOOP，
 *  那是防线在工作，不是缺陷。 */
async function seeded(): Promise<{
  store: ObservationLedger;
  rec: { id: string; sha256: string; bytes: number; lines: number; path: string };
  indexPath: string;
  good: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(homedir(), "dsh-ledger-"));
  const store = new ObservationLedger({ sessionDataDir: root, sessionId: "s1", enabled: true });
  const rec = (await store.archive({
    toolName: "read_file",
    callId: "c1",
    source: { kind: "authorized-redacted-text", text: "x".repeat(LEDGER_THRESHOLD_BYTES + 500) },
  }))!;
  const indexPath = join(store.directory, "index.json");
  const good = await readFile(indexPath, "utf8");
  return { store, rec, indexPath, good, cleanup: () => rm(root, { recursive: true, force: true }).catch(() => {}) };
}

describe("① manifest 逐条校验：畸形都要 ECORRUPT", () => {
  // 每条都重新 seed（不复用上一条被污染的 index），否则前一条的残留会带进后一条。
  const shapes: readonly { label: string; mutate: (m: Record<string, unknown>) => void }[] = [
    { label: "键是路径穿越", mutate: (m) => renameFirstEntryKey(m, "../../etc/passwd") },
    { label: "键格式不合法", mutate: (m) => renameFirstEntryKey(m, "not-an-obs-id") },
    { label: "键超长", mutate: (m) => renameFirstEntryKey(m, "obs_" + "a".repeat(200)) },
    { label: "sha256 非 hex", mutate: (m) => { firstEntry(m).sha256 = "z".repeat(64); } },
    { label: "bytes 是负数", mutate: (m) => { firstEntry(m).bytes = -1; } },
    { label: "bytes 超单对象上限", mutate: (m) => { firstEntry(m).bytes = 99_999_999; } },
    { label: "lines > bytes", mutate: (m) => { firstEntry(m).lines = Number(firstEntry(m).bytes) + 1; } },
    { label: "lines 非整数", mutate: (m) => { firstEntry(m).lines = 1.5; } },
    { label: "version 不是 1", mutate: (m) => { m.version = 2; } },
    { label: "sessionId 与本会话不符", mutate: (m) => { m.sessionId = "other"; } },
    { label: "epoch 不是 UUID", mutate: (m) => { m.epoch = "xx"; } },
    { label: "entries 是数组", mutate: (m) => { m.entries = []; } },
  ];

  for (const { label, mutate } of shapes) {
    it(`${label} ⇒ recall 抛 ECORRUPT（不许读盘外/超大/畸形对象）`, async () => {
      const { store, rec, indexPath, good, cleanup } = await seeded();
      try {
        const m = JSON.parse(good) as Record<string, unknown>;
        mutate(m);
        await writeFile(indexPath, JSON.stringify(m), "utf8");
        await expect(store.recall({ id: rec.id })).rejects.toMatchObject({ code: "ECORRUPT" });
      } finally {
        await cleanup();
      }
    });
  }

  it("对照组：原始 manifest 读得回来（守卫不能变成永真）", async () => {
    const { store, rec, cleanup } = await seeded();
    try {
      expect((await store.recall({ id: rec.id })).text.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });
});

describe("② sessionId 是路径的一节，必须被挡住", () => {
  it("穿越/斜杠/点开头/超长/前导连字符/空 ⇒ 一律拒", () => {
    for (const bad of ["../escape", "a/b", ".hidden", "x".repeat(129), "-lead", ""]) {
      expect(
        () => new ObservationLedger({ sessionDataDir: homedir(), sessionId: bad, enabled: true }),
        JSON.stringify(bad),
      ).toThrow();
    }
  });

  it("合法 id 放行（守卫不能把正常会话也拒了）", () => {
    expect(() => new ObservationLedger({ sessionDataDir: homedir(), sessionId: "s-1_A", enabled: true })).not.toThrow();
  });

  it("sessionDataDir 必须是绝对路径（相对路径会让根落在进程 cwd 上）", () => {
    expect(() => new ObservationLedger({ sessionDataDir: "relative/dir", sessionId: "s1", enabled: true })).toThrow();
  });
});

describe("③ observeId：去重的键，必须稳定且区分三类输入", () => {
  it("同输入 ⇒ 同 id（去重与跨会话复用都靠它）", () => {
    expect(observeId("read_file", "c1", "h1")).toBe(observeId("read_file", "c1", "h1"));
  });

  it("三类输入任一不同 ⇒ id 不同（不然会把别的内容当同一份读出来）", () => {
    const base = observeId("read_file", "c1", "h1");
    expect(base).not.toBe(observeId("read_file", "c1", "h2"));
    expect(base).not.toBe(observeId("read_file", "c2", "h1"));
    expect(base).not.toBe(observeId("grep", "c1", "h1"));
  });

  it("形状与账本里的 ID 正则一致（`obs_` + 24 位小写 hex，共 28 字符）", () => {
    const id = observeId("t", "c", "h");
    expect(id).toMatch(/^obs_[a-f0-9]{24}$/u);
    expect(id).toHaveLength(28);
  });
});

describe("④ 常量与默认档", () => {
  it("投影档位：前 FULL_SENDS 次发全量，之后才是存档回执", () => {
    expect(FULL_SENDS).toBe(2);
    expect(LEDGER_THRESHOLD_BYTES).toBe(10 * 1024);
  });

  it("分页回读有界（召回不许一次把整份大输出灌进上下文）", () => {
    expect(RECALL_MAX_BYTES).toBe(16 * 1024);
    expect(RECALL_MAX_LINES).toBe(400);
  });

  it("默认会话 id 是固定串（多账本并存时的命名空间）", () => {
    expect(OBSERVATION_SESSION_ID).toBe("observations");
  });
});
