// 冒烟 profile 清理覆盖率判卷（第 1079 页）：任何自建 userData profile 的冒烟脚本都必须走共享 helper。
// 动因：第 1068 页只把 settings-sweep 一支迁到 lib/profile-cleanup.cjs；本页现读 83 支脚本带
// app.setPath('userData')，其余在 app.on('quit') 里 rmSync —— Chromium 原生退出会在 JS 钩子之后
// 重建 Local State / Preferences / Session Storage（helper 头注的探针证据），所以 rmSync 成功也照漏。
// 判据两条：① 自建 profile ⇒ 必须引 helper 且真调 scheduleProfileCleanup；② 钩子里不许再出现
// rmSync(profile|root) 的老写法（那正是被证伪的修法）。防空转：脚本面至少扫到 80 支。
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL("../scripts", import.meta.url));

function scripts(): { name: string; src: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".cjs"))
    .sort()
    .map((name) => ({ name, src: readFileSync(new URL("../scripts/" + name, import.meta.url), "utf8") }));
}

describe("冒烟脚本的 profile 清理只有一个出口（第 1068 页 helper）", () => {
  it("每个自建 userData profile 的脚本都引 helper 并真的安排清理", () => {
    const files = scripts();
    const withProfile = files.filter(({ src }) => /app\.setPath\((['"])userData\1/.test(src));
    const offenders = withProfile
      .filter(({ src }) => !src.includes('require("./lib/profile-cleanup.cjs")') || !src.includes("scheduleProfileCleanup("))
      .map(({ name }) => name);
    expect(files.length, "一支冒烟脚本都没扫到（取料面坏了）").toBeGreaterThanOrEqual(80);
    expect(withProfile.length, "自建 profile 的脚本一支都没扫到（正则坏了）").toBeGreaterThanOrEqual(80);
    expect(offenders, "这些脚本自建 profile 却没走共享清理：" + offenders.join(" | ")).toEqual([]);
  });

  it("钩子里不许再出现 rmSync(profile|root) 的老写法（JS 钩子删不掉 Chromium 残壳）", () => {
    const offenders = scripts()
      .filter(({ src }) => /rmSync\(\s*(profile|root)\b/.test(src))
      .map(({ name }) => name);
    expect(offenders, "老写法复活：" + offenders.join(" | ")).toEqual([]);
  });
});
