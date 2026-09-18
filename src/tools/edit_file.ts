import { readFile, writeFile } from "node:fs/promises";
import { appendImpact, assertNotAgentArea, assertNotAgentAreaReal, assertRealContainment, resolveInWorkspace, ToolError, type Tool, type ToolResult } from "./base.js";
import { collectDiagnostics } from "./lsp.js";

export const edit_file: Tool = {
  name: "edit_file",
  async run(args, ctx): Promise<ToolResult> {
    const rel = typeof args.path === "string" ? args.path : "";
    const oldString = args.old_string;
    const newString = args.new_string;
    if (typeof oldString !== "string" || oldString.length === 0) {
      throw new ToolError("edit_file: old_string 必须是非空字符串");
    }
    if (typeof newString !== "string") {
      throw new ToolError("edit_file: new_string 必须是字符串");
    }
    const replaceAll = args.replace_all === true;
    const abs = resolveInWorkspace(ctx.workspace, rel, "edit_file");
    assertNotAgentArea(rel, "edit_file");
    await assertRealContainment(ctx.workspace, abs, "edit_file");
    await assertNotAgentAreaReal(ctx.workspace, abs, "edit_file"); // C3：软链落点复查
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      throw new ToolError("edit_file: 文件不存在或不可读: " + rel);
    }
    // 唯一匹配纪律：非唯一且未显式 replace_all 一律拒绝并回报匹配数。
    let count = 0;
    let idx = content.indexOf(oldString);
    while (idx !== -1) {
      count++;
      idx = content.indexOf(oldString, idx + 1);
    }
    if (count === 0) {
      throw new ToolError("edit_file: old_string 在文件中 0 处匹配，未做任何修改: " + rel);
    }
    if (count > 1 && !replaceAll) {
      throw new ToolError("edit_file: old_string 匹配 " + count + " 处（要求唯一）。若确要全部替换，加 replace_all: true: " + rel);
    }
    // 替换一律用「字面量」语义：replace_all 走 split/join；单次替换用回调形式。
    // 若直接写 content.replace(old, new)，new_string 里的 $& / $1 / $` / $' 会被当成
    // 替换模式解释（把匹配到的原文插回去），静默写出错误内容——两个分支必须同口径。
    const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, () => newString);
    await writeFile(abs, updated, "utf8");
    const replacements = replaceAll ? count : 1;
    // M2a 诊断回流：成功写盘后等诊断（LSP 未配置 = 空串，输出不变）
    const diag = await collectDiagnostics(ctx.workspace, abs);
    // M7 影响面：替换成功后回注跨文件波及（best-effort，见 appendImpact）。
    const output = await appendImpact(ctx, rel, "已替换 " + rel + "（" + replacements + " 处）" + diag);
    return { ok: true, output };
  },
};
