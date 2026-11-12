// 工具名的中文动词层（第 918 页从 `components/Stream.tsx` 搬到派生层）：
// 它有两个消费面——对话流的工具行（`Stream`）与时间线的步骤标签（`derived/timeline`）。
// 词表留在组件里时，时间线只能退回复制一份或直接写实现名（改前就是后者：`read_file a.ts`）；
// 派生层不依赖组件层，两边都能读它，这才是「一个词表」的落点。
/** 工具行一句话摘要的动词层（阶段 2 · brief §二.4 例：「抓取 api-docs.deepseek.com/news」）。
 *  已知工具给中文动词；未知工具 null——宁缺不编（渲染层回落「· 摘要」形态）。 */
export const TOOL_VERBS: Readonly<Record<string, string>> = {
  read_file: "读取",
  write_file: "写入",
  edit_file: "编辑",
  apply_patch: "打补丁",
  run_shell: "运行",
  // 静态工具面（`TOOL_NAMES`）里剩下的七把（第 916 页）：它们此前没有动词，渲染层按「未知工具」
  // 处理 ⇒ 折叠行把 `grep` / `glob` / `lsp` / `clarify` / `propose_plan` / `render_image` 这些
  // 实现名原样摆上屏，与「不暴露实现名」相反。`list_dir` 是从前的工具，现已不存在（glob 取代），
  // 留着这条 = 词表比工具面多一格，判据看不出来。
  // 2026-11-05 后台任务三件套：读后台任务的输出 / 停止后台任务。
  task_output: "读任务输出",
  task_stop: "停任务",
  // 2026-11-06 只读 git 三合一：看状态 / 看 diff / 看提交历史。
  git_read: "看仓库",
  // 2026-11-06 第三批小件：确定性算术 / 目录总览；文档读取。
  calc: "计算",
  list_dir: "看目录",
  read_doc: "读文档",
  // 2026-11-10 网络文档抓取 / 文件生命周期四动作。
  web_doc: "取文档",
  fs_ops: "整理文件",
  // 2026-11-06 浏览器驾驶三件：开页 / 读页 / 选元素（驾驶的是用户看得见的侧栏浏览器）。
  browser_navigate: "开网页",
  browser_snapshot: "读网页",
  browser_pick: "选元素",
  grep: "查找",
  glob: "找文件",
  lsp: "查符号",
  clarify: "提问",
  propose_plan: "提方案",
  render_image: "出图",
  verify: "验证",
  web_fetch: "抓取",
  web_search: "搜索",
  spawn_agent: "派发子任务",
  // 子任务生命周期（第 917 页）：这几个工具的参数里没有 command/path 一类字段，摘要走 ownSubject
  // （task/message/agent_ids/thread_id）。没有动词的话，行首仍会把 `wait_for_agents` 这类实现名摆上屏。
  send_agent: "发消息",
  wait_for_agents: "等待",
  cancel_agents: "撤销",
  list_agents: "列出",
  resume_agent: "恢复",
  close_agent: "关闭",
  // 记忆与定时任务（第 923 页）：参数里没有 command/path，摘要走 ownSubject（content/topic、name/id）；
  // 没有动词的话行首还是 `remember` / `automation_create` 这类实现名。
  remember: "记住",
  automation_create: "建定时任务",
  automation_update: "改定时任务",
  automation_delete: "删定时任务",
  automation_run_now: "跑定时任务",
  automation_list: "列定时任务",
  // 技能 / 目标 / MCP 元工具（第 925 页）：同样没有 command/path，摘要走 ownSubject。
  skill: "用技能",
  refine_goal: "改目标",
  mcp_list: "列 MCP",
  mcp_activate: "启用 MCP",
  mcp_release: "停用 MCP",
  // 采集/检索/诊断四把（第 927 页）：摘要分别走 ownSubject（id / symbol / face）或通用链（query）。
  tool_search: "找工具",
  search_history: "搜历史",
  impact_query: "查波及面",
  obs_recall: "回看",
  diagnose: "诊断",
  read_image: "读图",
  // 任务清单（2026-11-04 工作状态面板「进程」的数据源）：摘要走 ownSubject（items 无 command/path）。
  todo_write: "记清单",
};
export function toolVerb(tool: string): string | null {
  return TOOL_VERBS[tool] ?? null;
}
