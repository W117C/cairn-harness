import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ALWAYS_RULES_FILE, alwaysRulesPath, loadWorkspacePermissionRules, savePermissionRules } from "../src/permissions/rules";
import { judgeChain, type PermissionRule } from "../src/permissions";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const grant: PermissionRule = { behavior: "allow", tool: "write_file", scope: "always" };
const restrict: PermissionRule = { behavior: "deny", tool: "edit_file", scope: "always" };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "perm-always-"));
  dirs.push(dir);
  const workspace = join(dir, "workspace");
  const appData = join(dir, "appdata");
  const project = join(workspace, ".agent", "permissions.json");
  await mkdir(dirname(project), { recursive: true });
  return { dir, workspace, appData, project };
}

describe("用户的持久授权", () => {
  it("旧的项目授权文件仍由 .gitignore 排除", async () => {
    expect(await readFile(join(process.cwd(), ".gitignore"), "utf8")).toContain(".agent/" + ALWAYS_RULES_FILE);
  });

  it("项目策略保留限制；本机授权才会放行，且不同工作区不会共享", async () => {
    const { dir, workspace, appData, project } = await setup();
    await savePermissionRules(project, [restrict]);
    await savePermissionRules(alwaysRulesPath(workspace, appData), [grant]);
    const rules = loadWorkspacePermissionRules(workspace, appData);
    expect(rules.map(({ behavior, tool, layer }) => [behavior, tool, layer])).toEqual([
      ["deny", "edit_file", "project"],
      ["allow", "write_file", "local"],
    ]);
    expect(judgeChain(rules, "write_file").verdict).toBe("allow");
    const another = join(dir, "another");
    await mkdir(another);
    expect(loadWorkspacePermissionRules(another, appData)).toEqual([]);
  });

  it("同一路径被新目录替换时不会继承旧授权", async () => {
    const { dir, workspace, appData } = await setup();
    await savePermissionRules(alwaysRulesPath(workspace, appData), [grant]);
    await rename(workspace, join(dir, "retired-workspace"));
    await mkdir(workspace);
    expect(loadWorkspacePermissionRules(workspace, appData)).toEqual([]);
  });

  it("旧授权文件不导入，项目规则的 allow 也不给审批豁免", async () => {
    const { workspace, appData, project } = await setup();
    await savePermissionRules(project, [restrict, grant]);
    await savePermissionRules(join(dirname(project), ALWAYS_RULES_FILE), [grant]);
    const rules = loadWorkspacePermissionRules(workspace, appData);
    expect(judgeChain(rules, "write_file").verdict).toBe("miss");
    expect(judgeChain(rules, "edit_file").verdict).toBe("deny");
    expect(rules.every((r) => r.layer === "project")).toBe(true);
  });

  it("本机授权库损坏时明确拒载", async () => {
    const { workspace, appData } = await setup();
    const path = alwaysRulesPath(workspace, appData);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ invalid JSON");
    expect(() => loadWorkspacePermissionRules(workspace, appData)).toThrow(/权限库解析失败/);
  });

  it("工作区内的应用数据不能授予权限，已有的拒绝仍生效", async () => {
    const { workspace } = await setup();
    const appData = join(workspace, "appdata");
    await savePermissionRules(join(appData, "permissions.json"), [grant, restrict]);
    const rules = loadWorkspacePermissionRules(workspace, appData);
    expect(judgeChain(rules, "write_file").verdict).toBe("miss");
    expect(judgeChain(rules, "edit_file").verdict).toBe("deny");
    expect(() => alwaysRulesPath(workspace, appData)).toThrow(/工作区之外/);
  });
});
