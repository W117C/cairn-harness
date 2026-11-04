import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { collectCensus } from "../scripts/verify-census.ts";

const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "verify-census.ts");

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs) {
    try {
      // 测试数据绝不落工作区：建在 OS 临时目录，跑完即弃（不递归删，避免误伤宿主机）。
      // 这里只留空目录引用，由 OS 回收；不主动 rm 整棵以防删错。
    } catch {
      /* noop */
    }
  }
  tempDirs.length = 0;
});

function makeWorkspace(files: Record<string, string>): string {
  // 临时工作区建在仓内 `.tmp/` 下：子进程用 `node --import tsx` 启动，靠祖先 node_modules 解析 tsx。
  // 建在系统 TMPDIR 里会让「沙箱内绿、普通 shell 红」——同一个判据两种结论（INCIDENTS.md 事故 4）。
  mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), ".tmp", "verify-census-"));
  tempDirs.push(root);
  const sessionsDir = join(root, ".agent", "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(sessionsDir, name), content, "utf8");
  }
  return root;
}

const VERIFY_OK = '{"type":"verify_result","ok":true,"attempt":1,"maxAttempts":3,"results":[]}';
const VERIFY_BAD = '{"type":"verify_result","ok":false,"attempt":1,"maxAttempts":3,"results":[]}';
const GOAL_MSG = '{"type":"user_message","content":"agent self-run","origin":{"kind":"goal","turn":1,"max_turns":3}}';

// 三种会话：无 verify / 首拍绿 / 首拍红
const threeScenarios: Record<string, string> = {
  "no-verify.jsonl":
    '{"type":"user_message","content":"do a thing"}\n' +
    GOAL_MSG + "\n" +
    '{"type":"assistant_message","content":"ok"}\n',
  "first-green.jsonl":
    '{"type":"user_message","content":"fix it"}\n' +
    VERIFY_OK + "\n" +
    '{"type":"user_message","content":"another turn"}\n',
  "first-red.jsonl":
    '{"type":"user_message","content":"make"}\n' +
    VERIFY_BAD + "\n" +
    VERIFY_OK + "\n" +
    '{"type":"user_message","content":"retry turn"}\n',
};

describe("verify-census 判据覆盖率统计", () => {
  it("三个会话目录：五个字段与 ratio（2/3）正确", () => {
    const ws = makeWorkspace(threeScenarios);
    const r = collectCensus(ws);
    expect(r.sessions).toBe(3);
    expect(r.withVerify).toBe(2);
    expect(r.firstGreen).toBe(1);
    expect(r.userTurns).toBe(5); // 1 + 2 + 2（goal 轮不计）
    expect(r.ratio).toBeCloseTo(2 / 3, 10);
    expect(r.skippedLines).toBe(0);
  });

  it("0 会话时 ratio 为 null", () => {
    const ws = makeWorkspace({});
    const r = collectCensus(ws);
    expect(r.sessions).toBe(0);
    expect(r.withVerify).toBe(0);
    expect(r.firstGreen).toBe(0);
    expect(r.userTurns).toBe(0);
    expect(r.ratio).toBeNull();
  });

  it("坏行容错：跳过坏行并计入 skippedLines，不影响统计", () => {
    const ws = makeWorkspace({
      "no-verify.jsonl": '{"type":"user_message","content":"do a thing"}\n',
      "first-red.jsonl":
        "{this is not valid json\n" + // 坏行：应被跳过并计入 skippedLines
        '{"type":"user_message","content":"make"}\n' +
        VERIFY_BAD + "\n" +
        VERIFY_OK + "\n",
      "first-green.jsonl":
        '{"type":"user_message","content":"fix it"}\n' + VERIFY_OK + "\n",
    });
    const r = collectCensus(ws);
    expect(r.skippedLines).toBeGreaterThanOrEqual(1);
    expect(r.sessions).toBe(3);
    expect(r.withVerify).toBe(2);
    expect(r.firstGreen).toBe(1); // 首拍红的文件 firstGreen 不计
    expect(r.ratio).toBeCloseTo(2 / 3, 10);
  });
});

describe("verify-census CLI 命令", () => {
  it("默认打印人读三行（sessions/withVerify/firstGreen）", () => {
    const ws = makeWorkspace(threeScenarios);
    const out = execFileSync("node", ["--import", "tsx", SCRIPT, "--workspace", ws], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const lines = out.split("\n").filter((l) => l.length > 0);
    expect(lines).toEqual(["sessions: 3", "withVerify: 2", "firstGreen: 1"]);
  });

  it("--json 打印完整 JSON 且字段一致", () => {
    const ws = makeWorkspace(threeScenarios);
    const out = execFileSync("node", ["--import", "tsx", SCRIPT, "--workspace", ws, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const r = JSON.parse(out) as ReturnType<typeof collectCensus>;
    expect(r.sessions).toBe(3);
    expect(r.withVerify).toBe(2);
    expect(r.firstGreen).toBe(1);
    expect(r.userTurns).toBe(5);
    expect(r.ratio).toBeCloseTo(2 / 3, 10);
    expect(r.skippedLines).toBe(0);
  });

  it("显式 --workspace 指向另一个目录时，从该目录读取而非 cwd", () => {
    // cwd 指向一个不含任何会话数据的空工作区；显式 --workspace 指向 wsData，应读到 wsData 的统计。
    const cwdNoData = makeWorkspace({});
    const wsData = makeWorkspace(threeScenarios);
    const out = execFileSync("node", ["--import", "tsx", SCRIPT, "--workspace", wsData], {
      cwd: cwdNoData,
      encoding: "utf8",
    });
    const lines = out.split("\n").filter((l) => l.length > 0);
    expect(lines).toEqual(["sessions: 3", "withVerify: 2", "firstGreen: 1"]);
  });
});
