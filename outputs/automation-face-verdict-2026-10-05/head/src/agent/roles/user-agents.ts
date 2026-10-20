/** 用户级自定义子智能体角色（**非插件**路径）。
 *
 *  为什么要有这一支：插件容器里的 `agents/*.md` 早就接通（装载 → 注册 → spawn 收 role → 落流 → 发现面），
 *  但实测「用户往 `~/.claude/agents/x.md` 放一个文件得不到任何东西」——自定义角色只能靠装插件获得，
 *  而用户级插件目录还要 `M2E_USER_PLUGINS` 才生效。目标里「用户自定义子智能体」这一条因此名不副实：
 *  要么给正式路径，要么把"角色 = 插件专属"写死成边界。这里选**给路径**，同时把另一半边界写明：
 *
 *  - **只做用户级目录，不做项目级 `.agent/agents/`**：项目目录会随仓库带来，
 *    一份 `agents/x.md` 就能决定 worker 的工具面与提示词 ⇒ 它需要一次信任设计（与散装 skill 同一类问题），
 *    没设计之前不开这个口（边界与理由见 outputs/user-subagent-path-2026-09-24 第 39 页 §四）。
 *    用户自己的 home 目录没有这个问题（放文件的人就是授权的人）。
 *  - 读失败/空文件/软链/同名覆盖**一律出声**：装载期静默丢条目，正是本仓反复点名的
 *    「装载收下、执行端不读」的镜像——这里连"收下"都没有，而报出来的错和配置毫无关系。
 *  - 形状与插件角色完全一致（`{name, body, frontmatter}`），于是消费端**不另起一路**：
 *    编排器仍走同一份 `resolvePluginRole`，两处口径必漂的老毛病从这里就被挡掉。
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fmString, parseFrontmatter } from "../plugins/frontmatter";

export interface UserAgentSource {
  /** 相对 home 的目录（`join` 过的，测试里可直接比）。 */
  rel: string;
  /** 小的先赢：同名角色归优先级高的来源，另一条只留警告。 */
  priority: number;
  /** 这个来源是谁（进警告文案，让人知道去哪儿改）。 */
  label: string;
}

export const USER_AGENT_SOURCES: readonly UserAgentSource[] = [
  { rel: join(".dsh", "agents"), priority: 0, label: "DSH 用户级目录" },
  { rel: join(".claude", "agents"), priority: 1, label: "Claude Code 兼容目录" },
];

/** invoke 前缀：与插件的 `plugin-name:agent-name` 同形但不同命名空间，
 *  于是同一份 `stages[].role` / `spawn_agent(role=…)` 通道不用改协议就能分辨来源。 */
export const USER_AGENT_INVOKE_PREFIX = "user:";

export interface UserAgentRole {
  name: string;
  description: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface UserAgentLoad {
  roles: UserAgentRole[];
  warnings: string[];
}

async function readOneDir(dir: UserAgentSource, home: string): Promise<{ entries: UserAgentRole[]; warnings: string[] }> {
  const abs = join(home, dir.rel);
  const warnings: string[] = [];
  const entries: UserAgentRole[] = [];
  let dirents;
  try {
    dirents = await readdir(abs, { withFileTypes: true });
  } catch {
    return { entries, warnings }; // 目录不存在 = 常态（用户没放东西），不报警
  }
  for (const e of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.name.endsWith(".md")) continue;
    if (e.isSymbolicLink()) {
      warnings.push(`用户级 agent ${dir.rel}/${e.name} 是符号链接，已跳过（不跟随目录外的目标；要放就别用软链）`);
      continue;
    }
    if (!e.isFile()) {
      warnings.push(`用户级 agent ${dir.rel}/${e.name} 不是普通文件（目录/设备），已跳过`);
      continue;
    }
    const path = join(abs, e.name);
    const text = await readFile(path, "utf8").catch((err: unknown) => {
      warnings.push(`用户级 agent ${dir.rel}/${e.name} 读不出来（${String((err as Error).message)}），已跳过`);
      return "";
    });
    if (text.trim().length === 0) {
      warnings.push(`用户级 agent ${dir.rel}/${e.name} 内容为空 ⇒ 没有 roleDefinition，已跳过`);
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(text);
    entries.push({
      name: fmString(frontmatter, "name") ?? e.name.slice(0, -3),
      description: fmString(frontmatter, "description") ?? "",
      path,
      frontmatter,
      body,
    });
  }
  return { entries, warnings };
}

/** 读全部用户级来源。`home` 可注入（测试与非桌面运行环境用），缺省 = `homedir()`。 */
export async function loadUserAgentRoles(opts: { home?: string } = {}): Promise<UserAgentLoad> {
  const home = opts.home ?? homedir();
  const roles: UserAgentRole[] = [];
  const warnings: string[] = [];
  const byName = new Map<string, UserAgentRole>();
  for (const dir of [...USER_AGENT_SOURCES].sort((a, b) => a.priority - b.priority)) {
    const one = await readOneDir(dir, home);
    warnings.push(...one.warnings);
    for (const r of one.entries) {
      const hit = byName.get(r.name);
      if (hit !== undefined) {
        warnings.push(`用户级 agent 角色「${r.name}」重名：保留 ${hit.path}（优先级更高的来源），` +
          `${r.path} 被忽略 ⇒ 改个名字或用同一个文件`);
        continue;
      }
      byName.set(r.name, r);
      roles.push(r);
    }
  }
  return { roles: roles.sort((a, b) => a.name.localeCompare(b.name)), warnings };
}

export function userAgentInvoke(name: string): string {
  return USER_AGENT_INVOKE_PREFIX + name;
}
