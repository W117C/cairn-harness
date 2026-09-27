// CX-01 Project Registry：项目是 Session 平面之外的权威组织记录，不把绝对路径塞进 JSONL。
// 仓库只存本地元数据；remove 是软删除，绝不删除项目目录或工作树。
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { writeFileAtomic } from "../atomic-write";

const SCHEMA_VERSION = 1 as const;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 160;
const MAX_PATH_LENGTH = 4096;

export interface ProjectRecord {
  /** 稳定项目身份；会话只引用它，不复制项目路径。 */
  id: string;
  /** 用户可见名称；缺省添加时取 canonical path 的末段。 */
  name: string;
  /** canonical realpath：添加时已 realpath 化并确认是目录。 */
  path: string;
  /** 默认运行位置；同样是已确认的 canonical 目录 realpath。 */
  defaultLocation: string;
  createdAt: string;
  updatedAt: string;
  /** 软删除时间；记录仍在仓库，但默认 list 不再把它当活动项目。 */
  removedAt?: string;
}

export interface AddProjectInput {
  name?: string;
  path: string;
  defaultLocation?: string;
}

interface ProjectRegistryState {
  version: typeof SCHEMA_VERSION;
  projects: Record<string, ProjectRecord>;
}

export class ProjectRegistryCorruptError extends Error {
  constructor(filePath: string, reason: string) {
    super(`项目注册表损坏，已拒绝覆盖: ${filePath} (${reason})`);
    this.name = "ProjectRegistryCorruptError";
  }
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertName(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_NAME_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`项目名称非法：须为 1–${MAX_NAME_LENGTH} 个无首尾空白/控制字符的字符`);
  }
}

function assertStoredPath(value: unknown, field: "path" | "defaultLocation"): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    !isAbsolute(value) ||
    value.includes("\u0000")
  ) {
    throw new Error(`项目 ${field} 非法：须为绝对路径`);
  }
}

function validateProject(raw: unknown, key: string): ProjectRecord {
  if (!isRecord(raw)) throw new Error(`projects.${key} 不是对象`);
  if (!isSafeId(raw.id) || raw.id !== key) throw new Error(`projects.${key}.id 与键不一致或非法`);
  assertName(raw.name);
  assertStoredPath(raw.path, "path");
  assertStoredPath(raw.defaultLocation, "defaultLocation");
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)) throw new Error(`projects.${key} 时间戳非法`);
  if (raw.removedAt !== undefined && !isTimestamp(raw.removedAt)) throw new Error(`projects.${key}.removedAt 非法`);

  return {
    id: raw.id,
    name: raw.name,
    path: raw.path,
    defaultLocation: raw.defaultLocation,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...(raw.removedAt !== undefined ? { removedAt: raw.removedAt } : {}),
  };
}

function validateState(raw: unknown): ProjectRegistryState {
  if (!isRecord(raw) || raw.version !== SCHEMA_VERSION || !isRecord(raw.projects)) {
    throw new Error("根对象/version/projects 结构非法");
  }
  const projects: Record<string, ProjectRecord> = {};
  const canonicalPaths = new Map<string, string>();
  for (const [key, value] of Object.entries(raw.projects)) {
    const project = validateProject(value, key);
    const prior = canonicalPaths.get(project.path);
    if (prior !== undefined) throw new Error(`projects.${key}.path 与 ${prior} 重复`);
    canonicalPaths.set(project.path, key);
    projects[key] = project;
  }
  return { version: SCHEMA_VERSION, projects };
}

function cloneProject(project: ProjectRecord): ProjectRecord {
  return { ...project };
}

/** 原子、进程内串行的本地项目仓库。文件不存在是空默认；JSON/结构损坏则显式失败，不静默覆盖。 */
export class ProjectRegistry {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(options: { includeRemoved?: boolean } = {}): Promise<ProjectRecord[]> {
    const state = await this.load();
    return Object.values(state.projects)
      .filter((project) => options.includeRemoved === true || project.removedAt === undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map(cloneProject);
  }

