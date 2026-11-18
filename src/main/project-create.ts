// 「新建项目」：按项目名建一个同名文件夹，再把它登记成工作区。
//
// 为什么需要它：用户实测反馈 ③ 的原话是「打开项目桌面端时，回自己创建一个项目名字的文件夹」——
// 也就是**先有文件夹，再进项目**。原先的开机路径是一屏向导（选一个**已存在的**目录），
// 既不能建、也拦在门口；现在向导删了，改由这个服务在用户要的时候建。
//
// 放在 src/main（不碰 Electron）：目录创建 + 名字校验都是纯 IO，能在 vitest 里直接判卷。
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { projectNameProblem } from "./project-name";

export interface CreateProjectInput {
  name: string;
  /** 父目录；缺省用 defaultProjectsRoot()。 */
  parentDir?: string;
}

export type CreateProjectFailure =
  | "empty-name"
  | "bad-name"
  | "too-long"
  | "bad-parent"
  | "exists"
  | "mkdir-failed";

export type CreateProjectResult =
  | { ok: true; name: string; path: string; parentDir: string }
  | { ok: false; reason: CreateProjectFailure; message: string };

/** 缺省落点：`~/CairnProjects`。给一个确定的默认值（用户可以改），而不是让他先想清楚放哪。 */
export function defaultProjectsRoot(home: string = homedir()): string {
  return join(home, "CairnProjects");
}

/** 项目名 = 文件夹名。判据按**文件夹名**的规矩来，不是按"好看的标题"来。
 *  规矩本体在 `project-name.ts`（渲染层同一份，见那里的注释）；这里只负责把档位说成人话。 */
export function validateProjectName(raw: string): { ok: true; name: string } | Extract<CreateProjectResult, { ok: false }> {
  const name = raw.trim();
  const problem = projectNameProblem(raw);
  if (problem === null) return { ok: true, name };
  switch (problem.reason) {
    case "empty":
      return { ok: false, reason: "empty-name", message: "项目名不能为空" };
    case "too-long":
      return { ok: false, reason: "too-long", message: `项目名太长（${String(problem.length)} > ${String(problem.max)} 字符）` };
    case "bad-char":
      return { ok: false, reason: "bad-name", message: "项目名不能包含 / \\ : * ? \" < > | 这些字符（它是文件夹名）" };
    case "leading-dot":
      return { ok: false, reason: "bad-name", message: "项目名不能以点开头（会被当成隐藏目录）" };
    case "trailing-dot":
      return { ok: false, reason: "bad-name", message: "项目名不能以点结尾（部分平台会把它丢掉）" };
  }
}

/** 建文件夹。**不登记**（登记走 ProjectRegistry.add，由调用方决定顺序与错误面）。 */
export function createProjectFolder(input: CreateProjectInput, home: string = homedir()): CreateProjectResult {
  const checked = validateProjectName(input.name);
  if (!checked.ok) return checked;
  const parentDir = resolve(input.parentDir ?? defaultProjectsRoot(home));
  if (!isAbsolute(parentDir)) {
    return { ok: false, reason: "bad-parent", message: `父目录必须是绝对路径：${parentDir}` };
  }
  if (existsSync(parentDir) && !statSync(parentDir).isDirectory()) {
    return { ok: false, reason: "bad-parent", message: `父目录不是一个目录：${parentDir}` };
  }
  const path = join(parentDir, checked.name);
  if (existsSync(path)) {
    // 故意不静默复用：用户点的是「新建」，拿一个已有目录回车等于没说清。
    // 但把出路告诉他（要么换名字，要么用「添加已有目录」）。
    return { ok: false, reason: "exists", message: `文件夹已存在：${path}——换个名字，或用「添加已有文件夹」把它加进来` };
  }
  try {
    mkdirSync(parentDir, { recursive: true });
    mkdirSync(path);
  } catch (err) {
    return { ok: false, reason: "mkdir-failed", message: `建文件夹失败：${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, name: checked.name, path, parentDir };
}
