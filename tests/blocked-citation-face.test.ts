// 判卷 · 「按编号引用台账」的指针必须能落到读得到的地方（能力 6 项目记忆 × 能力 5 可验证）。
//
// 起点是实测的事故，不是假设：`14d2736` 一笔"工作树整体入库"把 `BLOCKED.md` 从
// 127,023 B / 1,187 行 / 67 个标题换成 296 B 的桌面层 stub，四棵活树里 14 处 `裁决 N`/`D-N`/`#N` 引用
// 当场全死，而**没有任何一把尺喊过**（`docs-check` 的 D-3 只认 `页:行号` 形状，预算帽只准下调 ⇒ 删到 296 B 天然合规）。
// 本面就是补那把尺；恢复件（`outputs/blocked-ledger-recovered-2026-09-27/`）先让 14 处重新落到能读到的原文上。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CITE, CITATION_EXTS, CITATION_ROOTS, LEDGER_SOURCES,
  citationViolations, normId, resolveCitations, scanCitations,
} from "../scripts/lib/blocked-citations";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const ARCHIVE_REL = "outputs/blocked-ledger-recovered-2026-09-27/BLOCKED-ledger-1187.txt";

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CITATION_EXTS.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
};
/** 引用面取料：四棵活树（`outputs/` 那层是 dated 档案，按 docs-check 口径不进账 ⇒ 报的是下界）。 */
const citationEntries = (): { path: string; text: string }[] =>
  CITATION_ROOTS.flatMap((r) => walk(join(repoRoot, r))).map((abs) => ({
    path: abs.slice(repoRoot.length + 1), text: readFileSync(abs, "utf8"),
  }));
const ledgerTexts = (): { name: string; text: string }[] => LEDGER_SOURCES.map((s) => ({
  name: s.name, text: readFileSync(join(repoRoot, s.path), "utf8"),
}));

describe("真表现读：14 处编号引用今天都要落得到", () => {
  const { cites, dropped } = scanCitations(citationEntries());
  const { ids, dead } = resolveCitations(cites, ledgerTexts());

  it("取料面不空、也不静默缩面（命中数与探针同日实测同量级：14 处 / 6 个编号）", () => {
    expect(cites.length, "引用面 0 处＝没尺，本面所有判据会集体恒真").toBeGreaterThanOrEqual(10);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    // 每条命中都带得出 `文件:行`，否则红了没人能改
    for (const c of cites) expect(c.file + ":" + c.line).toMatch(/.+:\d+$/);
  });

  it("逐条可解析 ⇒ 违例为空（恢复件在位；台账再被删空也不会静默）", () => {
    expect(citationViolations(cites, dead, LEDGER_SOURCES.map((s) => s.path))).toEqual([]);
  });

  it("剔除口径要说得出口径：规则名 `D-N`（docs-check 那族）不进引用账，但必须被点名", () => {
    for (const d of dropped) expect(d.file).toContain("docs-check");
  });
});

describe("这把尺真的有牙齿（三种「没尺／假绿」形状各一条）", () => {
  const { cites } = scanCitations(citationEntries());

  it("负控 A：只给 `BLOCKED.md`（＝台账被删空那天的现态）⇒ 必须一片死指针并点到文件:行", () => {
    const onlyStub = resolveCitations(cites, [{ name: "BLOCKED.md", text: readFileSync(join(repoRoot, "BLOCKED.md"), "utf8") }]);
    expect(onlyStub.dead.length, "台账删空而本面不红＝这把尺白造").toBeGreaterThan(0);
    const v = citationViolations(cites, onlyStub.dead, ["BLOCKED.md"]);
    expect(v.some((x) => x.kind === "dead-pointer" && /文件:行|:\d+/.test(x.detail))).toBe(true);
  });

  it("负控 B：合成一条引用 + 空台账 ⇒ 逐条点名（不靠真仓数据也能验收判卷本身）", () => {
    const syn = scanCitations([{ path: "scripts/x.ts", text: "// 见 BLOCKED.md 裁决 9 的原话\n" }]);
    expect(syn.cites.map((c) => c.id)).toEqual(["裁决 9"]);
    const r = resolveCitations(syn.cites, [{ name: "BLOCKED.md", text: "# 台账\n没有这一条\n" }]);
    expect(r.dead.map((d) => d.id + "@" + String(d.uses))).toEqual(["裁决 9@1"]);
    expect(r.dead[0]?.where[0]).toBe("scripts/x.ts:1");
  });

  it("空引用面＝没尺，不许读成「全部可解析」（规则 222 那一族）", () => {
    const v = citationViolations([], [], LEDGER_SOURCES.map((s) => s.path));
    expect(v.map((x) => x.kind)).toContain("empty-face");
  });

  it("一个落点都读不到 ⇒ 只报「没尺」，不许顺手报 empty-face（那会把取料坏说成引用被删）", () => {
    const v = citationViolations([], [], []);
    expect(v.map((x) => x.kind)).toContain("ledger-missing");
    expect(v.map((x) => x.kind)).not.toContain("empty-face");
    for (const s of LEDGER_SOURCES) expect(v.some((x) => x.detail.includes(s.path))).toBe(true);
  });

  it("join 键的自证：`待办 #56` 的键是 `#56`（带前缀去查必然查不到＝假死引用，第 122 页踩过）", () => {
    expect(normId("待办 #56")).toBe("#56");
    expect(normId("裁决  3")).toBe("裁决 3");
    const r = resolveCitations([{ file: "a.ts", line: 1, id: normId("待办 #56") }], [{ name: "x", text: "…BLOCKED 里 #56 这条…待办不算标题" }]);
    expect(r.dead).toEqual([]);
  });
});

describe("恢复件与探针：两头都要有主", () => {
  it("恢复件字节/行数/标题数钉住，且**字节**不许拿字数比（中文台账差 1.77 倍，第 122 页自纠）", () => {
    const text = readFileSync(join(repoRoot, ARCHIVE_REL), "utf8");
    expect(Buffer.byteLength(text)).toBe(127_023);
    expect(text.split("\n").length).toBe(1188); // 1,187 行文字 + 末行换行
    expect((text.match(/^#/gm) ?? []).length).toBe(67);
    expect(text).toContain("裁决");
  });

  it("恢复件与 git 里被删那笔**同一份内容**（sha256 比字节，不靠「我看着像」）", () => {
    const gitBytes = execFileSync("git", ["show", "14d2736~1:BLOCKED.md"], { maxBuffer: 128 * 1024 * 1024 });
    const here = readFileSync(join(repoRoot, ARCHIVE_REL));
    const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
    expect(sha(here)).toBe(sha(gitBytes));
  });

  it("取料口径与探针共一份：正则字面量漂了就红（两份实现各扫各的＝迟早一支静默失明）", () => {
    const probe = readFileSync(join(repoRoot, "outputs/blocked-queue-deleted-2026-09-26/measure-citations.mts"), "utf8");
    const m = /const CITE = \/([^/]+)\/g/.exec(probe);
    expect(m, "探针里读不出 CITE ⇒ 本判据空载").not.toBeNull();
    expect(m![1]).toBe(CITE.source);
  });
});
