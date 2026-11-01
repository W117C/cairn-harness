/** 第 947 页：两个纯函数各被抄成两份——仓库名解析与触发条件展示名。
 *
 *  · `repoNameFromUrl`：main 侧决定**落库的项目名**，渲染层用它预览「将克隆到：」。两处各一份时，
 *    改一处就漂：预览说 `bar`，落库说 `bar-2`，或者预览空、落库有名。
 *  · `triggerLabel`：`agent/evolve/playbook.ts` 渲染经验条目，`main/evolve/promotion.ts` 生成晋升包的正文。
 *    同一条件在两处说两个词（「信号 x」vs「工具 x」改一处就错位）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoNameFromUrl } from "../src/git-url";
import { triggerLabel } from "../src/agent/evolve/playbook";
import type { ExperienceEntry } from "../src/agent/evolve/playbook";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

describe("仓库名解析只有一份（第 947 页）", () => {
  it("https / scp 风格 / 尾斜杠 / .git 后缀 / 非法一律 null", () => {
    expect(repoNameFromUrl("https://github.com/foo/bar.git")).toBe("bar");
    expect(repoNameFromUrl("git@github.com:foo/bar")).toBe("bar");
    expect(repoNameFromUrl("https://github.com/foo/bar/")).toBe("bar");
    expect(repoNameFromUrl("https://github.com/foo/")).toBe("foo");
    expect(repoNameFromUrl("git@github.com:foo/ba r")).toBe(null);
    expect(repoNameFromUrl("https://github.com/foo/bar@baz")).toBe(null);
  });

  it("main 与渲染层都读同一份，且不再各自写一份", () => {
    expect(read("src/main/git-ops.ts")).toMatch(/export \{ repoNameFromUrl \} from "\.\.\/git-url"/u);
    const menu = read("apps/desktop/src/renderer/components/AddProjectMenu.tsx");
    expect(menu).toContain('from "../../../../../src/git-url"');
    expect(menu).not.toContain("function repoNamePreview");
    expect(menu).toContain("repoNameFromUrl(cloneUrl)");
  });
});

describe("触发条件展示名只有一份（第 947 页）", () => {
  const entry = (trigger: ExperienceEntry["trigger"], scope: Partial<ExperienceEntry["scope"]> = {}): ExperienceEntry =>
    ({ trigger, scope: { keywords: ["src/agent"], ...scope } } as unknown as ExperienceEntry);

  it("五种触发各一个词，缺字段不摆 undefined", () => {
    expect(triggerLabel(entry({ when: "always" } as never))).toBe("总是适用");
    expect(triggerLabel(entry({ when: "on-task-class" } as never, { taskClass: "edit" }))).toBe("任务类 edit");
    expect(triggerLabel(entry({ when: "on-task-class" } as never))).toBe("任务类 相关");
    expect(triggerLabel(entry({ when: "on-signal", signal: "red" } as never))).toBe("信号 red");
    expect(triggerLabel(entry({ when: "on-tool", signal: "pytest" } as never))).toBe("工具 pytest");
    expect(triggerLabel(entry({ when: "on-path", keywords: ["src/agent"] } as never))).toBe("路径 src/agent");
  });

  it("两个消费面都读同一份，且 promotion 不再自己写一份", () => {
    const promotion = read("src/main/evolve/promotion.ts");
    expect(promotion).toContain('import { triggerLabel, type ExperienceEntry } from "../../agent/evolve/playbook"');
    expect(promotion).not.toContain("function triggerLabel");
    expect(read("src/agent/evolve/playbook.ts")).toContain("export function triggerLabel");
  });
});
