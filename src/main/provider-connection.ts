// 「检查连接」：把「key 存进去了」与「服务真的能用」分成两个事实。
//
// 产品验收（第一批第 4 条）：保存凭据、发现模型、实际连接成功要分别显示状态——
// 用户最容易误解的形态就是「保存成功 = 能用了」。本模块只做第三件事的一次最小验证：
//   GET 模型清单（不产生 token 费用），复用 model-discovery 的端点/鉴权/超时/不跟重定向纪律。
//
// 端点事实的来源：GLM 直接用适配器的 GLM_ENDPOINT 常量（去 /chat/completions 后缀），
// 其余三家与各自适配器的缺省 baseURL 对齐（适配器未导出常量——这里是第二份，
// 改了适配器缺省必须同步这里；不一致的后果是检查失败/落错地址，可见、不会静默成功）。
import { GLM_ENDPOINT } from "../providers/glm";
import { DEEPSEEK_ENDPOINT } from "../providers/deepseek";
import { envKeyOf } from "../providers/env-keys";
import { discoverModels, type DiscoverFailure } from "./model-discovery";
import type { DiscoveryProtocol } from "../providers/discovery";

export interface BuiltinConnectionTarget {
  protocol: DiscoveryProtocol;
  baseURL: string;
}

function stripEndpointSuffix(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/(chat\/completions|messages)$/, "");
}

/** 内置四家的 (protocol, baseURL)。环境变量覆盖与适配器同源（CAIRN_ENDPOINT / OPENAI_BASE_URL）。 */
export function builtinConnectionTarget(provider: string, env: NodeJS.ProcessEnv = process.env): BuiltinConnectionTarget | null {
  switch (provider) {
    case "glm": {
      const override = (env.CAIRN_ENDPOINT ?? "").trim();
      return { protocol: "openai", baseURL: stripEndpointSuffix(override !== "" ? override : GLM_ENDPOINT) };
    }
    case "openai": {
      const override = (env.OPENAI_BASE_URL ?? "").trim();
      return { protocol: "openai", baseURL: stripEndpointSuffix(override !== "" ? override : "https://api.openai.com/v1") };
    }
    case "anthropic":
      return { protocol: "anthropic", baseURL: "https://api.anthropic.com" };
    case "gemini":
      return { protocol: "gemini", baseURL: "https://generativelanguage.googleapis.com" };
    case "deepseek":
      return { protocol: "openai", baseURL: stripEndpointSuffix(overrideOf(env.DEEPSEEK_ENDPOINT) ?? DEEPSEEK_ENDPOINT) };
    default:
      return null;
  }
}

function overrideOf(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  return v === "" ? null : v;
}

export type ProviderCheckReason =
  | "unknown-provider"
  | "no-key"
  | "unauthorized"
  | "unsupported"
  | "http"
  | "network"
  | "timeout"
  | "redirect"
  | "shape"
  | "bad-url"
  | "insecure-endpoint";

export type ProviderConnectionResult =
  | { ok: true; provider: string; endpoint: string; modelCount: number; sample: string[] }
  | { ok: false; provider: string; reason: ProviderCheckReason; message: string; hint: string; status?: number };

function classify(failure: DiscoverFailure, status: number | undefined): ProviderCheckReason {
  if (failure !== "http") return failure;
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404 || status === 405) return "unsupported";
  return "http";
}

function hintFor(reason: ProviderCheckReason, provider: string): string {
  switch (reason) {
    case "no-key":
      return "先在这一页粘贴并保存 key，再点「检查连接」。";
    case "unauthorized":
      return "key 被上游拒绝：确认没复制错、没过期，且与该服务的地区/权限要求一致。";
    case "unsupported":
      return "这家服务不提供模型清单接口：key 已保存，可直接发一个任务验证；Cairn 不会因此拒绝使用。";
    case "network":
      return "网络没通：检查代理/DNS 后重试。";
    case "timeout":
      return "请求超时：稍后重试；国内网络可考虑配置镜像或代理。";
    case "redirect":
      return "服务地址发生了重定向（为保护密钥 Cairn 不跟随）：改用最终地址。";
    case "insecure-endpoint":
      return "非 https 端点只允许本机/内网地址。";
    case "shape":
      return "服务返回的不是模型清单：可能打到了网页而不是接口。";
    case "bad-url":
      return "服务地址不合法，请检查自定义端点配置。";
    case "http":
      return `上游报错但 key 可能有效：稍后重试；持续失败可在终端用 curl 复现 ${provider} 的 /models。`;
    case "unknown-provider":
      return "内置的五家（glm / openai / anthropic / gemini / deepseek）支持一键检查；自定义接口请在自定义表单里「拉取」。";
  }
}

export interface CheckProviderInput {
  provider: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * 一次连接自检：GET 模型清单。
 * 绝不在返回里带 key 值；失败一律分类 + 给下一步，不抛。
 */
export async function checkProviderConnection(input: CheckProviderInput): Promise<ProviderConnectionResult> {
  const provider = input.provider.trim();
  const env = input.env ?? process.env;
  const target = builtinConnectionTarget(provider, env);
  if (target === null) {
    return { ok: false, provider, reason: "unknown-provider", message: `未知 provider：${provider}`, hint: hintFor("unknown-provider", provider) };
  }
  const keyEnv = envKeyOf(provider);
  if (keyEnv === null) {
    return { ok: false, provider, reason: "unknown-provider", message: `provider ${provider} 没有登记 key 环境变量`, hint: hintFor("unknown-provider", provider) };
  }
  const found = await discoverModels({
    baseURL: target.baseURL,
    protocol: target.protocol,
    keyEnv,
    env,
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  if (found.ok) {
    return {
      ok: true,
      provider,
      endpoint: found.requestURL,
      modelCount: found.models.length,
      sample: found.models.slice(0, 3).map((m) => m.id),
    };
  }
  const reason = classify(found.reason, found.status);
  return {
    ok: false,
    provider,
    reason,
    message: found.message,
    hint: hintFor(reason, provider),
    ...(found.status !== undefined ? { status: found.status } : {}),
  };
}
