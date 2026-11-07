import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fmString, parseFrontmatter } from "../agent/plugins/frontmatter";
import { loadUserAgentRoles, USER_AGENT_SOURCES, userAgentInvoke } from "../agent/roles/user-agents";
import { MAX_CONCURRENT_WORKERS } from "../agent/orchestrator-config";
import { BUILTIN_ROLES } from "../agent/sequencer";
import { writeFileAtomic } from "../atomic-write";

const MAX_ROLE_BYTES = 32_768;
const fileRevision = (text: string): string => createHash("sha256").update(text).digest("hex");
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === "ENOENT";

export interface SubagentSettingsSnapshot {
  concurrencyCap: number;
  roles: Array<{ invoke: string; description: string; source: "builtin" | "cairn" | "claude"; file?: string }>;
  warnings: string[];
}

export interface SubagentMarkdown {
  markdown: string;
  revision: string;
}

export class SubagentSettings {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly dir: string;

  constructor(private readonly home = homedir()) {
    this.dir = join(home, USER_AGENT_SOURCES[0]!.rel);
  }

  async list(): Promise<SubagentSettingsSnapshot> {
    const { roles, warnings } = await loadUserAgentRoles({ home: this.home });
    return {
      concurrencyCap: MAX_CONCURRENT_WORKERS,
      roles: [
        ...Object.entries(BUILTIN_ROLES).map(([invoke, role]) => ({
          invoke, description: role.roleDefinition, source: "builtin" as const,
        })),
        ...roles.map((role) => ({
          invoke: userAgentInvoke(role.name),
          description: role.description,
          ...(dirname(role.path) === this.dir
            ? { source: "cairn" as const, file: basename(role.path) }
            : { source: "claude" as const }),
        })),
      ],
      warnings,
    };
  }

  async read(file: string): Promise<SubagentMarkdown> {
    const path = this.pathFor(file);
    await this.checkDirectories(false);
    const result = await this.readMarkdown(path);
    if (result === null) throw new Error("找不到该角色文件");
    return result;
  }

  save(file: string, markdown: string, expectedRevision: string | null): Promise<void> {
    return this.enqueue(async () => {
      const path = this.pathFor(file);
      if (typeof markdown !== "string" || Buffer.byteLength(markdown) > MAX_ROLE_BYTES) {
        throw new Error("角色文件最多 32 KiB");
      }
      const role = parseFrontmatter(markdown);
      const name = fmString(role.frontmatter, "name") ?? file.slice(0, -3);
      if (!/^[\p{L}\p{N}_.-]+$/u.test(name) || role.body.trim() === "") {
        throw new Error("请填写有效的角色名和角色指令");
      }
      await this.checkDirectories(true);
      const current = await this.readMarkdown(path);
      if ((current?.revision ?? null) !== expectedRevision) throw new Error("角色文件已有变化，请重新载入");
      const previousName = current === null ? null : fmString(parseFrontmatter(current.markdown).frontmatter, "name") ?? file.slice(0, -3);
      if (name !== previousName && (await loadUserAgentRoles({ home: this.home })).roles.some((r) => r.name === name && r.path !== path)) {
        throw new Error("已有同名角色");
      }
      await writeFileAtomic(path, markdown, { mode: 0o600 });
    });
  }

  remove(file: string, expectedRevision: string): Promise<void> {
    return this.enqueue(async () => {
      const path = this.pathFor(file);
      await this.checkDirectories(false);
      const current = await this.readMarkdown(path);
      if (current === null || current.revision !== expectedRevision) throw new Error("角色文件已有变化，请重新载入");
      await unlink(path);
    });
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.writes.then(action);
    this.writes = next.catch(() => undefined);
    return next;
  }

  private pathFor(file: string): string {
    if (typeof file !== "string" || file.length > 120 || !/^[\p{L}\p{N}_. -]+\.md$/u.test(file) || file.startsWith(".")) {
      throw new Error("角色文件名无效");
    }
    return join(this.dir, file);
  }

  private async checkDirectories(create: boolean): Promise<void> {
    for (const path of [dirname(this.dir), this.dir]) {
      if (create) {
        await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
      }
      const info = await lstat(path).catch((error: unknown) => {
        if (missing(error)) return null;
        throw error;
      });
      if (info === null) return;
      if (!info.isDirectory()) throw new Error("角色目录必须是本地普通目录");
    }
  }

  private async readMarkdown(path: string): Promise<SubagentMarkdown | null> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error: unknown) => {
      if (missing(error)) return null;
      throw error;
    });
    if (file === null) return null;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_ROLE_BYTES) throw new Error("角色必须是不超过 32 KiB 的普通文件");
      const buffer = Buffer.alloc(MAX_ROLE_BYTES + 1);
      let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
        if (bytesRead === 0) break;
        used += bytesRead;
      }
      if (used > MAX_ROLE_BYTES) throw new Error("角色文件最多 32 KiB");
      const markdown = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, used));
      return { markdown, revision: fileRevision(markdown) };
    } finally {
      await file.close();
    }
  }
}
