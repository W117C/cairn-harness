// 凭证页占号（走 243 页的原子号池；第 238/245 页同款用法）。
import { claimPage, pageNumbersIn, claimedPages } from "../../scripts/lib/page-claim.ts";
import { readdirSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = ".git/dsh-pages";
const ops = {
  ensureDir: (d: string) => mkdirSync(d, { recursive: true }),
  list: (d: string): string[] | null => {
    try { return readdirSync(d); } catch { return null; }
  },
  create: (d: string, name: string): "ok" | "exists" | "error" => {
    try { mkdirSync(join(d, name)); return "ok"; } catch (e) {
      const code = (e as { code?: string }).code;
      return code === "EEXIST" ? "exists" : "error";
    }
  },
};
const taken = [...new Set([
  ...pageNumbersIn(readFileSync("PROGRESS.md", "utf8")),
  ...claimedPages(ops.list(dir) ?? []),
])];
console.log(JSON.stringify(claimPage({ dir, taken, ops })));