  async get(id: string): Promise<ProjectRecord> {
    if (!isSafeId(id)) throw new Error(`项目 id 非法: ${JSON.stringify(id)}`);
    const state = await this.load();
    const project = Object.prototype.hasOwnProperty.call(state.projects, id) ? state.projects[id] : undefined;
    if (!project) throw new Error(`项目不存在: ${id}`);
    return cloneProject(project);
  }

  async getActive(id: string): Promise<ProjectRecord> {
    const project = await this.get(id);
    if (project.removedAt !== undefined) throw new Error(`项目已移除: ${id}`);
    return project;
  }

  async add(input: AddProjectInput): Promise<ProjectRecord> {
    return await this.enqueue(async () => {
      if (!isRecord(input)) throw new Error("项目 add 参数必须是对象");
      const canonicalPath = await canonicalDirectory(input.path, "path");
      const canonicalDefault = input.defaultLocation === undefined
        ? canonicalPath
        : await canonicalDirectory(input.defaultLocation, "defaultLocation");

      const state = await this.load();
      const existing = Object.values(state.projects).find((project) => project.path === canonicalPath);
      if (existing && existing.removedAt === undefined) throw new Error(`项目已注册: ${canonicalPath}`);

      const now = new Date().toISOString();
      const name = input.name === undefined
        ? (existing?.name ?? (basename(canonicalPath) || canonicalPath))
        : input.name;
      assertName(name);

      const project: ProjectRecord = existing
        ? {
            ...existing,
            name,
            defaultLocation: canonicalDefault,
            updatedAt: now,
            removedAt: undefined,
          }
        : {
            id: randomUUID(),
            name,
            path: canonicalPath,
            defaultLocation: canonicalDefault,
            createdAt: now,
            updatedAt: now,
          };
      // `removedAt: undefined` 不会留下 JSON 键；显式重建以免复用对象时残留软删除字段。
      const normalized = cloneProject(project);
      delete normalized.removedAt;
      state.projects[normalized.id] = normalized;
      await this.persist(state);
      return cloneProject(normalized);
    });
  }

  async remove(id: string): Promise<ProjectRecord> {
    return await this.enqueue(async () => {
      if (!isSafeId(id)) throw new Error(`项目 id 非法: ${JSON.stringify(id)}`);
      const state = await this.load();
      const project = Object.prototype.hasOwnProperty.call(state.projects, id) ? state.projects[id] : undefined;
      if (!project) throw new Error(`项目不存在: ${id}`);
      if (project.removedAt !== undefined) return cloneProject(project);

      const now = new Date().toISOString();
      const removed: ProjectRecord = { ...project, updatedAt: now, removedAt: now };
      state.projects[id] = removed;
      await this.persist(state);
      return cloneProject(removed);
    });
  }

  private async load(): Promise<ProjectRegistryState> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: SCHEMA_VERSION, projects: {} };
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new ProjectRegistryCorruptError(this.filePath, "JSON.parse 失败");
    }
    try {
      return validateState(raw);
    } catch (error) {
      throw new ProjectRegistryCorruptError(this.filePath, error instanceof Error ? error.message : String(error));
    }
  }

  private async persist(state: ProjectRegistryState): Promise<void> {
    await writeFileAtomic(this.filePath, JSON.stringify(state, null, 2) + "\n");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(operation);
    this.writes = next.catch(() => undefined);
    return next;
  }
}

async function canonicalDirectory(input: unknown, field: "path" | "defaultLocation"): Promise<string> {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > MAX_PATH_LENGTH ||
    input.includes("\u0000") ||
    !isAbsolute(input)
  ) {
    throw new Error(`项目 ${field} 非法：须为绝对路径`);
  }
  const canonical = await realpath(input);
  if (!isAbsolute(canonical) || canonical.includes("\u0000")) throw new Error(`项目 ${field} realpath 非法`);
  if (!(await stat(canonical)).isDirectory()) throw new Error(`项目 ${field} 不是目录: ${canonical}`);
  return canonical;
}
