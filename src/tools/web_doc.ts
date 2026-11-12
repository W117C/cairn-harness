// web_doc：抓一个 http(s) URL 上的**文档**（pdf / docx / xlsx），抽取纯文本回给模型。
//
// 为什么单独一把而不是塞进 web_fetch：web_fetch 的入参语义是「取一个给定 URL 还原页面文本」，
// 文档二进制要走另一条判型/抽取链（read_doc 的原生解析器）；两形态混在一把工具里，
// 策略/回执/判卷三处都会分叉——M3 决策不把检索塞进 web_fetch 的同一条纪律。
//
// 网络纪律与 web_fetch **完全同源**：
//   · 出网判据在 web-fetch-policy（assertPublicUrlAndResolve：私网/回环/云元数据一律拒），这里只负责传输；
//   · 重定向逐跳重校验（每跳重跑判据），上限复用 MAX_REDIRECTS；
//   · 连接钉在判据刚批准的 DNS 地址上（pinnedHttpFetch，不做第二次解析）；
//   · 输出是外部不可信数据：同一份 envelope 信封。
// 传输层复用 web_fetch 的工厂参数注入（fetchImpl / resolveHost），生产单例与 web_fetch 同形状。
//
// 大小口径与 read_doc 对齐：响应体超 20MB **整条拒绝**（不「截断后继续」——zip/pdf 截断了
// 就解不开，给一份不完整的二进制比拒绝更坏；web_fetch 的截断续读只对 HTML/text 成立）。
// 抽取零新增依赖：read_doc 的 zip/zlib 原生解析 + pdf 文本层。
import { createOutputRing, WEB_CONTENT_TRUNCATION_HINT } from "./output-ring.js";
import { ToolError, type Tool, type ToolContext, type ToolResult } from "./base.js";
import { stallGuard, withAbort } from "../net.js";
import { assertPublicUrlAndResolve, type HostResolver } from "./web-fetch-policy.js";
import { defaultResolve, envelope, MAX_REDIRECTS, pinnedHttpFetch, type WebFetchImpl } from "./web_fetch.js";
import { DOC_MAX_FILE_BYTES, parseDocumentBuffer } from "./read_doc.js";

/** 静默窗口与总时长：与 web_fetch 同一数值（net.ts 的 stallGuard 同一条）。 */
const STALL_MS = 30_000;
const TOTAL_MS = 120_000;
/** 交给模型的正文帽（字符）：与 web_fetch 的 32KB 同档。超长文档应当按节取，不是整本灌上下文。 */
const MODEL_TEXT_CHARS = 32_000;

/** 二进制读体：与 net.readBodyCapped 同一条纪律（声明长度先拒、逐块 guard.bump 续命、
 *  finally 收 reader），但**不经过文本解码**——zip/pdf 是二进制，TextDecoder 一次就能把
 *  字节面改到解不开。超帽抛 ToolError（不返回 capped 标志：截断的二进制没有消费者）。
 *  不写进 net.ts：那里已有的唯一消费者是文本形态，为一把工具给共享层加 buffer 模式
 *  撑大了它的验证面；本仓已有「本地小读体」先例（web_fetch 自己的 decodeResponseBody）。 */
