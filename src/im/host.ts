// IM 通道宿主（2026-11-17 · 通道线）。
//
// 平台适配器拥有线协议，本模块拥有**其余的一切**：连接生命周期（sync 对账）、
// 配对闸（未配对发件人落 requests 等人批）、路由闸（群聊必 @）、按聊天的发送队列
// （重试/放弃分类如实上报）。路由与密钥是注入面：主进程把「消息→会话 run→回信」
// 与 safeStorage 读写接进来，本模块不 import Electron、不碰凭据值。
//
// 对账纪律：端点、保存与周期 tick 都会触发 sync()；sync 串行化（一次在飞），
// 槽位先占后连（并发 sync 不会给同一连接起两个适配器）。
import type {
  ImAdapterHandle,
  ImChat,
  ImConnection,
  ImEnv,
  ImInboundMessage,
  ImPlatformAdapter,
  ImPlatformSpec,
  ImStatus,
} from "./types";
import { chunkText, toPlainText } from "./format";

const SEND_RETRY_MS = 5_000;
const SEND_MAX_ATTEMPTS = 5;
/** 回信长度上限（分片数）：一次回复最多发多少片，防失控成本。 */
const SEND_MAX_CHUNKS = 6;

/** 路由注入面：主进程把入站消息送进绑定会话（无绑定则新建+开跑），返回回信文本。 */
export type ImRouteInbound = (
  conn: ImConnection,
  msg: ImInboundMessage,
) => Promise<{ ok: boolean; error?: string; reply?: string }>;

export interface ImHostDeps {
  store: ImStoreLike;
  platforms: Record<string, ImPlatformSpec>;
  adapters: Record<string, ImPlatformAdapter>;
  env: ImEnv;
  /** 密钥值读取（safeStorage 后端封装；按连接记录里的键名取值）。 */
  secretValue: (storeKey: string) => Promise<string | undefined>;
  routeInbound: ImRouteInbound;
  now?: () => number;
}

/** 存储最小面（判卷可给假实现）。 */
export interface ImStoreLike {
  load: () => Promise<ImConnection[]>;
  save: (all: ImConnection[]) => Promise<void>;
}

interface Runner {
  handle: ImAdapterHandle | null;
  queues: Map<string, { jobs: SendJob[]; retryTimer: ReturnType<typeof setTimeout> | null }>;
}

interface SendJob {
  chat: ImChat;
  text: string;
  attempts: number;
  after?: (sent: { messageId?: string }) => void;
}

/** 平台视图（设置面按它渲染：字段表、扫码形态都在这里，renderer 不 import 核心实现）。 */
export interface ImPlatformView {
  id: string;
  name: string;
  ws: boolean;
  login?: "fields" | "qr";
  fields: { key: string; label: string; secret?: boolean; hint?: string }[];
  textLimit: number;
}

export interface ImHostView {
  connections: {
    id: string;
    platform: string;
    account: { id: string; name: string } | null;
    sessionId: string;
    workspace?: string;
    settings: Record<string, string>;
    secretKeys: Record<string, string>;
    enabled: boolean;
    paired: { id: string; name: string; at: number }[];
    requests: { id: string; name: string; chat: ImChat; at: number }[];
    chats: Record<string, ImChat>;
    createdAt: number;
    status: ImStatus;
  }[];
  platforms: ImPlatformView[];
}

