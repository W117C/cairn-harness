/** 审批卡在终端上「让人看得见自己批的是什么」这一格的判卷（第 400 页）。
 *
 *  缺陷形状（现读，不是推演）：CLI 的审批行把 args 交给 `argsDigest`，而它此前只认两枚键
 *  （`path`/`file_path` 与 `command`）。任何**不带这两枚键**的卡——新落的 verify 信任门
 *  `{repoDir, fingerprint, commands}` 就是典型——只会印成「（repoDir, fingerprint, commands）」。
 *  于是那句「批准 = 这批命令可以在这个仓里被自动执行」在终端上**没有任何凭据支撑**：
 *  人看不到是哪个仓，也看不到是哪几条命令。这是把高风险确认做成仪式，属能力 7/8 的洞。
 *
 *  钉法按本仓口径走：每一维正反各一条，且白名单这件事要有**反向**观察者——
 *  未列出的键（可能带凭据、可能是大 payload）不许被顺手印出来。摘要还得**有界**：
 *  「看得见」不等于「把 20 条命令刷满屏幕」。
 */
import { describe, expect, it } from "vitest";
import { argsDigest } from "../src/agent/fork-cli";

describe("高风险卡的真凭据：仓目录与命令面必须出现在摘要里", () => {
  it("verify 信任卡的 args ⇒ 摘要点得出仓目录，也点得出要跑的命令（不是一串键名）", () => {
    const digest = argsDigest({
      repoDir: "/home/dev/clone-of-victim-repo",
      fingerprint: "deadbeefdeadbeefdeadbeefdeadbeef",
      commands: ["printf TEST > test-ran", "npm test"],
    });
    expect(digest, "看不到是哪个仓 ⇒ 批的是「某个仓的任意命令」").toContain("/home/dev/clone-of-victim-repo");
    expect(digest, "看不到命令 ⇒ 批的是「不知道是什么的东西」").toContain("printf TEST > test-ran");
    expect(digest).toContain("npm test");
    expect(digest, "只印键名就是原缺陷形状").not.toBe("（repoDir, fingerprint, commands）");
  });

  it("正半边：不在白名单上的键（凭据形状）不许被顺手印出来", () => {
    const secret = "ghp_LIVE_TOKEN_do_not_print";
    const digest = argsDigest({ token: secret, apiKey: secret, repoDir: "/srv/app", commands: ["make test"] });
    expect(digest, "摘要不许把未点名键的值刷到终端（可能被录屏／落日志）").not.toContain(secret);
    expect(digest).toContain("/srv/app"); // 白名单那一支照常工作
    expect(digest).toContain("make test");
  });

  it("纯未知键（一枚都没有白名单项）⇒ 仍回到键名形态，不抛也不印空值", () => {
    expect(argsDigest({ payloadRef: "opaque-1", retry: 3 })).toBe("（payloadRef, retry）");
    expect(argsDigest({})).toBe("");
  });
});

describe("既有两支不许漂：write_file 与 run_shell 的摘要逐字照旧", () => {
  it("write_file ⇒ 只有路径本身（不追加 key=value 前缀，正文一个字都不进终端）", () => {
    const digest = argsDigest({ path: "src/a.ts", content: "一整份文件正文，绝不能出现在终端上\n第二行" });
    expect(digest).toBe("src/a.ts");
    expect(digest).not.toContain("绝不能出现在终端上");
  });

  it("run_shell ⇒ 只有命令首行（多行 payload 不刷终端）", () => {
    expect(argsDigest({ command: "grep -rn foo src/\n第二行不该出现" })).toBe("grep -rn foo src/");
  });
});

describe("有界：命令再多也不把审批行刷成一屏", () => {
  it("20 条命令 ⇒ 摘要里最多点名 3 条，其余折成 +N 条，整串长度有上限", () => {
    const commands = Array.from({ length: 20 }, (_, i) => `very-long-verify-command-number-${String(i)} --with-a-lot-of-flags`);
    const digest = argsDigest({ repoDir: "/srv/app", commands });
    const named = commands.filter((c) => digest.includes(c)).length;
    expect(named, "命令条数不该被逐条刷出来").toBeLessThanOrEqual(3);
    expect(digest).toContain("+17 条");
    expect(digest.length, "一行审批提示不许吃掉整个终端").toBeLessThan(400);
  });
});
