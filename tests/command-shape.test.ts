// 「有效二进制」解析件的两测：包装写法必须看得见，参数与选项值必须看不见。
//
// 为什么成对（本仓绕过类判据的老规矩）：只测正例（`git push --force` 必被抓）的锚点，
// 会被"一律 deny"伪造成绿——解析件一旦把参数也当成命令，权限层就从"拦危险"变成"拦一切"，
// 用户只会看到审批卡变多而没人发现判据已经坏掉。所以每条正例都配一条反例。
//
// 形状取自 scripts/probe-shell-bypass.ts（09-21 实测红 24 / 绿 9）的 ① 与 ③ 两段。
import { describe, expect, it } from "vitest";
import { commandForms, invocations, tokenize } from "../src/permissions/command-shape";

const forms = (seg: string) => commandForms(seg.replace(/\s+/g, " ").trim());

describe("包装写法都产得出被禁的那条形（deny 不再被静默击穿）", () => {
  const WRAPPED = [
    "git push --force",
    "sudo git push --force",
    "sudo -u root git push --force",
    "env FOO=1 git push --force",
    "nohup git push --force",
    "timeout 30 git push --force",
    "timeout --foreground 30 git push --force",
    "command git push --force",
    "command -p git push --force",
    "nice -n 5 git push --force",
    "/usr/bin/git push --force",
    "GIT_PAGER=cat git push --force",
    "bash -c 'git push --force'",
    "sh -lc 'git push --force'",
    "bash -c 'git status; git push --force'",
    "sudo env -i GIT_PAGER=cat /usr/bin/git push --force",
  ];
  for (const cmd of WRAPPED) {
    it(cmd, () => {
      expect(forms(cmd)).toContain("git push --force");
    });
  }
});

describe("反例：参数、选项值、只读命令都不许冒充成被禁的那条形", () => {
  const NOT_A_COMMAND = [
    "echo 'git push --force'",
    "echo git push --force",
    "grep -r 'git push --force' src",
    "cat notes/git push --force.md",
    "vim 'git push --force'",
    "sudo -u root git status",
    "timeout 30 git status",
  ];
  for (const cmd of NOT_A_COMMAND) {
    it(cmd, () => {
      expect(forms(cmd)).not.toContain("git push --force");
    });
  }

  it("只读 git 只产它自己那一形（多余候选=审批卡变多的那条路）", () => {
    expect(forms("git status")).toEqual(["git status"]);
    expect(forms("sudo -u root git status")).toEqual(["sudo -u root git status", "git status"]);
  });

  it("选项值不冒充二进制：root / 30 / -n 都不在 bin 位", () => {
    const bins = invocations("nice -n 5 sudo -u root timeout 30 git push --force").map((i) => i.bin);
    expect(bins).toContain("git");
    expect(bins).not.toContain("root");
    expect(bins).not.toContain("5");
    expect(bins).not.toContain("30");
    expect(invocations("nice -n 5 sudo -u root timeout 30 git push --force"))
      .toContainEqual({ bin: "git", args: ["push", "--force"] });
  });

  it("载荷递归有上限，且越界时是「少跳一层」而不是崩", () => {
    const deep = `bash -c 'bash -c 'bash -c 'bash -c 'bash -c "git push --force"''''`;
    expect(() => forms(deep)).not.toThrow();
    expect(invocations(deep).every((i) => i.bin !== "")).toBe(true);
  });

  it("空段与只有包装器的段：不产空形态、不抛", () => {
    expect(commandForms("")).toEqual([""]);
    // 段里除包装器没别的可跑 ⇒ 原形仍在候选内（bin 就是 nohup 自己），但绝不产空 bin
    expect(invocations("nohup")).toEqual([{ bin: "nohup", args: [] }]);
    expect(invocations("env FOO=1")).toEqual([{ bin: "env", args: ["FOO=1"] }]);
    expect(invocations("nohup git push --force").map((i) => i.bin)).toEqual(["nohup", "git"]);
    expect(invocations("").length).toBe(0);
  });
});

describe("分词：引号与转义按 shell 语义", () => {
  it("单引号逐字、双引号放行转义、裸反斜杠并入", () => {
    expect(tokenize("echo 'a b'")).toEqual(["echo", "a b"]);
    expect(tokenize('echo "a \\"b\\" c"')).toEqual(["echo", 'a "b" c']);
    expect(tokenize("echo a\\ b")).toEqual(["echo", "a b"]);
    expect(tokenize("bash -c 'git status; git push --force'")).toEqual(["bash", "-c", "git status; git push --force"]);
  });

  it("载荷里引号内的分隔符不切段", () => {
    expect(forms(`bash -c 'echo "a;b"; git push --force'`)).toContain("git push --force");
    expect(forms("git push")).not.toContain("push --force");
  });
});

/* ---------------- 下游选项族（09-22 补） ----------------
   ① 那族包装器在二进制**上游**，`invocations` 会剥；这一族的全局选项在二进制与子命令**之间**，
   前缀匹配看不见子命令。探针 ⑤ 段实测五支全漏（`git -C /tmp push --force` ⇒ approve@L4-pass）。 */
describe("下游选项：二进制与子命令之间的全局选项不得把 deny 瞎掉", () => {
  it("五类写法都产得出「git push --force」那一形", () => {
    for (const seg of [
      "git -C /tmp push --force",
      "git --no-pager push --force",
      "git -c advice.pushUpdateRejected=false push --force",
      "git --git-dir=/x push --force",
      "git -C/x push --force",
    ]) {
      expect(forms(seg), seg).toContain("git push --force");
    }
  });

  it("包装器 + 下游选项同时出现也要命中（两族叠加）", () => {
    expect(forms("sudo -u root git -C /tmp push --force")).toContain("git push --force");
  });

  it("负控：后缀只从**非选项**参数起，选项本身不冒充子命令", () => {
    expect(forms("git -C /tmp push --force")).not.toContain("git --force");
    expect(forms("git --no-pager push --force")).not.toContain("git push"); // 截半截不算一条形
  });

  it("负控：包装器那一支不产假形（多余候选 = 审批卡变多，方向与「静默漏过」相反也要守住）", () => {
    const f = forms("sudo -u root git status");
    expect(f).not.toContain("sudo git status");
    expect(f).not.toContain("sudo root git status");
    expect(f).toContain("git status");
  });
});