export function createImHost(deps: ImHostDeps) {
  const now = deps.now ?? (() => Date.now());
  let all: ImConnection[] = [];
  const runners = new Map<string, Runner>();
  const statuses = new Map<string, ImStatus>();
  let syncing: Promise<void> = Promise.resolve();
  let stopped = false;

  const setStatus = (id: string, next: ImStatus): void => {
    statuses.set(id, { ...next, at: now() });
  };

  // ── 发送队列（按聊天 FIFO；retryable 才重试，permanent 如实落状态）──────────
  const failClass = (error: unknown): "permanent" | "retry" => {
    const e = error as { permanent?: boolean; status?: number } | null;
    if (e !== null && e !== undefined && typeof e === "object") {
      if (e.permanent === true) return "permanent";
      if (typeof e.status === "number" && e.status >= 400 && e.status < 500 && e.status !== 429) return "permanent";
    }
    return "retry";
  };

  const enqueue = (conn: ImConnection, chatKey: string, job: SendJob): void => {
    const runner = runners.get(conn.id);
    if (runner === undefined) return;
    let queue = runner.queues.get(chatKey);
    if (queue === undefined) {
      queue = { jobs: [], retryTimer: null };
      runner.queues.set(chatKey, queue);
    }
    queue.jobs.push(job);
    if (queue.jobs.length === 1) void drain(conn.id, chatKey);
  };

  const drain = async (connId: string, chatKey: string): Promise<void> => {
    const runner = runners.get(connId);
    const queue = runner?.queues.get(chatKey);
    if (runner === undefined || queue === undefined) return;
    while (queue.jobs.length > 0) {
      if (runner.handle === null) return; // 槽位保留但连接还没就绪；sync 重 kick
      const job = queue.jobs[0];
      try {
        const sent = await runner.handle.send(job.chat, job.text);
        queue.jobs.shift();
        job.after?.(sent);
      } catch (error) {
        job.attempts += 1;
        if (failClass(error) === "permanent" || job.attempts >= SEND_MAX_ATTEMPTS) {
          queue.jobs.shift();
          setStatus(connId, {
            state: statuses.get(connId)?.state ?? "error",
            error: `回信失败：${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
          }
        // retryable：整队停住等重试
        if (queue.retryTimer !== null) clearTimeout(queue.retryTimer);
        queue.retryTimer = setTimeout(() => { void drain(connId, chatKey); }, SEND_RETRY_MS);
        return;
      }
    }
  };

  const sendTo = (connId: string, chatKey: string, text: string, after?: (sent: { messageId?: string }) => void): void => {
    const conn = all.find((c) => c.id === connId);
    const runner = runners.get(connId);
    if (conn === undefined || runner === undefined) return;
    const chat = conn.chats[chatKey];
    if (chat === undefined) return;
    const plain = toPlainText(text);
    const chunks = chunkText(plain, deps.platforms[conn.platform]?.textLimit ?? 4000).slice(0, SEND_MAX_CHUNKS);
    for (const chunk of chunks) enqueue(conn, chatKey, { chat, text: chunk, attempts: 0, ...(after === undefined ? {} : { after }) });
  };

  // ── 入站管线 ──────────────────────────────────────────────────────────────────
  const onMessage = (conn: ImConnection) => async (msg: ImInboundMessage): Promise<void> => {
    // 登记聊天（回信寻址用；幂等）——先登记再过闸，通知也得有处可送。
    if (conn.chats[msg.chat.key] === undefined) {
      conn.chats[msg.chat.key] = { kind: msg.chat.kind, key: msg.chat.key, title: msg.chat.title };
      await deps.store.save(all);
    }
    // 配对闸：未配对发件人 → 落一条申请（同发件人去重），回一句「已在桌面端等你批准」。
    if (!conn.paired.some((p) => p.id === msg.sender.id)) {
      if (msg.chat.kind === "group" && !msg.mentioned) return;
      if (!conn.requests.some((r) => r.id === msg.sender.id)) {
        conn.requests.push({ id: msg.sender.id, name: msg.sender.name, chat: msg.chat, at: now() });
        await deps.store.save(all);
      }
      sendTo(conn.id, msg.chat.key, "已向 Cairn 发出连接请求，请在桌面端 设置 → 通道 里批准。");
      return;
    }
    // 群聊闸：群消息必须 @ 机器人才收。
    if (msg.chat.kind === "group" && !msg.mentioned) return;
    // 空文本闸（2026-11-18 审计）：图片/文件/无转写语音在 V1 不承载，适配器归一化后 text 是空串。
    // 不设这道闸，空串会一路走到 routeInbound：没有会话时先建一个、再起一次空跑——白烧一次
    // 模型调用，会话里还多一个空气泡。这里回的是一句如实的范围说明，不静默吞掉（沉默会被读成"坏了"）。
    if (msg.text.trim() === "") {
      sendTo(conn.id, msg.chat.key, "这条消息里没有文字。当前只收文本与语音转写，图片/文件还不支持。");
      return;
    }
    const result = await deps.routeInbound(conn, msg);
    if (result.ok === true && typeof result.reply === "string" && result.reply.trim() !== "") {
      sendTo(conn.id, msg.chat.key, result.reply);
    }
  };

  // ── 生命周期：槽位先占后连，sync 串行对账 ────────────────────────────────────
  const start = async (conn: ImConnection): Promise<void> => {
    const adapter = deps.adapters[conn.platform];
    if (adapter === undefined || runners.has(conn.id)) return;
    const spec = deps.platforms[conn.platform];
    if (spec?.ws === true && deps.env.WebSocket === undefined) {
      setStatus(conn.id, { state: "error", error: "这个环境没有 WebSocket，连不上这个平台" });
      return;
    }
    // 槽位先占：并发 sync 不会给同一连接起两个适配器。
    runners.set(conn.id, { handle: null, queues: new Map() });
    setStatus(conn.id, { state: "connecting" });
    try {
      // 密钥值只在 connect 前从注入面读，拼进 fields；不进连接记录。
      const fields: Record<string, string> = { ...conn.settings };
      for (const [key, storeKey] of Object.entries(conn.secretKeys)) {
        const value = await deps.secretValue(storeKey);
        if (value === undefined) {
          runners.delete(conn.id);
          setStatus(conn.id, { state: "error", error: `密钥 ${key} 没有值（先在设置页保存）` });
          return;
        }
        fields[key] = value;
      }
      // 逐连接运行态注入：游标/context_token 挂在连接记录上（随 connections.json 持久化，
      // 重启不重放），由 host 单点落盘。
      const connEnv: ImEnv = {
        ...deps.env,
        runtime: {
          get: () => conn.runtime ?? {},
          set: (patch) => {
            conn.runtime = { ...(conn.runtime ?? {}), ...patch };
            void deps.store.save(all);
          },
        },
      };
      const handle = adapter.connect(fields, connEnv, {
        onMessage: (msg) => {
          const current = all.find((c) => c.id === conn.id);
          if (current === undefined) return;
          return onMessage(current)(msg);
        },
        onStatus: (status) => setStatus(conn.id, status),
      });
      runners.set(conn.id, { handle, queues: runners.get(conn.id)?.queues ?? new Map() });
    } catch (error) {
      runners.delete(conn.id);
      setStatus(conn.id, { state: "error", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const stop = async (id: string): Promise<void> => {
    const runner = runners.get(id);
    runners.delete(id);
    for (const queue of runner?.queues.values() ?? []) {
      if (queue.retryTimer !== null) clearTimeout(queue.retryTimer);
    }
    await Promise.resolve(runner?.handle?.stop?.()).catch(() => undefined);
    if (statuses.get(id)?.state !== "error") setStatus(id, { state: "off" });
  };

  /** 对账：想要跑的（启用+有适配器+密钥齐）起，不再想要的停。串行化（一次在飞）。 */
  const sync = (): Promise<void> => {
    const run = syncing.then(async () => {
      if (stopped) return;
      for (const conn of all) {
        const adapter = deps.adapters[conn.platform] !== undefined;
        const wants = conn.enabled === true && adapter;
        if (wants && !runners.has(conn.id)) await start(conn);
        else if (!wants && runners.has(conn.id)) await stop(conn.id);
      }
      for (const id of [...runners.keys()]) {
        if (!all.some((c) => c.id === id)) await stop(id);
      }
    });
    syncing = run.catch(() => undefined);
    return run;
  };

  /** 随机连接 id：`im_` + 8 位 hex。 */
  const newId = (): string => `im_${Math.random().toString(16).slice(2, 10)}`;

  // ── 端点（设置页走 IPC 调进来）──────────────────────────────────────────────
  const add = async (input: {
    platform: string;
    fields: Record<string, string>;
    sessionId?: string;
    workspace?: string;
    /** 密钥值落 safeStorage 的入口（主进程注入；host 不碰存储细节）。 */
    putSecret: (storeKey: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  }): Promise<{ ok: boolean; error?: string; id?: string }> => {
    const spec = deps.platforms[input.platform];
    const adapter = deps.adapters[input.platform];
    if (spec === undefined || adapter === undefined) return { ok: false, error: "未知平台" };
    const fields: Record<string, string> = {};
    const secrets: { key: string; value: string }[] = [];
    for (const field of spec.fields) {
      const value = input.fields[field.key];
      if (typeof value === "string" && value.trim() !== "") {
        if (field.secret === true) secrets.push({ key: field.key, value: value.trim() });
        else fields[field.key] = value.trim();
      } else if (field.secret !== true) {
        return { ok: false, error: `${field.label} 必填` };
      }
    }
    if (secrets.length === 0) return { ok: false, error: "密钥字段一个都没给" };
    // check 需要密钥值：临时拼进 fields（只在这一次调用里），失败即拒存。
    const checkFields = { ...fields };
    for (const s of secrets) checkFields[s.key] = s.value;
    let account: { id: string; name: string };
    try {
      account = (await adapter.check(checkFields, deps.env)).account;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const id = newId();
    const secretKeys: Record<string, string> = {};
    for (const s of secrets) {
      const storeKey = `im:${id}:${s.key}`;
      const put = await input.putSecret(storeKey, s.value);
      if (put.ok !== true) return { ok: false, error: put.error ?? "密钥保存失败" };
      secretKeys[s.key] = storeKey;
    }
    all.push({
      id,
      platform: spec.id,
      account,
      sessionId: typeof input.sessionId === "string" ? input.sessionId : "",
      ...(typeof input.workspace === "string" && input.workspace !== "" ? { workspace: input.workspace } : {}),
      settings: fields,
      secretKeys,
      enabled: true,
      paired: [],
      requests: [],
      chats: {},
      createdAt: now(),
    });
    await deps.store.save(all);
    void sync();
    return { ok: true, id };
  };

  const update = async (input: {
    id: string;
    sessionId?: string;
    enabled?: boolean;
    fields?: Record<string, string>;
    putSecret: (storeKey: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  }): Promise<{ ok: boolean; error?: string }> => {
    const conn = all.find((c) => c.id === input.id);
    if (conn === undefined) return { ok: false, error: "没有这条连接" };
    if (typeof input.sessionId === "string") conn.sessionId = input.sessionId;
    if (input.enabled !== undefined) conn.enabled = input.enabled === true;
    if (input.fields !== undefined) {
      const spec = deps.platforms[conn.platform];
      for (const field of spec?.fields ?? []) {
        const value = input.fields[field.key];
        if (typeof value !== "string" || value.trim() === "") continue;
        if (field.secret === true) {
          const storeKey = conn.secretKeys[field.key] ?? `im:${conn.id}:${field.key}`;
          const put = await input.putSecret(storeKey, value.trim());
          if (put.ok !== true) return { ok: false, error: put.error ?? "密钥保存失败" };
          conn.secretKeys[field.key] = storeKey;
        } else {
          conn.settings[field.key] = value.trim();
        }
        if (spec?.ws === true && runnerCheck(conn.id)) await stop(conn.id);
      }
    }
    await deps.store.save(all);
    void sync();
    return { ok: true };
  };

  const runnerCheck = (id: string): boolean => runners.has(id);

  const remove = async (id: string): Promise<{ ok: boolean; error?: string; secretKeys?: Record<string, string> }> => {
    const conn = all.find((c) => c.id === id);
    if (conn === undefined) return { ok: false, error: "没有这条连接" };
    await stop(id);
    const secretKeys = { ...conn.secretKeys };
    all = all.filter((c) => c.id !== id);
    await deps.store.save(all);
    // 密钥键名交还调用方删（safeStorage 在主进程侧）。
    return { ok: true, secretKeys };
  };

  const pair = async (id: string, senderId: string, allow: boolean): Promise<{ ok: boolean; error?: string }> => {
    const conn = all.find((c) => c.id === id);
    if (conn === undefined) return { ok: false, error: "没有这条连接" };
    const at = conn.requests.findIndex((r) => r.id === senderId);
    if (at === -1) return { ok: false, error: "这条申请已经不在了" };
    const [request] = conn.requests.splice(at, 1);
    if (allow === true) {
      conn.paired.push({ id: request.id, name: request.name, at: now() });
      conn.chats[request.chat.key] ??= { kind: request.chat.kind, key: request.chat.key, title: request.chat.title };
      await deps.store.save(all);
      sendTo(id, request.chat.key, "已连接——现在可以直接跟 Cairn 说话了。");
    } else {
      await deps.store.save(all);
    }
    return { ok: true };
  };

  const unpair = async (id: string, senderId: string): Promise<{ ok: boolean; error?: string }> => {
    const conn = all.find((c) => c.id === id);
    if (conn === undefined) return { ok: false, error: "没有这条连接" };
    conn.paired = conn.paired.filter((p) => p.id !== senderId);
    await deps.store.save(all);
    return { ok: true };
  };

  const retry = async (id: string): Promise<void> => {
    if (runners.has(id)) await stop(id);
    await sync();
  };

  // ── 扫码登录端点（微信 iLink；设置面二维码流驱动）───────────────────────────
  const loginStart = async (platform: string): Promise<{ ok: boolean; error?: string; loginId?: string; qr?: string; expiresAt?: number }> => {
    const adapter = deps.adapters[platform];
    if (adapter?.loginStart === undefined) return { ok: false, error: "这个平台不走扫码登录" };
    try {
      const result = await adapter.loginStart(deps.env);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const loginWait = async (input: {
    platform: string;
    loginId: string;
    putSecret: (storeKey: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  }): Promise<{ ok: boolean; status?: "waiting" | "scanned" | "expired" | "done"; error?: string; id?: string }> => {
    const adapter = deps.adapters[input.platform];
    if (adapter?.loginWait === undefined) return { ok: false, error: "这个平台不走扫码登录" };
    let result: Awaited<ReturnType<NonNullable<typeof adapter.loginWait>>>;
    try {
      result = await adapter.loginWait(input.loginId, deps.env);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (result.status !== "done") return { ok: true, status: result.status };
    // confirmed：建连（密钥落 safeStorage；扫码人直接进配对名单——本人扫的码，无需再批）。
    const spec = deps.platforms[input.platform];
    if (spec === undefined) return { ok: false, error: "未知平台" };
    const id = newId();
    const secretKeys: Record<string, string> = {};
    for (const [key, value] of Object.entries(result.connection?.secrets ?? {})) {
      const storeKey = `im:${id}:${key}`;
      const put = await input.putSecret(storeKey, value);
      if (put.ok !== true) return { ok: false, error: put.error ?? "密钥保存失败" };
      secretKeys[key] = storeKey;
    }
    const owner = result.owner;
    all.push({
      id,
      platform: spec.id,
      account: result.connection?.account ?? null,
      sessionId: "",
      settings: result.connection?.settings ?? {},
      secretKeys,
      enabled: true,
      paired: owner === undefined ? [] : [{ id: owner.id, name: owner.name, at: now() }],
      requests: [],
      chats: owner === undefined ? {} : { [owner.id]: { kind: "direct", key: owner.id, title: owner.name } },
      runtime: {},
      createdAt: now(),
    });
    await deps.store.save(all);
    void sync();
    return { ok: true, status: "done", id };
  };

  const view = (): ImHostView => ({
    connections: all.map((c) => ({
      id: c.id,
      platform: c.platform,
      account: c.account,
      sessionId: c.sessionId,
      ...(c.workspace === undefined ? {} : { workspace: c.workspace }),
      settings: { ...c.settings },
      secretKeys: { ...c.secretKeys },
      enabled: c.enabled,
      paired: c.paired.map((p) => ({ ...p })),
      requests: c.requests.map((r) => ({ ...r })),
      chats: { ...c.chats },
      createdAt: c.createdAt,
      status: statuses.get(c.id) ?? { state: "off" as const },
    })),
    platforms: Object.values(deps.platforms).map((spec) => ({
      id: spec.id,
      name: spec.name,
      ws: spec.ws,
      ...(spec.login === undefined ? {} : { login: spec.login }),
      fields: spec.fields.map((f) => ({ ...f })),
      textLimit: spec.textLimit,
    })),
  });

  /** 启动：读存储、首轮对账。 */
  const boot = async (): Promise<void> => {
    all = await deps.store.load();
    await sync();
  };

  const stopAll = async (): Promise<void> => {
    stopped = true;
    await Promise.all([...runners.keys()].map(stop));
  };

  return {
    boot, sync, stopAll,
    add, update, remove, pair, unpair, retry,
    loginStart, loginWait,
    sendTo, view,
    /** 供主进程读原始连接（路由/回信寻址用）。 */
    connectionOf: (id: string): ImConnection | undefined => all.find((c) => c.id === id),
    /** 显式持久化（路由侧改了连接绑定后调用；路由是注入面，host 不知道它改了状态）。 */
    save: async (): Promise<void> => { await deps.store.save(all); },
    /** 测试缝：直读状态。 */
    statusOf: (id: string): ImStatus | undefined => statuses.get(id),
  };
}

export type ImHost = ReturnType<typeof createImHost>;
