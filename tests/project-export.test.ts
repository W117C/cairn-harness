// 项目导出判卷：拿去就能用的目录；不覆盖已有目标；把可再生的目录排除在导出之外。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXPORT_EXCLUDED, exportProject } from "../src/main/project-export";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "cairn-exp-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeFixture(src: string): void {
  writeFileSync(join(src, "index.html"), "<h1>hi</h1>", "utf8");
  mkdirSync(join(src, ".cairn"));
  writeFileSync(join(src, ".cairn", "project.json"), "{}", "utf8");
  mkdirSync(join(src, "assets"));
  writeFileSync(join(src, "assets", "app.js"), "1", "utf8");
  for (const excluded of EXPORT_EXCLUDED) {
    if (excluded === ".DS_Store") {
      writeFileSync(join(src, excluded), "junk", "utf8");
      continue;
    }
    mkdirSync(join(src, excluded));
    writeFileSync(join(src, excluded, "noise.txt"), "noise", "utf8");
  }
}

describe("exportProject：可带走的目录", () => {
  it("复制项目内容与 .cairn 清单，排除 node_modules/dist/.git/.agent/.DS_Store", () => {
    const src = tmp();
    const destParent = tmp();
    writeFixture(src);
    const r = exportProject(src, destParent, { name: "coffee" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(existsSync(join(r.dest, "index.html"))).toBe(true);
    expect(existsSync(join(r.dest, ".cairn", "project.json"))).toBe(true);
    expect(existsSync(join(r.dest, "assets", "app.js"))).toBe(true);
    for (const excluded of EXPORT_EXCLUDED) {
      expect(existsSync(join(r.dest, excluded)), excluded).toBe(false);
    }
    // copiedFiles 只数真实文件：index.html + .cairn/project.json + assets/app.js
    expect(r.copiedFiles).toBe(3);
  });

  it("目标已存在：拒收且不动已有目录（合并/覆盖会吃用户数据）", () => {
    const src = tmp();
    const destParent = tmp();
    writeFixture(src);
    mkdirSync(join(destParent, "coffee"));
    writeFileSync(join(destParent, "coffee", "keep.txt"), "keep", "utf8");
    const r = exportProject(src, destParent, { name: "coffee" });
    expect(r).toMatchObject({ ok: false, reason: "dest-exists" });
    expect(readdirSync(join(destParent, "coffee"))).toEqual(["keep.txt"]);
  });

  it("源目录不存在 ⇒ bad-source", () => {
    const destParent = tmp();
    const r = exportProject(join(destParent, "missing"), destParent);
    expect(r).toMatchObject({ ok: false, reason: "bad-source" });
  });
});
