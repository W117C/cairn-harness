// #99（台账）：`run_shell` 的重定向覆写绕开了覆盖前快照。
//
// 三个内容写工具（write_file / edit_file / apply_patch）在覆盖前都会把原件按字节抄进
// `.agent/snapshots/`，而一条 `> file`／`>> file` 走 `run_shell` 就把盘上的东西改了——
// 审计面上只留下一条 shell 回执，事后**没有任何原件可取回**。本文件把那一格钉成事实：
// ① `> 已有文件` 跑完必须真有一份逐字节等于原内容的覆盖前原件；
// ② 新建（`> 不存在的路径`）不拍（与 write_file 同口径：没有原件可保）；
// ③ 写目标认不出（变量拼接）⇒ 回执点名「未快照」，不许静默假装回滚得了；
// ④ 快照目录／系统区被写 ⇒ 仍被拒（既有地板 `assertNotAgentArea` 不许被这波放宽）。
// 另有八格边界：⑤ 区外目标出声但不拦命令、⑥ `>&2` 与 `/dev/null` 不冒充写目标（假噪音）、
// ⑦ 嵌套 `bash -c` 载荷里的重定向认得出（证明吃的是既有那份解析 `invocations`）、
// ⑧ 引号里的 `>` 只是文本（证明不是拿正则回头扫原始命令文本）、⑨ `>>` 追加同样留原件、
// ⑩ 快照层自己失败 ⇒ 写照常进行但必须出声、⑪ 链式两条与引号里带分隔符的目标（两遍取料）、
// ⑫ `snapshot:false` 那一档不拍也不出声、但 `.agent/` 地板照旧拒（worker 走的是这一档）。
//
// 刻意不碰的东西：审批语义一律不动（风险层 `src/permissions/risk.ts` 此刻在别人手里）——
// 认不出/够不着的目标只**出声**，命令照跑；只有 `.agent/` 那条既有地板才拒。
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { run_shell } from "../src/tools/run_shell";
import { SNAPSHOT_ROOT } from "../src/tools/snapshot";
import type { ToolContext } from "../src/tools/base";

/** 每格一块新工作区：判「拍没拍」用的是「快照目录在不在」，格子之间共享目录会让 ②⑥⑧
 *  那三格的「不该出现」被上一格拍出来的真目录污染（尺恒真就是假绿）。 */
const created: string[] = [];
let ws: string;
let outside = "";
const ctx = (): ToolContext => ({ workspace: ws, callId: "c-99" });
const runCmd = async (command: string): Promise<{ ok: boolean; output: string; snapshotId?: string }> =>
  await run_shell.run({ command }, ctx());
/** 快照根在本判卷里只由工具自己写：判「拍没拍」用目录在不在，比只读字段更硬（字段漏了目录也不会出现）。 */
const snapRoot = (): string => join(ws, ".agent", "snapshots");

beforeEach(async () => {
  // macOS 的 /tmp 实为 /private/tmp：路径比较要 realpath 后的串（AGENTS.md 环境注意）。
  ws = await realpath(await mkdtemp(join(tmpdir(), "dsh-shell-redirect-")));
  created.push(ws);
});
afterAll(async () => {
  for (const dir of created) await rm(dir, { recursive: true, force: true }).catch(() => {});
  if (outside !== "") await rm(outside, { force: true }).catch(() => {});
});

