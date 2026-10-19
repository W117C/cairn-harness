// 模板初始化的判卷：模板必须产出**能运行**的项目，失败必须可重试且不留半个目录。
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROJECT_MANIFEST_REL,
  PROJECT_TEMPLATES,
  createProjectFromTemplate,
  diagnoseProjectDirectory,
  findTemplate,
  readProjectManifest,
  templateCatalog,
} from "../src/main/project-templates";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "cairn-tpl-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("模板目录（三条零依赖 + 一条 React/Vite）", () => {
  it("id 唯一、目录清单不带源码、运行形态只允许 static/vite", () => {
    const ids = PROJECT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("static-site");
    expect(ids).toContain("react-vite");
    for (const item of templateCatalog()) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(["static", "vite"]).toContain(item.runKind);
      expect("files" in item).toBe(false);
    }
  });

  it("三个静态模板各自都有 index.html，且零依赖（不引用 node_modules）", () => {
    const statics = PROJECT_TEMPLATES.filter((t) => t.runKind === "static");
    expect(statics).toHaveLength(3);
    for (const t of statics) {
      expect(t.files["index.html"], t.id).toBeTruthy();
      const all = Object.values(t.files).join("\n");
      expect(all.includes("node_modules"), t.id).toBe(false);
    }
  });
});

