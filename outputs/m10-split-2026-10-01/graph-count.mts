import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
const root = process.argv[2]!;
const entry = process.argv[3]!;
const seen = new Set<string>();
const impl = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+"([^"]+)"/g;
const bare = /(?:^|\n)\s*import\s+"([^"]+)"/g;
function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;              // 包依赖不算本仓的模块面
  const base = resolve(dirname(from), spec);
  for (const c of [base + ".ts", base + ".mts", join(base, "index.ts")]) if (existsSync(c)) return c;
  return null;
}
const stack = [resolve(root, entry)];
while (stack.length > 0) {
  const f = stack.pop()!;
  if (seen.has(f) || !existsSync(f)) continue;
  seen.add(f);
  const src = readFileSync(f, "utf8");
  for (const re of [impl, bare]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const r = resolveSpec(f, m[1]!);
      if (r !== null) stack.push(r);
    }
  }
}
console.log(`${entry} 的传递依赖：**${seen.size}** 个本仓模块`);
process.exit(0);
