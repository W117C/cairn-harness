// 「新建项目」的判卷（用户实测反馈 ③：打开桌面端应先能建一个以项目名命名的文件夹，再进项目）。
// 名字校验按**文件夹名**的规矩来 —— 它最终真的会变成磁盘上的一个目录，所以每一条拒收
// 都对应一个"建出来会出问题"的真实情况（跨平台非法字符、隐藏目录、尾随点/空格）。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectFolder, defaultProjectsRoot, validateProjectName } from "../src/main/project-create";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "cairn-proj-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("项目名 = 文件夹名：拒收的每一条都对应真实的建目录事故", () => {
  it("正常名字：去空白后放行", () => {
    expect(validateProjectName("  my-app  ")).toEqual({ ok: true, name: "my-app" });
    expect(validateProjectName("中文项目名")).toEqual({ ok: true, name: "中文项目名" });
  });

  it("空名 / 纯空白 拒", () => {
    expect(validateProjectName("").ok).toBe(false);
    expect(validateProjectName("   ").ok).toBe(false);
  });

  it("路径分隔符与跨平台非法字符拒（否则会建到别的目录去）", () => {
    for (const bad of ["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b"]) {
      expect(validateProjectName(bad).ok, bad).toBe(false);
    }
  });

  it("隐藏目录与尾随点拒；尾随空格被 trim 掉后接受（粘贴常带的空格不该变成错误）", () => {
    expect(validateProjectName(".git").ok).toBe(false);
    expect(validateProjectName("..").ok).toBe(false);
    expect(validateProjectName("name.").ok).toBe(false);
    expect(validateProjectName("name ")).toEqual({ ok: true, name: "name" });
  });

  it("超长拒（并有具体长度）", () => {
    const r = validateProjectName("x".repeat(65));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("65");
  });
});

describe("建文件夹", () => {
  it("在父目录下建出同名文件夹", () => {
    const parent = tmp();
    const r = createProjectFolder({ name: "demo-project", parentDir: parent });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path).toBe(join(parent, "demo-project"));
    expect(existsSync(r.path)).toBe(true);
    expect(readdirSync(parent)).toEqual(["demo-project"]);
  });

  it("父目录不存在 ⇒ 连带建出来（recursive）", () => {
    const parent = tmp();
    const deep = join(parent, "a", "b");
    const r = createProjectFolder({ name: "proj", parentDir: deep });
    expect(r.ok).toBe(true);
    if (r.ok) expect(existsSync(r.path)).toBe(true);
  });

  it("已存在 ⇒ 拒，并把出路写在消息里（不静默复用）", () => {
    const parent = tmp();
    mkdirSync(join(parent, "taken"));
    writeFileSync(join(parent, "taken", "keep.txt"), "x");
    const r = createProjectFolder({ name: "taken", parentDir: parent });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("exists");
      expect(r.message).toContain("添加已有文件夹");
    }
    // 已有内容一个字没动
    expect(readdirSync(join(parent, "taken"))).toEqual(["keep.txt"]);
  });

  it("父路径是个文件 ⇒ 拒（报错而不是拿文件当目录）", () => {
    const parent = tmp();
    const file = join(parent, "afile");
    writeFileSync(file, "x");
    const r = createProjectFolder({ name: "proj", parentDir: file });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad-parent");
  });

  it("名字非法 ⇒ 早拒，一个目录都不建", () => {
    const parent = tmp();
    const r = createProjectFolder({ name: "bad/name", parentDir: parent });
    expect(r.ok).toBe(false);
    expect(readdirSync(parent)).toEqual([]);
  });

  it("缺省落点是 ~/CairnProjects（可被 parentDir 覆盖）", () => {
    expect(defaultProjectsRoot("/home/someone")).toBe("/home/someone/CairnProjects");
    const home = tmp();
    const r = createProjectFolder({ name: "proj" }, home);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parentDir).toBe(join(home, "CairnProjects"));
      expect(r.path).toBe(join(home, "CairnProjects", "proj"));
    }
  });
});
