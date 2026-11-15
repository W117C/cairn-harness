import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL("../src/renderer/components", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("UI 原语边界：页面组件不得直连 Radix", () => {
  it("只有 components/ui/dropdown-menu.tsx 可以 import @radix-ui/react-dropdown-menu", () => {
    const all = walk(DIR);
    const offenders = all.filter((p) => {
      if (relative(DIR, p) === "ui/dropdown-menu.tsx") return false;
      return /from\s+["']@radix-ui\/react-dropdown-menu["']/u.test(readFileSync(p, "utf8"));
    }).map((p) => relative(DIR, p));
    expect(offenders, "页面组件绕过 components/ui 直连了 Radix").toEqual([]);
    expect(readFileSync(join(DIR, "ui/dropdown-menu.tsx"), "utf8")).toContain("@radix-ui/react-dropdown-menu");
  });
});
