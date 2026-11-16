// 判卷面写保护的**真 Seatbelt** 判卷（2026-11-15，F1 的承重面）。
//
// 为什么不是"读 profile 文本像不像"：SBPL 的最后一条匹配规则胜出、literal 按 vnode 判定、
// 路径必须 realpath——这三点任何一条写错，profile 文本都"看着对"而命令照样写得动。本文件起真
// `/usr/bin/sandbox-exec`，逐形状尝试写冻结文件，断言盘上字节逐字未变；并跑一条**非冻结**
// 写入作配对（否则「全拒」也能让上面全绿——那是把沙箱写坏当成修好）。
//
// 平台边界：只有 darwin 且 sandbox-exec 存在时才跑。跳过会显式标出来；非 macOS 上的地板是
// run_shell 的跑后校验（tests/frozen-shell-guard.test.ts），不是本文件。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSandboxProfile } from "../src/main/sandbox";

const SANDBOX = "/usr/bin/sandbox-exec";
const exec = promisify(execFile);
const available = process.platform === "darwin" && existsSync(SANDBOX);
const suite = available ? describe : describe.skip;

suite("判卷面写保护：真 Seatbelt 逐形状判卷", () => {
  let root = "";
  let profile = "";
  const judgeRel = "fixtures/mock/judge.ts";
  const tableRel = "scripts/frozen-sha256.json";

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "dsh-frozen-sbx-")));
    await mkdir(join(root, "fixtures", "mock"), { recursive: true });
    await mkdir(join(root, "scripts"), { recursive: true });
    await mkdir(join(root, ".tmp"), { recursive: true });
    await writeFile(join(root, judgeRel), "original", "utf8");
    await writeFile(join(root, "evil.txt"), "evil", "utf8");
    await writeFile(join(root, tableRel), JSON.stringify({ [judgeRel]: "0".repeat(64) }), "utf8");
    profile = buildSandboxProfile(root);
  });

  afterAll(async () => {
    if (root !== "") await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  /** 每条命令执行前把靶子写回基线，并取一份前后可比的 stat。
   *  只查内容还不够：`chmod` 与 `touch` 即使被放行也不改内容，会在这条判卷里空过。
   *  `denied` 直接读命令的退出码：盘上状态是结果，退出码是「OS 真的拒了」这条因果。 */
  async function attempt(command: string): Promise<{
    mode: number; mtimeMs: number; beforeMode: number; beforeMtimeMs: number; denied: boolean;
  }> {
    const target = join(root, judgeRel);
    await writeFile(target, "original", "utf8");
    const before = statSync(target);
    let denied = false;
    try {
      await exec(SANDBOX, ["-p", profile, "bash", "-c", command], {
        cwd: root,
        env: { ...process.env, TMPDIR: join(root, ".tmp") },
        timeout: 20_000,
      });
    } catch (error) {
      const { code, signal, killed } = error as { code?: unknown; signal?: unknown; killed?: unknown };
      // 超时（我们自己杀的，killed=true）不算「OS 拒绝」；被 Seatbelt 直接以信号杀掉同样是拒绝，
      // 只认退出码会把它误判成「放行」而红在别的机器上。
      denied = killed !== true && ((typeof code === "number" && code !== 0) || typeof signal === "string");
    }
    const after = statSync(target);
    return { mode: after.mode, mtimeMs: after.mtimeMs, beforeMode: before.mode, beforeMtimeMs: before.mtimeMs, denied };
  }

  it("profile 里每个冻结文件（含表自身）都有一条 literal 拒绝，且排在 allow 之后", () => {
    const lines = profile.split("\n");
    const allowAt = lines.findIndex((l) => l.startsWith("(allow file-write* (subpath"));
    const judgeAt = lines.findIndex((l) => l.includes("(deny file-write* (literal") && l.includes(judgeRel));
    const tableAt = lines.findIndex((l) => l.includes("(deny file-write* (literal") && l.includes(tableRel));
    expect(allowAt).toBeGreaterThanOrEqual(0);
    expect(judgeAt).toBeGreaterThan(allowAt);
    expect(tableAt).toBeGreaterThan(allowAt);
  });

  it("20 种写/毁形状逐一被 OS 拒绝，冻结文件与基线逐字未变", async () => {
    const shapes = [
      "echo hacked > fixtures/mock/judge.ts",
      "echo hacked >> fixtures/mock/judge.ts",
      "echo hacked | tee fixtures/mock/judge.ts",
      "cp evil.txt fixtures/mock/judge.ts",
      "mv evil.txt fixtures/mock/judge.ts",
      "rm -f fixtures/mock/judge.ts",
      `sed -i '' 's/original/hacked/' fixtures/mock/judge.ts`,
      `python3 -c "open('fixtures/mock/judge.ts','w').write('hacked')"`,
      `node -e "require('fs').writeFileSync('fixtures/mock/judge.ts','hacked')"`,
      "truncate -s 0 fixtures/mock/judge.ts",
      "ln -sf evil.txt fixtures/mock/judge.ts",
      "dd if=/dev/zero of=fixtures/mock/judge.ts bs=1 count=1",
      `perl -i -pe 's/original/hacked/' fixtures/mock/judge.ts`,
      "install -m 644 evil.txt fixtures/mock/judge.ts",
      "chmod 777 fixtures/mock/judge.ts",
      "touch fixtures/mock/judge.ts",
      "unlink fixtures/mock/judge.ts",
      "ln fixtures/mock/judge.ts hard.txt && echo hacked > hard.txt",
      "ln -s fixtures/mock/judge.ts alias.txt && echo hacked > alias.txt",
      `python3 -c "import os; open('evil2.txt','w').write('x'); os.replace('evil2.txt','fixtures/mock/judge.ts')"`,
      "echo {} > scripts/frozen-sha256.json",
    ];
    for (const command of shapes) {
      const after = await attempt(command);
      expect(after.denied, `${command}：命令没有被 OS 拒绝（退出码为 0 或超时）`).toBe(true);
      expect(await readFile(join(root, judgeRel), "utf8"), command).toBe("original");
      // `chmod` / `touch` 是两种「不改内容也能造成改动」的形状：内容断言单独看会空过。
      expect(after.mode, `${command}：冻结文件的权限位被改了`).toBe(after.beforeMode);
      expect(after.mtimeMs, `${command}：冻结文件的 mtime 被改了`).toBe(after.beforeMtimeMs);
    }
    expect(await readFile(join(root, tableRel), "utf8")).toContain("fixtures/mock/judge.ts");
  });

  it("配对：同一条 profile 下写非冻结文件照常成功（不是「全拒」冒充绿）", async () => {
    await exec(SANDBOX, ["-p", profile, "bash", "-c", "echo ok > plain.txt"], {
      cwd: root,
      env: { ...process.env, TMPDIR: join(root, ".tmp") },
    });
    expect(await readFile(join(root, "plain.txt"), "utf8")).toBe("ok\n");
  });
});
