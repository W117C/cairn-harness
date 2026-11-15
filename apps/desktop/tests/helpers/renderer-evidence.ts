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
