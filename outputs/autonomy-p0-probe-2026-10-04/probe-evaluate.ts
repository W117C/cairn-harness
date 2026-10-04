// 取证探针（一次性）：`#85` 那批红的**决策对象**逐档打出来。会话照判卷同一个造法
// （`tests/autonomy.test.ts:17` 的 `newAutonomySession(mode, {rules, sandboxAvailable: null, sessionScopes: new Set()})`），
// 免得我拿一份不合法的 session 读出一个假结论。
import { evaluate, newAutonomySession, type AutonomySession } from "../../src/permissions";

const PATHS = [".git/hooks/pre-commit", "sub/.git/hooks/post-commit", ".git/config", ".agent/lsp.json", ".agent/config.json", ".npmrc", ".env"];
const MODES = ["default", "guided", "auto"] as const;

const session = (mode: string): AutonomySession => {
  const s = newAutonomySession(mode as AutonomySession["mode"], {
    rules: [],
    sandboxAvailable: null as never,
    sessionScopes: new Set<string>(),
  });
  s.planBlocked = () => false;
  return s;
};

for (const mode of MODES) {
  for (const p of PATHS) {
    const d = evaluate("write_file", { path: p, content: "x" }, session(mode)) as Record<string, unknown>;
    console.log(
      mode.padEnd(8) + " " + p.padEnd(26)
        + " verdict=" + String(d.verdict).padEnd(7)
        + " layer=" + String(d.layer).padEnd(11)
        + " risk=" + String(d.risk),
    );
  }
}

// 正控一：同目标走 shell 面（威胁表那条 redirectOnto）——它该是 ask/high；若它也 approve，那就是整张表失效。
const sh = evaluate("run_shell", { command: "echo hi >> .git/hooks/pre-commit" }, session("auto")) as Record<string, unknown>;
console.log("正控 run_shell ⇒ verdict=" + String(sh.verdict) + " layer=" + String(sh.layer) + " risk=" + String(sh.risk));
// 正控二：非敏感路径该照常直通（证明修法不是"把所有写都拦下来"）。
const ok = evaluate("write_file", { path: "src/a.ts", content: "x" }, session("auto")) as Record<string, unknown>;
console.log("正控 普通写 ⇒ verdict=" + String(ok.verdict) + " layer=" + String(ok.layer) + " risk=" + String(ok.risk));
