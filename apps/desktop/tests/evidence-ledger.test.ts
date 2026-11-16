// 真机证据台账的判卷（2026-11-16 · 第 1304 页）：证据缺席时不许静默 skip。
//
// 背景：四支真机判卷在 `outputs/` 的读数缺席时把整组断言 `it.skipIf(!hasMeasured)` 掉。
// 「跳过 ≠ 通过」只写在注释里，而汇总行里一片 skip 的绿与真验过的绿同形——把证据文件删掉，
// 桌面套件仍然全绿，只是悄悄少验了一格。这些读数随仓库入库（tracked），缺席只可能是被删。
//
// 这一格钉四件事（缺一件，台账就会退化成第二份散文）：
//   ① 产物在盘上、探针也在盘上（缺哪个都红，并点名重跑命令）；
//   ② 消费者真的读这份文件（引号里的相对路径出现在判卷源里，不只是提示语）；
//   ③ 消费者复算保质期章（`staleEvidenceReason`）——旧读数不许冒充当前构建；
//   ④ 反向：tests/ 里出现的每一份 `outputs/` 读数都在台账里（第五支探针不许绕开这张表）。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVIDENCE_LEDGER, evidenceFile } from "./helpers/renderer-evidence";

const TESTS_DIR = fileURLToPath(new URL("./", import.meta.url));

describe("真机证据台账：产物、探针、消费者、保质期章四件齐", () => {
  it("台账非空（空表会让下面每条恒真）", () => {
    expect(EVIDENCE_LEDGER.length).toBeGreaterThanOrEqual(4);
  });

  for (const record of EVIDENCE_LEDGER) {
    it(`${record.file}：产物与探针都在盘上（入库证据被删即红）`, () => {
      expect(
        existsSync(evidenceFile(record.file)),
        `缺少 ${record.file}：它随仓库入库，缺席说明被删除；改过 renderer 后重跑 ${record.producer}`,
      ).toBe(true);
      expect(existsSync(evidenceFile(record.producer)), `缺少探针 ${record.producer} ⇒ 这份读数再也产不出来`).toBe(true);
    });

    it(`${record.file}：每个消费者都读它、都复算保质期`, () => {
      // 读盘必须带**引号里的相对路径**（整份文件或它所在目录）；只在提示语里提到路径不算读。
      const rel = record.file.replace(/^outputs\//, "../outputs/");
      const dir = rel.slice(0, rel.lastIndexOf("/"));
      for (const consumer of record.consumers) {
        const src = readFileSync(join(TESTS_DIR, consumer), "utf8");
        expect(src, `${consumer} 没引用 ${record.file} ⇒ 台账与判卷接线漂了`).toContain(record.file);
        expect(
          src.includes(`"${rel}"`) || src.includes(`"${dir}"`),
          `${consumer} 只在提示语里写了 ${record.file}，没有按这个路径读盘（"${rel}" / "${dir}"）`,
        ).toBe(true);
        expect(src, `${consumer} 没复算 staleEvidenceReason ⇒ 旧读数可以冒充当前构建`).toContain("staleEvidenceReason");
        expect(src, `${consumer} 缺少证据在场断言（evidenceMissingMessage）⇒ 删掉读数后整组静默 skip`).toContain(
          "evidenceMissingMessage",
        );
      }
    });
  }

  it("反向：tests/ 里出现的每份 outputs 读数都在台账里（第五支探针不许绕开这张表）", () => {
    const registered = EVIDENCE_LEDGER.map((record) => record.file);
    const referenced = new Set<string>();
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(abs);
          continue;
        }
        if (!/\.test\.tsx?$/.test(ent.name)) continue;
        const src = readFileSync(abs, "utf8");
        for (const match of src.matchAll(/"\.\.\/(outputs\/[^"]+)"/g)) referenced.add(match[1] as string);
      }
    };
    walk(TESTS_DIR);
    // 分母：一处都扫不到 = 正则被新写法打败，不是「没有未登记的」。
    expect(referenced.size, "一份 outputs 引用都没扫到 ⇒ 这条尺没落在取料面上").toBeGreaterThanOrEqual(
      EVIDENCE_LEDGER.length,
    );
    // 证据路径有两种写法：整份文件，或只写目录（`${dir}/checks.json` 在别处拼）。
    // 目录写法用前缀匹配认领，避免为了过判卷把判卷改成另一种写法。
    const unregistered = [...referenced].filter(
      (path) => !registered.includes(path) && !registered.some((file) => file.startsWith(path + "/")),
    );
    expect(unregistered, "这些读数在判卷里被读却没登记台账 ⇒ 缺席时它们会静默 skip").toEqual([]);
  });
});