describe("#99 run_shell 重定向覆写的覆盖前快照", () => {
  it("① `> 已有文件`：跑完后 .agent/snapshots 里真有一份原件，且逐字节等于覆盖前的内容", async () => {
    const rel = "target.txt";
    const original = "第一行\n用户未提交的手改\n";
    await writeFile(join(ws, rel), original, "utf8");

    const r = await runCmd(`echo NEW > ${rel}`);
    expect(r.ok, "命令本身要照跑：这一格只补原件，不改写结果").toBe(true);
    expect(r.snapshotId, "覆盖已有文件必须落快照").toBeTypeOf("string");
    expect(String(r.snapshotId).startsWith(SNAPSHOT_ROOT + "/"), "快照必须落在 .agent/snapshots 之内").toBe(true);
    expect(r.output, "回执要把路径给模型（否则它不知道自己有这么一份原件）").toContain("覆盖前原件已存");

    const back = await readFile(join(ws, r.snapshotId as string));
    expect(Buffer.compare(back, Buffer.from(original, "utf8")), "取回的必须是覆盖前的原件，逐字节").toBe(0);
    expect(await readFile(join(ws, rel), "utf8")).toBe("NEW\n");
    expect(existsSync(snapRoot()), "快照目录必须真的被写出来了").toBe(true);
  });

  it("② 新建（`> 不存在的路径`）⇒ 不拍：没有原件可保，与 write_file 同口径", async () => {
    const r = await runCmd("echo BRAND > fresh.txt");
    expect(r.ok).toBe(true);
    expect(r.snapshotId, "新建文件没有「覆盖前」可言 ⇒ 不该有快照").toBeUndefined();
    expect(existsSync(snapRoot()), "连快照目录都不该被建出来").toBe(false);
    expect(r.output).not.toContain("覆盖前原件已存");

    const appendNew = await runCmd("printf 'a' >> fresh2.txt");
    expect(appendNew.ok).toBe(true);
    expect(appendNew.snapshotId, "往不存在的路径追加同样是新建").toBeUndefined();
    expect(await readFile(join(ws, "fresh2.txt"), "utf8")).toBe("a");
  });

  it("③ 写目标认不出（变量拼接）⇒ 回执点名「未快照」，不许静默", async () => {
    // 盘上真的有原件（out3.txt 已存在且非空）：这一条**拍得到才叫能回滚**，认不出来就必须出声。
    await writeFile(join(ws, "out3.txt"), "ORIGINAL-3\n", "utf8");
    const r = await runCmd('F=out3.txt; echo hi > "$F"');
    expect(r.ok, "认不出目标不该把命令变成失败（审批语义不动）").toBe(true);
    expect(r.output, "必须出声：这条重定向没拍快照").toContain("未快照");
    expect(r.output, "出声要点名是哪一条写目标").toContain("$F");
    expect(r.snapshotId).toBeUndefined();
    expect(existsSync(snapRoot()), "认不出就不该假装拍到了").toBe(false);
    expect(await readFile(join(ws, "out3.txt"), "utf8"), "命令照跑：盘上确实被改了（这正是没原件的那次）").toBe("hi\n");

    // 展开不出来的那一支（变量没赋值 ⇒ bash 自己报错）：回执照样要点名，不能跟着命令一起静默。
    const broken = await runCmd('echo hi > "${D}/out4.txt"');
    expect(broken.output).toContain("未快照");
    expect(broken.output).toContain("${D}/out4.txt");
  });

  it("④ 系统区／快照目录自身被写 ⇒ 仍被拒（既有地板 assertNotAgentArea 不许被这波放宽）", async () => {
    await expect(runCmd("echo planted > .agent/snapshots/planted.txt"))
      .rejects.toThrow(/\.agent/u);
    expect(await stat(join(ws, ".agent", "snapshots", "planted.txt")).catch(() => null), "拒 = 命令根本没跑").toBeNull();

    await expect(runCmd("echo pwned > .agent/permissions.json")).rejects.toThrow(/\.agent/u);
    expect(await stat(join(ws, ".agent", "permissions.json")).catch(() => null)).toBeNull();

    // 绝对路径写法落进同一个工作区的 .agent/ 也一样拒（词法段判据同一条）。
    await expect(runCmd(`echo planted2 > ${join(ws, ".agent/snapshots/planted2.txt")}`))
      .rejects.toThrow(/\.agent/u);
    expect(await stat(join(ws, ".agent", "snapshots", "planted2.txt")).catch(() => null)).toBeNull();
  });

  it("⑤ 目标在工作区外 ⇒ 不拍（快照根是工作区相对路径，够不着），但必须出声且不拦命令", async () => {
    const outsidePath = join(dirname(ws), "outside-99-target.txt");
    outside = outsidePath;
    await writeFile(outsidePath, "ORIGINAL-OUTSIDE\n", "utf8");
    const r = await runCmd(`echo NEW > ${outsidePath}`);
    expect(r.ok, "区外目标由风险层那一边管，本波不加闸").toBe(true);
    expect(r.output).toContain("未快照");
    expect(r.snapshotId).toBeUndefined();
    expect(await readFile(outsidePath, "utf8")).toBe("NEW\n");
  });

  it("⑥ 描述符复制（`>&2`／`2>&1`）与 /dev/null 不算写目标：不许造假的「未快照」噪音", async () => {
    const r = await runCmd("echo boom >&2; echo junk > /dev/null; echo done");
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain("未快照");
    expect(r.output).toContain("boom");
    expect(r.snapshotId).toBeUndefined();
    expect(existsSync(snapRoot())).toBe(false);
  });

  it("⑦ 嵌套载荷（`bash -c '… > inner.txt'`）里的重定向认得出：吃的是既有那份解析，不是新写一份", async () => {
    const original = "ORIGINAL-INNER\n";
    await writeFile(join(ws, "inner.txt"), original, "utf8");
    const r = await runCmd("bash -c 'echo NEW > inner.txt'");
    expect(r.ok).toBe(true);
    expect(r.snapshotId, "`bash -c` 载荷里的覆写同样是覆写，原件必须留住").toBeTypeOf("string");
    expect(Buffer.compare(await readFile(join(ws, r.snapshotId as string)), Buffer.from(original, "utf8"))).toBe(0);
    expect(await readFile(join(ws, "inner.txt"), "utf8")).toBe("NEW\n");
  });

  it("⑧ 引号里的 `>` 只是文本：既不是写目标、也不许顺手拍它（证明按 token 认，不回头扫原始文本）", async () => {
    await writeFile(join(ws, "fake.txt"), "ORIGINAL-FAKE\n", "utf8");
    const r = await runCmd("echo 'redirect > fake.txt' > quoted-note.txt");
    expect(r.ok).toBe(true);
    expect(r.snapshotId, "quoted-note.txt 是新建 ⇒ 不拍；fake.txt 根本没被写 ⇒ 更不该拍").toBeUndefined();
    expect(r.output).not.toContain("未快照");
    expect(existsSync(snapRoot())).toBe(false);
    expect(await readFile(join(ws, "fake.txt"), "utf8"), "文本里那句 `> fake.txt` 不该被当成写目标").toBe("ORIGINAL-FAKE\n");
  });

  it("⑨ `>>` 追加同样不可回滚 ⇒ 已有文件也留原件", async () => {
    const original = "LINE-1\n";
    await writeFile(join(ws, "log.txt"), original, "utf8");
    const r = await runCmd("printf 'LINE-2\\n' >> log.txt");
    expect(r.ok).toBe(true);
    expect(r.snapshotId, "追加把文件改成了拿不回来的样子 ⇒ 原件就是追加前的那份").toBeTypeOf("string");
    expect(await readFile(join(ws, r.snapshotId as string), "utf8")).toBe(original);
    expect(await readFile(join(ws, "log.txt"), "utf8")).toBe("LINE-1\nLINE-2\n");
  });

  it("⑩ 快照层自己失败 ⇒ 写照常进行（护栏缺位不把成功变成失败），但必须点名这次覆写没了原件", async () => {
    const rel = "existing-10.txt";
    await writeFile(join(ws, rel), "ORIGINAL-10\n", "utf8");
    // 把快照根做成一个**普通文件**：mkdir/copyFile 必然失败（ENOTDIR），同 snapshot-d7 的手法。
    await mkdir(join(ws, ".agent"), { recursive: true });
    await writeFile(join(ws, ".agent", "snapshots"), "blocking file\n", "utf8");

    const r = await runCmd(`echo NEW > ${rel}`);
    expect(r.ok, "快照拍不成不该拦下用户的写").toBe(true);
    expect(r.snapshotId).toBeUndefined();
    expect(r.output, "拍不成必须出声，否则回执看起来像「能回滚」").toContain("未快照");
    expect(r.output).toContain(rel);
    expect(await readFile(join(ws, rel), "utf8")).toBe("NEW\n");
  });

  it("⑪ 链式两条重定向（`;`）与引号里带分隔符的目标都认得出（两遍取料各瞎一半）", async () => {
    await writeFile(join(ws, "k1.txt"), "ORIGINAL-K1\n", "utf8");
    await writeFile(join(ws, "k2.txt"), "ORIGINAL-K2\n", "utf8");
    const r = await runCmd("echo A > k1.txt; echo B > k2.txt");
    expect(r.ok).toBe(true);
    expect(r.output, "两个目标各留一份原件").toContain("k1.txt");
    expect(r.output).toContain("k2.txt");
    expect(r.snapshotId, "结构化字段只装一条 ⇒ 取第一条（apply_patch 同口径）").toBeTypeOf("string");
    expect(String(r.snapshotId).endsWith("k1.txt")).toBe(true);
    expect(await readFile(join(ws, "k1.txt"), "utf8")).toBe("A\n");
    expect(await readFile(join(ws, "k2.txt"), "utf8")).toBe("B\n");
    // 按快照根的实际内容取证（不靠「两次拍快照落在同一毫秒」那种会漂的路径拼法）。
    const listed = (await readdir(snapRoot(), { recursive: true })).map(String);
    const snapOf = (tail: string): string => {
      const hit = listed.filter((n) => n.endsWith(tail));
      expect(hit, "快照根里必须有 " + tail + " 的原件（实际列出：" + listed.join(",") + "）").toHaveLength(1);
      return hit[0]!;
    };
    expect(await readFile(join(snapRoot(), snapOf("k1.txt")), "utf8")).toBe("ORIGINAL-K1\n");
    expect(await readFile(join(snapRoot(), snapOf("k2.txt")), "utf8"), "第二条也必须落一份，不是只在正文里提一句").toBe("ORIGINAL-K2\n");

    // 引号里带 `;`：整串那一遍负责——字符级切段会把目标劈开，劈剩的那支不存在（按新建口径静默），
    // 而真目标必须拍到。这一格钉的是「并集」的另一半，缺它就只有切段那一遍在做事。
    const tricky = "w;x.txt";
    await writeFile(join(ws, tricky), "ORIGINAL-TRICKY\n", "utf8");
    const r2 = await runCmd(`echo NEW > "${tricky}"`);
    expect(r2.ok).toBe(true);
    expect(r2.snapshotId, "引号里的分隔符不该把写目标劈丢").toBeTypeOf("string");
    expect(await readFile(join(ws, r2.snapshotId as string), "utf8")).toBe("ORIGINAL-TRICKY\n");
  });

  it("⑫ worker 那一侧显式关掉（snapshot:false）⇒ 不拍也不出声，但 `.agent/` 地板照旧拒", async () => {
    await writeFile(join(ws, "w.txt"), "ORIGINAL-W\n", "utf8");
    const r = await run_shell.run({ command: "echo NEW > w.txt" }, { workspace: ws, callId: "c-99b", snapshot: false });
    expect(r.ok).toBe(true);
    expect(r.snapshotId, "关掉快照就不该假装能回滚（worktree 天然可回滚，§10.10）").toBeUndefined();
    expect(r.output).not.toContain("覆盖前原件已存");
    expect(r.output, "opt-out 那一档不该刷一堆「未快照」噪音").not.toContain("未快照");
    expect(existsSync(snapRoot())).toBe(false);
    // 地板不是快照开关管的：同一道 assertNotAgentArea，两个档都拒。
    await expect(run_shell.run({ command: "echo x > .agent/permissions.json" }, { workspace: ws, snapshot: false }))
      .rejects.toThrow(/\.agent/u);
  });
});
