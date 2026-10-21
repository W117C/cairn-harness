// memory/store.ts 的判卷面（2026-10-02 普查增补）。
//
// 立项动因（实测）：该文件 327 行、**零**变异锚点；29 个导出里有一批**零判卷**，
// 其中两支恰好站在安全边界上：
//   · `loadExternalRefState` / `saveExternalRefDecision` —— 外部 @引用的批准/拒绝决议
//   · `validateTopic`                              —— topic 直接变成 `<dir>/<topic>.md`
//
// 缺口（§① 有详述）：`loadExternalRefState` 把「文件缺失」与「文件损坏」同路静默返回空态，
// 而本仓自己在 `src/routing/bandit.ts` 的 `loadBanditState` 里**明确修过同一族**
// （注释原话：「文件存在但损坏/畸形 = 学习历史无痕丢失，必须经 onCorrupt 显式告警」）。
// 同一族在记忆这边还留着，且后果是**用户的安全决议无声蒸发**。
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INDEX_MAX_BYTES,
  INDEX_MAX_LINES,
  MEMORY_INDEX,
  MEMORY_TYPES,
  MemoryError,
  checkIndexLimit,
  indexLine,
  loadExternalRefState,
  parseTopicDoc,
  renderTopicDoc,
  saveExternalRefDecision,
  topicDocRoundtrip,
  upsertIndexLine,
  validateTopic,
  writeTopic,
} from "../src/agent/memory/store";

/** 每个用例一份干净的全局记忆目录：走 store **自己的**测试钩子 `M2D_MEMORY_HOME`
 *  （模块头写着「可配：M2D_MEMORY_HOME / initMemoryHome，测试用临时目录」），**不再改 `process.env.HOME`**。
 *
 *  为什么必须换（2026-10-12 实测，不是推测）：`os.homedir()` 在 vitest 的 `--pool=threads` 下
 *  **看不到**本进程里对 `HOME` 的赋值 ⇒ 这条判卷在那种跑法里把状态写去了**真实的**
 *  `~/.config/cairn/memory/`（实测该文件 mtime 当场被改），而它断言的临时目录里那份根本没被创建
 *  ⇒ 门把它读成 `baseline-red`（「基线就不绿」），两条锚点的判定因此被污染。
 *  换钩子后两种池子同形：`M2D_MEMORY_HOME` 是 store 的 runtime 输入，不经 `os.homedir()` 的缓存。 */
