import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const renderer = fileURLToPath(new URL("../src/renderer/", import.meta.url));
const css = readFileSync(resolve(renderer, "dsh-claude-style.css"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(renderer, "vendor/dsh-claude-style/UPSTREAM.json"), "utf8")) as {
  files: { file: string; sha256: string }[];
};

const fontUrls = [...css.matchAll(/url\("([^\"]+\.(?:woff2|ttf))"\)/g)].map((m) => m[1]!);

describe("bundled font resources", () => {
  it("取料面非空：一条字体声明都扫不到＝正则被新写法打败，下面会零用例假绿", () => {
    expect(fontUrls.length, "css 里没有 url(\"…woff2|ttf\") ⇒ 本组会变成空套件").toBeGreaterThan(0);
  });
  for (const relative of fontUrls) {
    it(`${relative} is available offline and matches its pinned upstream bytes`, () => {
      const path = resolve(renderer, relative);
      expect(existsSync(path), `Missing font: ${path}`).toBe(true);
      const entry = manifest.files.find((file) => resolve(renderer, file.file) === path);
      expect(entry, `Missing provenance in ${dirname(path)}`).toBeDefined();
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(entry!.sha256);
    });
  }
});
