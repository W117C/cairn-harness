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

describe("bundled font resources", () => {
  for (const [, relative] of css.matchAll(/url\("([^\"]+\.(?:woff2|ttf))"\)/g)) {
    it(`${relative} is available offline and matches its pinned upstream bytes`, () => {
      const path = resolve(renderer, relative!);
      expect(existsSync(path), `Missing font: ${path}`).toBe(true);
      const entry = manifest.files.find((file) => resolve(renderer, file.file) === path);
      expect(entry, `Missing provenance in ${dirname(path)}`).toBeDefined();
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(entry!.sha256);
    });
  }
});