async function readBodyBuffer(res: Response, cap: number, guard: { bump(): void }, label: string): Promise<Buffer> {
  const declared = Number(res.headers?.get?.("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > cap) {
    void res.body?.cancel().catch(() => {});
    throw new ToolError(`${label}: 响应体声明 ${String(declared)} 字节，超过 ${String(cap / (1024 * 1024))}MB 上限——文档太大，换个更小的来源`);
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const ab = await res.arrayBuffer();
    if (ab.byteLength > cap) throw new ToolError(`${label}: 响应体 ${String(ab.byteLength)} 字节，超过上限`);
    return Buffer.from(ab);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      guard.bump();
      if (total > cap) {
        throw new ToolError(`${label}: 响应体超过 ${String(cap / (1024 * 1024))}MB 上限——文档太大，换个更小的来源`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface WebDocDeps {
  /** Test seam：生产用 pinnedHttpFetch（连接钉在判据刚批准的地址上）。 */
  fetchImpl?: WebFetchImpl;
  resolveHost?: HostResolver;
}

/** 组装工具。测试可注入 fetchImpl / resolveHost；生产连接固定到本轮刚校验过的 DNS 地址。 */
export function makeWebDoc(deps: WebDocDeps = {}): Tool {
  const doFetch = deps.fetchImpl ?? pinnedHttpFetch;
  const resolve = deps.resolveHost ?? defaultResolve;
  return {
    name: "web_doc",
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const raw = args.url;
      if (typeof raw !== "string" || raw.trim() === "") {
        throw new ToolError("web_doc: url 参数必须是非空字符串");
      }
      const guard = stallGuard(STALL_MS, "web_doc");
      const total = new AbortController();
      const totalTimer = setTimeout(() => total.abort(new Error(`web_doc 总时长超过 ${String(TOTAL_MS / 1000)}s（对端持续慢速滴灌）`)), TOTAL_MS);
      (totalTimer as { unref?: () => void }).unref?.();
      const signal = ctx.signal
        ? AbortSignal.any([guard.signal, total.signal, ctx.signal])
        : AbortSignal.any([guard.signal, total.signal]);
      let response: Response | undefined;
      try {
        signal.throwIfAborted();
        let current = raw.trim();
        let hops = 0;
        for (;;) {
          // 每一跳都重跑判据：「只校验输入 URL 等于没校验」的正解（web_fetch 同一条）。
          const target = await withAbort(signal, () => assertPublicUrlAndResolve(current, resolve, "web_doc"));
          const u = target.url;
          signal.throwIfAborted();
          const res = response = await doFetch(u.href, {
            redirect: "manual",
            signal,
            headers: { accept: "application/pdf,application/vnd.openxmlformats-officedocument.*,text/html;q=0.5,*/*;q=0.1" },
          }, target.addresses);
          signal.throwIfAborted();
          guard.bump();
          const loc = res.headers?.get?.("location");
          if (res.status >= 300 && res.status < 400 && loc !== undefined && loc !== null && loc !== "") {
            await res.body?.cancel().catch(() => {});
            signal.throwIfAborted();
            if (++hops > MAX_REDIRECTS) {
              return { ok: false, output: `web_doc: 重定向超过 ${String(MAX_REDIRECTS)} 跳，已停止（最终目标 ${u.href}）` };
            }
            current = new URL(loc, u).href;
            continue;
          }
          if (!res.ok) {
            await res.body?.cancel().catch(() => {});
            signal.throwIfAborted();
            return { ok: false, output: `web_doc: ${u.href} 返回 HTTP ${String(res.status)}${res.statusText !== "" ? " " + res.statusText : ""}` };
          }
          const ct = res.headers?.get?.("content-type") ?? "";
          // 响应体读帽 = read_doc 的文件帽（二进制读体，不经过文本解码）。超帽整条拒绝：
          // 不能像 web_fetch 那样截断续读——zip/pdf 截断了就解不开，半份二进制比拒绝更坏。
          const body = await readBodyBuffer(res, DOC_MAX_FILE_BYTES, guard, "web_doc").catch(async (error) => {
            await res.body?.cancel().catch(() => {});
            throw error;
          });
          signal.throwIfAborted();
          guard.bump();
          // 抽取：与 read_doc 同一份解析器（判型按内容，不看 content-type/扩展名）。
          let parsed: { kind: "pdf" | "docx" | "xlsx"; text: string };
          try {
            parsed = parseDocumentBuffer(body);
          } catch (err) {
            // 非文档响应给可行动的出口：普通网页是 web_fetch 的地界，不在这里吞掉。
            if (err instanceof ToolError) {
              const looksHtml = ct.includes("html") || /<html[\s>]/i.test(body.subarray(0, 512).toString("utf8"));
              if (looksHtml) {
                return { ok: false, output: `web_doc: ${u.href} 是网页不是文档（content-type: ${ct || "未声明"}）——读普通网页用 web_fetch` };
              }
              return { ok: false, output: `web_doc: ${u.href} 不是可解析的文档（pdf/docx/xlsx；content-type: ${ct || "未声明"}，原始 ${String(body.length)} 字节）：${err.message}` };
            }
            throw err;
          }
          if (parsed.kind === "pdf" && parsed.text === "") {
            return { ok: false, output: `web_doc: ${u.href} 的 pdf 没有可提取的文本层（可能是扫描件）——要内容需要 OCR，超出本工具能力` };
          }
          const text = parsed.text;
          if (text.trim() === "") {
            return { ok: false, output: `web_doc: ${u.href} 文档抽取结果为空（原始 ${String(body.length)} 字节）` };
          }
          const ring = createOutputRing(MODEL_TEXT_CHARS, WEB_CONTENT_TRUNCATION_HINT);
          ring.push(text);
          return { ok: true, output: envelope(raw.trim(), u.href, ring.read(), false) };
        }
      } catch (err) {
        // 停滞与出网失败都走这里：说清是哪种，别让模型拿到一句 "fetch failed" 自己猜。
        const cause = signal.aborted ? signal.reason : err;
        const msg = cause instanceof Error ? cause.message : String(cause);
        const cancelled = ctx.signal?.aborted === true && signal.reason === ctx.signal.reason;
        return { ok: false, output: cancelled ? `[cancelled] web_doc 已取消: ${msg}` : `web_doc 失败: ${msg}` };
      } finally {
        if (response?.body && !response.bodyUsed) void response.body.cancel().catch(() => {});
        clearTimeout(totalTimer);
        guard.dispose();
      }
    },
  };
}

/** 生产实例（模块级单例，与 web_fetch 同形状；agent-runner 挂载时过同一道 gatedTool 门）。 */
export const web_doc: Tool = makeWebDoc();
