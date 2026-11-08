// 画廊脚本的环境体检（第 931 页）：
// ELECTRON_RUN_AS_NODE=1 时 `electron <脚本>` 其实是 node 在跑，require("electron") 退化成字符串，
// app 是 undefined ⇒ 老脚本在 app.whenReady() 报「reading 'whenReady'」，catch 里的 app.exit(1)
// 再抛「reading 'exit'」——真正的原因（环境变量）看不见。这条判据钉「指认环境 + 退出码 2」。
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DESKTOP = join(import.meta.dirname, "..");

describe("ui-gallery 的环境体检", () => {
  it("ELECTRON_RUN_AS_NODE=1 ⇒ 指认环境、退 2（不是一段 node 栈）", () => {
    const r = spawnSync(process.execPath, [join(DESKTOP, "scripts", "ui-gallery.cjs")], {
      cwd: DESKTOP,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("ELECTRON_RUN_AS_NODE");
    expect(r.stderr).toContain("env -u ELECTRON_RUN_AS_NODE");
    expect(r.stderr).not.toContain("whenReady");
  });
});
