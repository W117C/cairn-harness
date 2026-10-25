import type { ExecutionBackend } from "../orchestration/types";
import { createLocalBackend, type LocalProviderConfig, type TrustedCommandSandbox } from "../orchestration/local-backend";
import type { Provider } from "../providers";
import { DEFAULT_MODEL_TABLE, toWorkerModel } from "../providers/registry";
import { effectivePriceTable, type ModelPrice } from "../routing/pricing";
import { providerKeyConfigured, providerKindFromEnv, resolveMainModel, selectionProviderId, type MainModelSelection } from "./provider-runtime";
import { store } from "./settings-handlers";

const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_OUTPUT_TOKENS = 4096;
const ENDPOINTS: Readonly<Record<string, string>> = {
  deepseek: "https://api.deepseek.com/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

export interface WorkspaceOrchestrationBackendOptions {
  /** Trusted host injection; no secret is returned through the backend interface. */
  selection?: MainModelSelection;
  fetchImpl?: typeof fetch;
  /** null explicitly means unknown. Only complete, calibrated tariffs are accepted. */
  price?: ModelPrice | null;
  commandSandbox?: TrustedCommandSandbox;
}

function completeTariff(price: ModelPrice | null | undefined): price is ModelPrice {
  return price?.calibrated === true && [price.inputPerMTok, price.outputPerMTok, price.cacheReadPerMTok, price.cacheWritePerMTok]
    .every((rate) => typeof rate === "number" && Number.isFinite(rate) && rate >= 0) && price.inputPerMTok > 0 && price.outputPerMTok > 0;
}

async function configuredSelection(): Promise<MainModelSelection> {
  const settings = await store().get();
  return resolveMainModel({ forcedKind: providerKindFromEnv(process.env.M0A_PROVIDER), configuredKind: settings.provider, settingsModel: settings.model, legacyEnvModel: process.env.CAIRN_MODEL });
}

/**
 * A tariff reservation ceiling, not a prediction or certification of the vendor's bill.
 * Native text-only input uses the conservative one-token-per-serialized-UTF8-byte ceiling;
 * all input is charged at the highest complete input/cache tariff, output at its hard cap.
 * Unknown protocols, image tokenization, incomplete tariffs and endpoint overrides fail closed.
 * Construction performs no fetch; the service invokes this backend only after plan approval.
 */
export async function createWorkspaceOrchestrationBackend(
  workspace: string,
  dataDir: string,
  options: WorkspaceOrchestrationBackendOptions = {},
): Promise<ExecutionBackend | null> {
  let selection: MainModelSelection;
  try { selection = options.selection ?? await configuredSelection(); } catch { return null; }
  if (selection.kind === "demo") return null;
  const providerId = selectionProviderId(selection);
  const spec = { ...selection.spec };
  // A custom OpenAI-compatible endpoint does not establish the selected model's token/cap semantics.
  if (!ENDPOINTS[providerId] || spec.provider !== providerId || !DEFAULT_MODEL_TABLE.some((row) => row.id === spec.id && row.model === spec.model && row.provider === providerId)) return null;
  try { if (!providerKeyConfigured(providerId)) return null; } catch { return null; }
  const price = options.price === undefined ? effectivePriceTable()[spec.id] : options.price;
  if (!completeTariff(price)) return null;
  const maxCallUsd = (MAX_REQUEST_BYTES * Math.max(price.inputPerMTok, price.cacheReadPerMTok!, price.cacheWritePerMTok!) + MAX_OUTPUT_TOKENS * price.outputPerMTok) / 1_000_000;
  if (!Number.isFinite(maxCallUsd) || maxCallUsd <= 0) return null;
  const rawFetch = options.fetchImpl ?? fetch;
  const config: LocalProviderConfig = {
    cost: { kind: "bounded", max_call_usd: maxCallUsd },
    create(context): Provider {
      return { async *stream(messages, tools, call) {
        const budget = new AbortController();
        const signals = [context.signal, budget.signal, ...(call?.signal ? [call.signal] : [])];
        const signal = AbortSignal.any(signals); signal.throwIfAborted();
        const refuse = (message: string): never => { const error = new Error(message); budget.abort(error); throw error; };
        if (messages.some((message) => message.contentParts?.length)) refuse("orchestration budget gateway supports text input only");
        let attempted = false;
        const gatedFetch: typeof fetch = async (input, init) => {
          signal.throwIfAborted();
          if (attempted) refuse("orchestration fetch budget permits only one fetch per provider stream; retry refused");
          attempted = true;
          if (String(input) !== ENDPOINTS[providerId] || init?.method !== "POST") refuse("orchestration endpoint is outside the tariff contract");
          const bodyText = init?.body;
          if (typeof bodyText !== "string") { refuse("orchestration request must be bounded JSON text"); }
          // Narrowing a `BodyInit` through a `never`-returning closure is not recognized by tsc
          // (the check above is the runtime guard; this cast keeps the boundary explicit).
          const body = JSON.parse(bodyText as string) as Record<string, unknown>;
          if (body.model !== spec.model || body.n !== undefined && body.n !== 1) refuse("orchestration request model/output count changed");
          body.max_tokens = MAX_OUTPUT_TOKENS;
          body.thinking = { type: "disabled" };
          delete body.reasoning_effort;
          delete body.max_completion_tokens;
          const serialized = JSON.stringify(body);
          if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) refuse(`orchestration request exceeds ${MAX_REQUEST_BYTES} UTF8 bytes before network`);
          signal.throwIfAborted();
          return rawFetch(input, { ...init, body: serialized, redirect: "error" });
        };
        const transport = toWorkerModel(spec, { fetchImpl: gatedFetch, reasoningEffort: "off", promptCache: false });
        const wireTools = (tools ?? []).map((tool) => ({ type: "function" as const, function: { name: tool.name, ...(tool.description !== undefined ? { description: tool.description } : {}), parameters: tool.parameters } }));
        yield* transport(messages, wireTools, { call: { signal } });
      } };
    },
  };
  return createLocalBackend({ workspace, dataDir, producer: config, verifier: config, ...(options.commandSandbox ? { commandSandbox: options.commandSandbox } : {}) });
}