describe("createProjectFromTemplate：产出可运行项目，失败可重试", () => {
  it("静态模板：写出模板文件 + .cairn/project.json（run.kind=static）", () => {
    const parent = tmp();
    const r = createProjectFromTemplate({ name: "coffee", parentDir: parent, templateId: "static-site" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(existsSync(join(r.path, "index.html"))).toBe(true);
    expect(existsSync(join(r.path, "styles.css"))).toBe(true);
    const manifest = readProjectManifest(r.path);
    expect(manifest).toEqual({ cairnProject: 1, templateId: "static-site", run: { kind: "static" } });
  });

  it("React 模板：清单标 vite，且 package.json 是合法 JSON（版本写死）", () => {
    const parent = tmp();
    const r = createProjectFromTemplate({ name: "todoapp", parentDir: parent, templateId: "react-vite" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pkg = JSON.parse(readFileSync(join(r.path, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.react).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readProjectManifest(r.path)?.run.kind).toBe("vite");
  });

  it("未知模板 / 非法名 / 已存在目录：明确拒收，且不写盘", () => {
    const parent = tmp();
    const bad = createProjectFromTemplate({ name: "x", parentDir: parent, templateId: "nope" });
    expect(bad).toMatchObject({ ok: false, reason: "unknown-template" });
    const badName = createProjectFromTemplate({ name: "a/b", parentDir: parent, templateId: "static-site" });
    expect(badName.ok).toBe(false);
    const first = createProjectFromTemplate({ name: "dup", parentDir: parent, templateId: "static-site" });
    expect(first.ok).toBe(true);
    const second = createProjectFromTemplate({ name: "dup", parentDir: parent, templateId: "static-site" });
    expect(second).toMatchObject({ ok: false, reason: "exists" });
    // 已存在那次不许动原目录
    expect(existsSync(join(parent, "dup", "index.html"))).toBe(true);
  });

  it("写盘中途失败：回滚自己建的目录（父目录只读 ⇒ mkdir 失败）", () => {
    if (process.getuid !== undefined && process.getuid() === 0) return; // root 下权限闸失效，跳过
    const parent = tmp();
    chmodSync(parent, 0o500);
    try {
      const r = createProjectFromTemplate({ name: "nope", parentDir: parent, templateId: "static-site" });
      expect(r).toMatchObject({ ok: false, reason: "write-failed" });
      expect(existsSync(join(parent, "nope"))).toBe(false);
    } finally {
      chmodSync(parent, 0o700);
    }
  });

  it("findTemplate 与 readProjectManifest 对损坏清单 fail-visible（null，不抛）", () => {
    expect(findTemplate("static-site")?.runKind).toBe("static");
    expect(findTemplate("nope")).toBeUndefined();
    const parent = tmp();
    const r = createProjectFromTemplate({ name: "broken", parentDir: parent, templateId: "static-site" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    writeFileSync(join(r.path, PROJECT_MANIFEST_REL), "{ not json", "utf8");
    expect(readProjectManifest(r.path)).toBeNull();
    writeFileSync(join(r.path, PROJECT_MANIFEST_REL), JSON.stringify({ run: { kind: "shell" } }), "utf8");
    expect(readProjectManifest(r.path)).toBeNull();
  });
});

describe("已有项目导入诊断：支持 / 需要补充信息 / 当前暂不可纳入", () => {
  /** 造一个 package.json（只关心依赖/脚本这两栏）。 */
  function writePkg(dir: string, pkg: Record<string, unknown>): void {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
  }

  it("有清单的项目 ⇒ supported(template)，形态随清单", () => {
    const parent = tmp();
    const r = createProjectFromTemplate({ name: "tpl", parentDir: parent, templateId: "react-vite" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = diagnoseProjectDirectory(r.path);
    expect(d).toMatchObject({ verdict: "supported", runKind: "vite", form: "template" });
  });

  it("零依赖静态目录（index.html）⇒ supported(static-html)；诊断纯读，不写用户目录", () => {
    const dir = tmp();
    writeFileSync(join(dir, "index.html"), "<h1>hi</h1>", "utf8");
    writeFileSync(join(dir, "styles.css"), "h1{}", "utf8");
    const d = diagnoseProjectDirectory(dir);
    expect(d).toMatchObject({ verdict: "supported", runKind: "static", form: "static-html" });
    expect(d.summary).toContain("index.html");
    expect(d.reasons.some((r) => r.includes("index.html"))).toBe(true);
    expect(existsSync(join(dir, ".cairn"))).toBe(false);
  });

  it("index.htm 也算入口；同级还有别的网页时在依据里点名", () => {
    const dir = tmp();
    writeFileSync(join(dir, "index.htm"), "<h1>hi</h1>", "utf8");
    writeFileSync(join(dir, "about.html"), "<h1>about</h1>", "utf8");
    const d = diagnoseProjectDirectory(dir);
    expect(d).toMatchObject({ verdict: "supported", runKind: "static", form: "static-html" });
    expect(d.reasons.some((r) => r.includes("另有 1 个同级网页"))).toBe(true);
  });

  it("受控 Vite（带 react）⇒ supported(react-vite)；不带 react 的 Vite 也放行（vite）", () => {
    const a = tmp();
    writeFileSync(join(a, "index.html"), "<div id=root></div>", "utf8");
    writePkg(a, { dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", vite: "^7.0.0" } });
    expect(diagnoseProjectDirectory(a)).toMatchObject({ verdict: "supported", runKind: "vite", form: "react-vite" });
    const b = tmp();
    writeFileSync(join(b, "index.html"), "<div id=app></div>", "utf8");
    writePkg(b, { devDependencies: { vite: "^7.0.0" } });
    expect(diagnoseProjectDirectory(b)).toMatchObject({ verdict: "supported", runKind: "vite", form: "vite" });
  });

  it("坏清单 / 坏 package.json ⇒ needs-info（差的是能修的信息，不是形态）", () => {
    const a = tmp();
    mkdirSync(join(a, ".cairn"), { recursive: true });
    writeFileSync(join(a, PROJECT_MANIFEST_REL), "{ not json", "utf8");
    const d1 = diagnoseProjectDirectory(a);
    expect(d1.verdict).toBe("needs-info");
    expect(d1.summary).toContain("清单");
    expect(d1.hint).toBeTruthy();
    const b = tmp();
    writeFileSync(join(b, "index.html"), "<h1>x</h1>", "utf8");
    writeFileSync(join(b, "package.json"), "{ not json", "utf8");
    const d2 = diagnoseProjectDirectory(b);
    expect(d2.verdict).toBe("needs-info");
    expect(d2.summary).toContain("package.json");
  });

  it("服务端 / 容器工程 ⇒ unsupported，并点名卡住的那份文件", () => {
    const a = tmp();
    writeFileSync(join(a, "manage.py"), "print(1)", "utf8");
    const d1 = diagnoseProjectDirectory(a);
    expect(d1.verdict).toBe("unsupported");
    expect(d1.summary).toContain("manage.py");
    const b = tmp();
    writeFileSync(join(b, "Dockerfile"), "FROM node", "utf8");
    expect(diagnoseProjectDirectory(b).summary).toContain("Dockerfile");
    const c = tmp();
    writeFileSync(join(c, "index.php"), "<?php echo 1;", "utf8");
    expect(diagnoseProjectDirectory(c).summary).toContain("index.php");
    // 名字里带 .php 的目录不算（只认常规文件），命中的文件名也不随盘上顺序漂（按名字排序取第一个）。
    const d = tmp();
    mkdirSync(join(d, "vendor.php"), { recursive: true });
    writeFileSync(join(d, "index.html"), "<h1>x</h1>", "utf8");
    expect(diagnoseProjectDirectory(d).verdict).toBe("supported");
    const e = tmp();
    writeFileSync(join(e, "b.php"), "<?php echo 2;", "utf8");
    writeFileSync(join(e, "a.php"), "<?php echo 3;", "utf8");
    expect(diagnoseProjectDirectory(e).summary).toContain("a.php");
  });

  it("依赖里带非受控框架 ⇒ unsupported，并点名依赖名", () => {
    const a = tmp();
    writeFileSync(join(a, "index.html"), "<h1>x</h1>", "utf8");
    writePkg(a, { dependencies: { next: "^15.0.0" } });
    const d1 = diagnoseProjectDirectory(a);
    expect(d1.verdict).toBe("unsupported");
    expect(d1.summary).toContain("next");
    const b = tmp();
    writePkg(b, { devDependencies: { webpack: "^5.0.0" } });
    const d2 = diagnoseProjectDirectory(b);
    expect(d2.verdict).toBe("unsupported");
    expect(d2.summary).toContain("webpack");
  });

  it("vite 项目的生命周期脚本与配置文件里的系统命令 ⇒ unsupported", () => {
    const a = tmp();
    writeFileSync(join(a, "index.html"), "<div id=root></div>", "utf8");
    writePkg(a, { scripts: { postinstall: "node setup.mjs" }, devDependencies: { vite: "^7.0.0" } });
    const d1 = diagnoseProjectDirectory(a);
    expect(d1.verdict).toBe("unsupported");
    expect(d1.summary).toContain("postinstall");
    const b = tmp();
    writeFileSync(join(b, "index.html"), "<div id=root></div>", "utf8");
    writePkg(b, { devDependencies: { vite: "^7.0.0" } });
    writeFileSync(join(b, "vite.config.ts"), 'import { execSync } from "node:child_process";\nexport default {};\n', "utf8");
    const d2 = diagnoseProjectDirectory(b);
    expect(d2.verdict).toBe("unsupported");
    expect(d2.summary).toContain("child_process");
    expect(d2.reasons.some((r) => r.includes("vite.config.ts"))).toBe(true);
  });

  it("npm 锁文件 / 缺 index.html 的 vite 项目 ⇒ needs-info", () => {
    const a = tmp();
    writeFileSync(join(a, "index.html"), "<div id=root></div>", "utf8");
    writePkg(a, { devDependencies: { vite: "^7.0.0" } });
    writeFileSync(join(a, "package-lock.json"), "{}", "utf8");
    const d1 = diagnoseProjectDirectory(a);
    expect(d1.verdict).toBe("needs-info");
    expect(d1.summary).toContain("package-lock.json");
    const b = tmp();
    writePkg(b, { devDependencies: { vite: "^7.0.0" } });
    const d2 = diagnoseProjectDirectory(b);
    expect(d2.verdict).toBe("needs-info");
    expect(d2.summary).toContain("index.html");
  });

  it("只有别的 .html（没有 index）⇒ needs-info；空目录与不存在的路径 ⇒ unsupported", () => {
    const a = tmp();
    writeFileSync(join(a, "home.html"), "<h1>home</h1>", "utf8");
    const d1 = diagnoseProjectDirectory(a);
    expect(d1.verdict).toBe("needs-info");
    expect(d1.reasons.some((r) => r.includes("home.html"))).toBe(true);
    expect(d1.hint).toContain("index.html");
    const b = tmp();
    const d2 = diagnoseProjectDirectory(b);
    expect(d2.verdict).toBe("unsupported");
    expect(d2.hint).toBeTruthy();
    const d3 = diagnoseProjectDirectory(join(b, "no-such-dir"));
    expect(d3.verdict).toBe("unsupported");
    expect(d3.summary).toContain("找不到这个目录");
  });
});
