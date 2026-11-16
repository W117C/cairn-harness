// 真机证据的判卷侧复算（与 `scripts/lib/renderer-evidence.cjs` 同一规格）。
//
// `outputs/` 里被判卷消费的读数都带 renderer 源摘要与「源不晚于产物」两个字段。
// 这里复算当前摘要：对不上 = 证据过期，必须重跑探针，不许拿旧读数冒充当前构建。
// 缺席字段按过期处理——旧格式证据没有保质期章，不能默认它是新的。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** 递归 src/renderer，取 .css/.ts/.tsx，跳过点目录；按 POSIX 相对路径排序；
 *  每条 update(路径)、"\0"、内容 sha256、"\n"。 */
export function rendererDigest(): string {
  const root = fileURLToPath(new URL("../../src/renderer", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (/\.(css|ts|tsx)$/.test(ent.name)) files.push(abs);
    }
  };
  walk(root);
  const rows = files
    .map((abs) => [relative(root, abs).split(sep).join("/"), abs] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const h = createHash("sha256");
  for (const [rel, abs] of rows) {
    h.update(rel);
    h.update("\0");
    h.update(createHash("sha256").update(readFileSync(abs)).digest("hex"));
    h.update("\n");
  }
  return h.digest("hex");
}

export interface SealedEvidence {
  rendererDigest?: string;
  buildFresh?: boolean;
}

/** 被判卷消费的真机证据台账（单一事实源）。
 *
 *  为什么要有这张表：四支判卷在读数缺席时把整组断言 `it.skipIf(!hasMeasured)` 掉。
 *  「跳过 ≠ 通过」只写在注释里，而汇总行里一片 skip 的绿与真验过的绿同形——把证据文件删掉，
 *  桌面套件仍然全绿，只是悄悄少验了一格。这些读数随仓库入库（tracked），缺席只可能是被删。
 *  台账把三件事绑在一起：产物（探针写它）、探针（还能再产一次）、消费者（判卷读它且复算保质期）。
 *  判卷 `tests/evidence-ledger.test.ts` 逐条核这三件事，并反向收口「tests/ 里出现的每份读数」。 */
export interface EvidenceRecord {
  /** 相对 apps/desktop 的证据文件。 */
  readonly file: string;
  /** 产出它的探针（相对 apps/desktop）。 */
  readonly producer: string;
  /** 读它的判卷（相对 tests/）。 */
  readonly consumers: readonly string[];
}

export const EVIDENCE_LEDGER: readonly EvidenceRecord[] = [
  {
    file: "outputs/cds-parity-verify/values.json",
    producer: "scripts/cds-values-probe.cjs",
    consumers: ["cds-parity.test.ts", "cds-components.test.ts"],
  },
  {
    file: "outputs/ime-guard-749/checks.json",
    producer: "scripts/ime-guard-smoke.cjs",
    consumers: ["ime-guard.test.ts"],
  },
  {
    file: "outputs/queue-key-750/checks.json",
    producer: "scripts/queue-key-smoke.cjs",
    consumers: ["queue-key.test.ts"],
  },
  {
    file: "outputs/overlay-mutex-752/checks.json",
    producer: "scripts/overlay-mutex-smoke.cjs",
    consumers: ["overlay-mutex.test.ts"],
  },
];

/** 证据文件的绝对路径（本 helper 在 tests/helpers ⇒ 上两级是 apps/desktop）。 */
export function evidenceFile(rel: string): string {
  return fileURLToPath(new URL(`../../${rel}`, import.meta.url));
}

/** 证据缺席时那句话（判卷侧统一措辞：缺席是删了证据，不是「没验也算过」）。 */
export function evidenceMissingMessage(rel: string, producer: string): string {
  return `缺少 ${rel}：这份读数随仓库入库，缺席说明被删除；改过 renderer 后重跑 ${producer} 并提交新读数`;
}

/** null = 证据盖的是当前源与当前构建；否则返回可操作的原因。 */
export function staleEvidenceReason(measured: SealedEvidence): string | null {
  const actual = rendererDigest();
  if (measured.rendererDigest !== actual) {
    return `证据与当前 renderer 源不是同一代（证据 ${measured.rendererDigest ?? "无摘要"} / 当前 ${actual}）——改过 renderer 后必须重跑探针并提交新读数`;
  }
  if (measured.buildFresh !== true) {
    return "探针量到的是旧构建（源晚于产物）——先 pnpm --filter cairn-desktop build，再重跑探针";
  }
  return null;
}
