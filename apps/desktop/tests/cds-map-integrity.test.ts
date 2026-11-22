// 组件移植账完整性判卷（ADR 0019：1:1 迁移的进度事实源）。
// 三格：账与抽取件同名集闭合；ported 条目必须带 cairn 选择器与依据；状态枚举封闭。
// 反向锚点：ported 条目缺 cairn 选择器 ⇒ 红（移植不完整 = 假进度）；上游组件缺账条目 ⇒ 红。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VENDOR = join(__dirname, "../src/renderer/vendor/cds-official");
const mapDoc: { components?: { name: string; status: string; cairn?: string | null; reason?: string }[] } = JSON.parse(
  readFileSync(join(VENDOR, "component-map.json"), "utf8"),
) as never;
const map = mapDoc.components ?? [];
const manifestDoc: { components?: { name: string }[] } = JSON.parse(
  readFileSync(join(VENDOR, "components.json"), "utf8"),
) as never;
const manifest = manifestDoc;

const STATUSES = ["ported", "no-cairn-counterpart", "no-component-css"] as const;

describe("组件移植账（ADR 0019）", () => {
  it("账与上游抽取件同名集闭合：上游每个组件都有账条目，账没有幽灵条目", () => {
    const upstream = new Set((manifest.components ?? []).map((c) => c.name));
    const ledger = new Set(map.map((m) => m.name));
    expect([...upstream].filter((n) => !ledger.has(n))).toEqual([]);
    expect([...ledger].filter((n) => !upstream.has(n))).toEqual([]);
  });

  it("ported 条目必须带 cairn 选择器与依据（移植不完整 = 假进度）", () => {
    const bad = map.filter((m) => m.status === "ported" && (!m.cairn || m.cairn.trim() === "" || !m.reason || m.reason.trim() === ""));
    expect(bad.map((m) => m.name)).toEqual([]);
  });

  it("状态枚举封闭（新状态必须先进判据再进账）", () => {
    const bad = map.filter((m) => !STATUSES.includes(m.status as never));
    expect(bad.map((m) => m.name)).toEqual([]);
  });
});
