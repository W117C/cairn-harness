/** 第 939 页：evolve 四处的 `digestOf` 原本各抄一份（candidate / episode / playbook / playbook-store）。
 *  这四处的 id 都靠它派生——长度或算法只要有一处改了，跨模块 id 就静默失配（按 id 查不到，但不报错）。
 *  判据：一份实现 + 一个真值 + 一处定义。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digestOf } from "../src/agent/evolve/digest";

const ROOT = join(import.meta.dirname, "..");

describe("evolve 的内容指纹只有一份（第 939 页）", () => {
  it("16 位小写十六进制，且空串是真值 e3b0c44298fc1c14（sha256 前 16）", () => {
    expect(digestOf("")).toBe("e3b0c44298fc1c14");
    expect(digestOf("cand_x")).toMatch(/^[0-9a-f]{16}$/u);
    expect(digestOf("a")).not.toBe(digestOf("b"));
    expect(digestOf("a")).toBe(digestOf("a"));
  });

  it("四个消费面都 import 同一份，且 src/ 里只剩一处定义", () => {
    const files = [
      "src/agent/evolve/candidates.ts",
      "src/agent/evolve/episode.ts",
      "src/agent/evolve/playbook.ts",
      "src/main/evolve/playbook-store.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, `${f} 没读共享实现`).toMatch(/import \{ digestOf \} from "[^"]*digest"/u);
      expect(src, `${f} 还留着自己的 digestOf`).not.toContain("function digestOf");
    }
    const digest = readFileSync(join(ROOT, "src/agent/evolve/digest.ts"), "utf8");
    expect(digest).toContain("export function digestOf");
    expect(digest).toContain("slice(0, 16)");
  });
});