async function withHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "dsh-mem-"));
  const memHome = join(home, ".config", "cairn", "memory");
  const prev = process.env.M2D_MEMORY_HOME;
  process.env.M2D_MEMORY_HOME = memHome;
  try {
    return await fn(home);
  } finally {
    if (prev === undefined) delete process.env.M2D_MEMORY_HOME; else process.env.M2D_MEMORY_HOME = prev;
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

// ── ① 外部引用审批状态（§8.1.8 第 3 条）：批准/拒绝要能落账并读回 ──
describe("外部引用审批状态", () => {
  it("批准与拒绝各自入集", async () => {
    await withHome(async () => {
      await saveExternalRefDecision("/etc/hosts", true);
      await saveExternalRefDecision("~/secret", false);
      const s = await loadExternalRefState();
      expect(s.approved).toEqual(["/etc/hosts"]);
      expect(s.declined).toEqual(["~/secret"]);
    });
  });

  it("重复记同一决议不产生重复项", async () => {
    await withHome(async () => {
      await saveExternalRefDecision("/a", true);
      await saveExternalRefDecision("/a", true);
      await saveExternalRefDecision("/b", false);
      await saveExternalRefDecision("/b", false);
      const s = await loadExternalRefState();
      expect(s.approved).toEqual(["/a"]);
      expect(s.declined).toEqual(["/b"]);
    });
  });

  // 审计未修项（STATE.md「还有什么没裁」）：先批后拒时，旧实现只往 declined 追加，
  // 不撤销 approved ⇒ 持久态同时留下两条，而注入器先看 approved ⇒ 用户后说的「不」被忽略。
  it("后一次拒绝撤销先前的批准：后说的『不』算数，持久态不并存", async () => {
    await withHome(async () => {
      await saveExternalRefDecision("/etc/hosts", true);
      await saveExternalRefDecision("/etc/hosts", false);
      const s = await loadExternalRefState();
      expect(s.approved).toEqual([]);
      expect(s.declined).toEqual(["/etc/hosts"]);
    });
  });

  // 另一半：批准也要撤销先前的拒绝，否则「重新批准」同样会被 declined 挡住。
  it("后一次批准撤销先前的拒绝：重新批准后恢复，持久态不并存", async () => {
    await withHome(async () => {
      await saveExternalRefDecision("~/secret", false);
      await saveExternalRefDecision("~/secret", true);
      const s = await loadExternalRefState();
      expect(s.approved).toEqual(["~/secret"]);
      expect(s.declined).toEqual([]);
    });
  });

  it("决议互斥只作用于目标引用：其他引用各自保留", async () => {
    await withHome(async () => {
      await saveExternalRefDecision("/a", true);
      await saveExternalRefDecision("/b", false);
      await saveExternalRefDecision("/a", false);
      const s = await loadExternalRefState();
      expect(s.approved).toEqual([]);
      expect(s.declined).toEqual(["/b", "/a"]);
    });
  });

  // 旧实现可能已经把 approved+declined 写进盘了：读侧也要恢复互斥，否则修完仍会
  // 「存量文件里先批后拒被忽略」。方向取 fail-closed：拒绝优先（正常流程只有先批后拒）。
  it("盘上遗留的同一引用并存 ⇒ 读侧按拒绝优先归一，并去掉重复项", async () => {
    await withHome(async (home) => {
      const p = join(home, ".config", "cairn", "memory", "external-refs.json");
      await mkdir(join(home, ".config", "cairn", "memory"), { recursive: true });
      await writeFile(p, JSON.stringify({ approved: ["/a", "/b", "/a"], declined: ["/a", "/c", "/c"] }), "utf8");
      const s = await loadExternalRefState();
      expect(s.approved).toEqual(["/b"]);
      expect(s.declined).toEqual(["/a", "/c"]);
    });
  });

  it("首次使用（文件不存在）⇒ 空态：这是正常首启，不是损坏", async () => {
    await withHome(async () => {
      expect(await loadExternalRefState()).toEqual({ approved: [], declined: [] });
    });
  });

  // 这条原先是「缺口证人」（旧实现：损坏 ⇒ 空态且不告警）。2026-10-11 按 `bandit.ts`
  // 先例修成 fail-visible：损坏/畸形 ⇒ onCorrupt 显式告警 + 继续按空态走（fail-closed，
  // 不抛错——抛错会把「重新询问」升级成硬失败）。本断言随之改成新契约。
  it("状态文件损坏 ⇒ 空态 + onCorrupt 显式告警（fail-visible，不再静默蒸发）", async () => {
    await withHome(async (home) => {
      await saveExternalRefDecision("/etc/hosts", true);
      const p = join(home, ".config", "cairn", "memory", "external-refs.json");
      await writeFile(p, '{"approved": ["/etc/hosts"', "utf8"); // 半截 JSON（模拟写坏）
      const warned: string[] = [];
      const s = await loadExternalRefState((r) => warned.push(r));
      expect(s).toEqual({ approved: [], declined: [] }); // fail-closed：空态 = 无一批准
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain("external-refs.json"); // 告警带定位信息（§8.4 纪律）
      // 对照：文件确实坏到解析不动（不是「读不到」）。
      const raw = await readFile(p, "utf8");
      expect(() => JSON.parse(raw)).toThrow();
    });
  });

  it("形状畸形（合法 JSON、字段不是数组）同样告警且按空态返回——不许把字符串漏成 `includes` 的隐式子串匹配", async () => {
    await withHome(async (home) => {
      const p = join(home, ".config", "cairn", "memory", "external-refs.json");
      await mkdir(join(home, ".config", "cairn", "memory"), { recursive: true });
      await writeFile(p, '{"approved": "/etc/hosts", "declined": []}', "utf8");
      const warned: string[] = [];
      const s = await loadExternalRefState((r) => warned.push(r));
      expect(s).toEqual({ approved: [], declined: [] });
      expect(Array.isArray(s.approved)).toBe(true);
      expect(warned).toHaveLength(1);
    });
  });

  it("文件缺失（首启）不告警——缺失是正常新状态，不是损坏", async () => {
    await withHome(async () => {
      const warned: string[] = [];
      const s = await loadExternalRefState((r) => warned.push(r));
      expect(s).toEqual({ approved: [], declined: [] });
      expect(warned).toEqual([]);
    });
  });
});

// ── ② topic 文件名信任边界：topic 直接变成 `<dir>/<topic>.md` ──
describe("validateTopic：topic 是文件名，不许带路径语义", () => {
  it("路径穿越/绝对路径/父目录一律拒", () => {
    for (const bad of ["../escape", "..", "a/b", "/abs/path", "..%2Fx", "..\\win", ".", "..md", "a\nb"]) {
      expect(() => validateTopic(bad), JSON.stringify(bad)).toThrow(MemoryError);
    }
  });

  it("长度 65 位拒（上限 64）", () => {
    expect(() => validateTopic("a".repeat(65))).toThrow(MemoryError);
    expect(validateTopic("a".repeat(64))).toBe("a".repeat(64));
  });
});

// ── ③ 索引（MEMORY.md）：整份会被回注给模型，是记忆面唯一进 prompt 的东西 ──
describe("MEMORY.md 索引", () => {
  it("索引行只取正文摘要、空白全折叠、且截到 80 字（整份索引会回注给模型，不能无限长）", () => {
    // 实测口径：`indexLine` 对 firstLine 做的是 `replace(/\s+/g," ")` **全串**折叠
    // （不是只取第一行），再 `slice(0,80)`。所以传多行进去，出来的是一整行折叠摘要。
    // 我最初误以为它只取第一行——那条断言是错的，按实测改正。
    const line = indexLine("t1", "user", "2026-10-02", "  第一行  \n第二行".repeat(10));
    expect(line.startsWith("- t1 · user · 2026-10-02 ·")).toBe(true);
    expect(line).toContain("第一行 第二行"); // 换行被折成单空格，不是原样换行进索引
    expect(line).not.toContain("\n"); // 索引一行一条，绝不能内嵌换行
    const prefix = "- t1 · user · 2026-10-02 · ";
    expect(line.length).toBe(prefix.length + Math.min(80, "  第一行  \n第二行".repeat(10).replace(/\s+/g," ").trim().length));
  });

  it("upsert 按 topic 键替换旧行，同 topic 不重复累加", () => {
    let idx = "";
    idx = upsertIndexLine(idx, "t1", "- t1 · user · d1 · 旧摘要");
    idx = upsertIndexLine(idx, "t1", "- t1 · user · d2 · 新摘要");
    expect(idx.split("\n").filter((l) => l.includes("t1 ·")).length).toBe(1);
    expect(idx).toContain("新摘要");
    expect(idx).not.toContain("旧摘要");
  });

  it("topic 前缀相似的不误伤（`t1` 的替换不许连坐 `t10` 的行）", () => {
    // upsert 的经典 off-by-prefix：`- t10 ·` 以 `- t1` 开头，
    // 分隔符 ` ·` 是唯一把它们分开的部分——漏掉就会连坐删除。
    let idx = "- t10 · user · d0 · 别的 topic\n";
    idx = upsertIndexLine(idx, "t1", "- t1 · user · d1 · 本条目");
    expect(idx).toContain("t10");
    expect(idx).toContain("本条目");
  });

  it("超硬上限即拒（行数与字节数两条各自要能触发）", () => {
    const ok = Array.from({ length: INDEX_MAX_LINES }, (_, i) => "- t" + i + " · user · d · x").join("\n");
    expect(() => checkIndexLimit(ok)).not.toThrow();
    expect(() => checkIndexLimit(ok + "\n- 多一行 · user · d · x")).toThrow(MemoryError);
    // 字节上限单独触发：长中文把行数压到帽内、字节顶到帽外。
    const fewLong = Array.from({ length: 10 }, () => "- t · user · d · " + "内".repeat(2000)).join("\n");
    expect(fewLong.split("\n").length).toBeLessThan(INDEX_MAX_LINES);
    expect(Buffer.byteLength(fewLong, "utf8")).toBeGreaterThan(INDEX_MAX_BYTES);
    expect(() => checkIndexLimit(fewLong)).toThrow(MemoryError);
  });
});

// ── ④ frontmatter 往返：解析与渲染必须互逆（不互逆 ⇒ 记忆条目丢字段）──
describe("topic frontmatter 往返", () => {
  it("render→parse 逐字段一致", () => {
    const got = topicDocRoundtrip({ type: "feedback", modified: "2026-10-02T00:00:00Z" }, "正文一行");
    expect(got.meta.type).toBe("feedback");
    expect(got.meta.modified).toBe("2026-10-02T00:00:00Z");
    expect(got.body).toBe("正文一行");
  });

  it("没有 frontmatter 的裸正文原样返回（不许把正文当 meta 吃掉）", () => {
    const got = parseTopicDoc("只有正文，没有分隔线");
    expect(got.body).toBe("只有正文，没有分隔线");
    expect(Object.keys(got.meta)).toEqual([]);
  });

  it("渲染结果自身可被再解析（幂等一次）", () => {
    const once = renderTopicDoc({ type: "project", modified: "d" }, "b");
    expect(renderTopicDoc({ type: "project", modified: "d" }, parseTopicDoc(once).body)).toBe(once);
  });

  it("MEMORY_TYPES 是登记过的四类（分类面不许临时长出新值）", () => {
    expect([...MEMORY_TYPES]).toEqual(["user", "feedback", "project", "reference"]);
  });
});

// ── ⑤ 写盘面：writeTopic 要在目录里真的落两个产物 ──
describe("writeTopic 落盘", () => {
  it("写入 topic 文件与 MEMORY.md 索引两个产物", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-memw-"));
    try {
      await writeTopic(dir, "note1", "user", "首行摘要\n其余正文", "2026-10-02T00:00:00Z");
      const doc = await readFile(join(dir, "note1.md"), "utf8");
      expect(doc).toContain("type: user");
      expect(doc).toContain("首行摘要");
      const idx = await readFile(join(dir, MEMORY_INDEX), "utf8");
      expect(idx).toContain("- note1 · user · 2026-10-02T00:00:00Z · 首行摘要");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("topic 非法 ⇒ 一个字节都不落盘（校验在写之前，不在写之后回滚）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-memw-"));
    try {
      await expect(writeTopic(dir, "../escape", "user", "b", "d")).rejects.toThrow(MemoryError);
      await expect(readFile(join(dir, MEMORY_INDEX), "utf8")).rejects.toThrow(); // 索引也没建
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
