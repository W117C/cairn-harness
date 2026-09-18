// 能力 #5 回归网：src/frozen.ts 的判卷完整性校验此前只有 ipc-check/autonomy-check 门禁级覆盖。
// frozenCoverageDrift 有 S3-9 修复史（清单单文件曾无条件计入集合 → 掩盖「判卷文件消失」），
// 本文件双向锁定漂移方向；测试数据落 OS 临时目录（判卷纪律：绝不落工作区）。
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { frozenCoverageDrift, sha256MatchesFrozenFile } from "../src/frozen";

let root: string;

async function put(rel: string, content: string): Promise<void> {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile(join(root, rel), content);
}
function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-frozen-"));
  // 判卷区三个目录 + gym 清单单文件
  await put("fixtures/mock/one.json", "A");
  await put("fixtures/todo-app/tests/two.test.js", "B");
  await put("fixtures/gym/cases/three.json", "C");
  await put("fixtures/gym/index.json", "[]");
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("frozenCoverageDrift（双向集合比对）", () => {
  it("表与盘完全一致：双向零漂移", async () => {
    await put("scripts/frozen-sha256.json", JSON.stringify({
      "fixtures/mock/one.json": sha("A"),
      "fixtures/todo-app/tests/two.test.js": sha("B"),
      "fixtures/gym/cases/three.json": sha("C"),
      "fixtures/gym/index.json": sha("[]"),
    }));
    const d = await frozenCoverageDrift(root);
    expect(d.onDiskNotInTable).toEqual([]);
    expect(d.inTableNotOnDisk).toEqual([]);
  });

  it("盘上有、表里无（新判卷文件未入表）→ onDiskNotInTable", async () => {
    await put("scripts/frozen-sha256.json", JSON.stringify({
      "fixtures/mock/one.json": sha("A"),
      "fixtures/todo-app/tests/two.test.js": sha("B"),
      // 故意漏掉 gym/cases/three.json 与 gym/index.json
    }));
    const d = await frozenCoverageDrift(root);
    expect(d.onDiskNotInTable).toEqual([
      "fixtures/gym/cases/three.json",
      "fixtures/gym/index.json",
    ]);
    expect(d.inTableNotOnDisk).toEqual([]);
  });

  it("表里有、盘上无（陈旧/被删判卷条目）→ inTableNotOnDisk", async () => {
    await put("scripts/frozen-sha256.json", JSON.stringify({
      "fixtures/mock/one.json": sha("A"),
      "fixtures/todo-app/tests/two.test.js": sha("B"),
      "fixtures/gym/cases/three.json": sha("C"),
      "fixtures/gym/index.json": sha("[]"),
      "fixtures/mock/ghost.json": sha("X"), // 盘上不存在
    }));
    const d = await frozenCoverageDrift(root);
    expect(d.inTableNotOnDisk).toEqual(["fixtures/mock/ghost.json"]);
  });

  it("S3-9 回归：gym/index.json 不存在时不算入盘上集合（不掩盖判卷文件消失）", async () => {
    // 独立子树：index.json 缺失，表里有它 → 必须报 inTableNotOnDisk
    const sub = await mkdtemp(join(tmpdir(), "dsh-frozen-noidx-"));
    try {
      await mkdir(join(sub, "scripts"), { recursive: true });
      await writeFile(join(sub, "scripts/frozen-sha256.json"), JSON.stringify({
        "fixtures/gym/index.json": sha("[]"),
      }));
      const d = await frozenCoverageDrift(sub);
      expect(d.onDiskNotInTable).toEqual([]);
      expect(d.inTableNotOnDisk).toEqual(["fixtures/gym/index.json"]);
    } finally {
      await rm(sub, { recursive: true, force: true });
    }
  });
});

describe("sha256MatchesFrozenFile", () => {
  it("全部逐字一致 → ok", async () => {
    await put("scripts/t-ok.json", JSON.stringify({ "fixtures/mock/one.json": sha("A") }));
    expect(await sha256MatchesFrozenFile(root, "scripts/t-ok.json")).toEqual({ ok: true });
  });

  it("内容被改 → broken 指向具体文件", async () => {
    await put("scripts/t-broken.json", JSON.stringify({ "fixtures/mock/one.json": sha("TAMPERED") }));
    expect(await sha256MatchesFrozenFile(root, "scripts/t-broken.json")).toEqual({
      ok: false,
      broken: "fixtures/mock/one.json",
    });
  });

  it("表里某文件盘上不存在 → rejects（fail-closed 不静默放行）", async () => {
    await put("scripts/t-missing.json", JSON.stringify({ "fixtures/mock/nope.json": sha("?") }));
    await expect(sha256MatchesFrozenFile(root, "scripts/t-missing.json")).rejects.toThrow();
  });
});
