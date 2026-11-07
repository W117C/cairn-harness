// 「用户自己声明某模型的思考能力」在桌面端的判卷（2026-11-03，业主：「让用户可以自己配置模型思考能力」）。
//
// 两条链各钉一头，中间不留没人看的一跳：
//   ① 声明 → 存盘载荷（纯函数）：勾选 × 每模型声明 ⇒ `reasoningEfforts` / `reasoningDefault`；
//   ② 声明 → capability → 模型菜单（**整条链走真函数**：providers.json → 派生 → 安装 → ProviderInfo
//      → flattenModels → ModelMenu）：声明过的模型只出它声明的档、默认档 = 声明里的首选档；
//      没声明的照旧整段禁用（fail-visible，不谎称可调）。
// 反向自证：把 capabilities.ts 里消费声明的那行换回硬编码 "off"、或把表单里 `thinking` 那一路
// 摘掉 ⇒ 对应那条变红（读数见 `.tmp/audit-design/thinking/REVERSE.md`）。
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelMenu, flattenModels } from "../src/renderer/components/ModelPicker";
import {
  ModelPickModal,
  declarationPayload,
  initialDeclarations,
  modelsFromPicker,
} from "../src/renderer/components/CustomProviderForm";
import { deriveCustomProviders, parseCustomProviders } from "../../../src/providers/provider-config";
import { effectiveModelTable, installCustomProviders, lookupModel } from "../../../src/providers/registry";
import { buildProviderInfo } from "../../../src/main/provider-runtime";
import { readRendererFile } from "./helpers/app-surface";

type Row = { id: string; origin: "discovery" | "catalog" | "both"; contextWindow?: number; reasoningEfforts?: readonly string[] };

const ROWS: readonly Row[] = [
  { id: "chat", origin: "discovery", contextWindow: 131_072, reasoningEfforts: ["low", "high"] },
  { id: "coder", origin: "catalog", contextWindow: 65_536 },
  { id: "video", origin: "both" },
];

function configWith(models: readonly Record<string, unknown>[]): unknown {
  return {
    version: 1,
    providers: [
      {
        id: "myprovider",
        label: "我的模型",
        protocol: "openai",
        baseURL: "https://api.example.com/v1",
        apiKeyEnv: "MYPROVIDER_API_KEY",
        models,
      },
    ],
  };
}

/** 落盘形状 → 装进注册表 → 按**真的** ProviderInfo 面铺出模型菜单的选项。 */
function menuOptionsFrom(raw: unknown, registryId: string): ReturnType<typeof flattenModels> {
  const parsed = parseCustomProviders(raw);
  if (!parsed.ok) throw new Error("本用例期望校验通过，实际失败：" + JSON.stringify(parsed.problems));
  installCustomProviders(deriveCustomProviders(parsed.file));
  const spec = lookupModel(effectiveModelTable(), registryId);
  if (spec === undefined) throw new Error(`派生表里没有 ${registryId}`);
  const info = buildProviderInfo({ kind: "custom", providerId: "myprovider", spec, modelExplicit: true });
  return flattenModels([info]);
}

afterEach(() => {
  installCustomProviders([]);
});

describe("声明 → 存盘载荷（纯函数）", () => {
  it("勾选的行带上它自己的声明；没勾的行不进载荷", () => {
    const payload = modelsFromPicker(
      ROWS,
      { chat: true, coder: false, video: true },
      { chat: { levels: ["low", "high"], default: "high" }, video: { levels: [], default: "off" } },
    );
    expect(payload.map((m) => m.id)).toEqual(["chat", "video"]);
    expect(payload[0]).toMatchObject({ id: "chat", contextWindow: 131_072, reasoningEfforts: ["low", "high"], reasoningDefault: "high" });
    // 空档位 = 明确「不支持」：**不写** reasoningEfforts（写了就等于声明支持）
    expect(payload[1].reasoningEfforts).toBeUndefined();
    expect(payload[1].reasoningDefault).toBeUndefined();
  });

  it("档位顺序与首选档一律走同一条规范化；首选为「关」= 不落盘（缺席即关）", () => {
    expect(declarationPayload({ levels: ["high", "low", "turbo"], default: "high" })).toEqual({
      reasoningEfforts: ["low", "high"], // 低→高；认不出的 turbo 不落盘
      reasoningDefault: "high",
    });
    expect(declarationPayload({ levels: ["medium"], default: "off" })).toEqual({ reasoningEfforts: ["medium"] });
    expect(declarationPayload(undefined)).toEqual({});
  });

  it("编辑回填：已存的手写声明优先，没存过的才用探测值", () => {
    const decls = initialDeclarations(ROWS, [
      { id: "chat", reasoningEfforts: ["low", "medium", "high", "max"], reasoningDefault: "max" },
    ]);
    expect(decls.chat).toEqual({ levels: ["low", "medium", "high", "max"], default: "max" }); // 手写的赢过探测的 [low,high]
    expect(decls.coder).toEqual({ levels: [], default: "off" }); // 两处都没有 ⇒ 空声明
  });
});

describe("声明 → capability → 模型菜单（整条链走真函数）", () => {
  it("声明了 [low,high] + 首选 high ⇒ 菜单只出这三档，默认档就是声明里的首选档", () => {
    const options = menuOptionsFrom(
      configWith([
        { id: "chat", model: "deepseek-chat", contextWindow: 131_072, reasoningEfforts: ["low", "high"], reasoningDefault: "high" },
      ]),
      "myprovider-chat",
    );
    const opt = options.find((o) => o.registryId === "myprovider-chat");
    expect(opt?.thinkingLevels).toEqual(["off", "low", "high"]);
    expect(opt?.thinkingDefault).toBe("high"); // ★ 声明说的，不是硬编码的 off
    const html = renderToStaticMarkup(
      <ModelMenu
        options={options}
        value="myprovider-chat"
        onPick={() => undefined}
        thinking={opt?.thinkingDefault}
        thinkingLevels={opt?.thinkingLevels}
        thinkingSupported
        onThinkingChange={() => undefined}
        initialFocus="effort"
      />,
    );
    expect(html).toContain('data-e="off"');
    expect(html).toContain('data-e="low"');
    expect(html).toContain('data-e="high"');
    expect(html).not.toContain('data-e="medium"'); // 该模型没声明 medium：不给能选到
    expect(html).not.toContain("当前模型不支持思考强度"); // 声明过 ⇒ 不摆那道禁用注记
  });

  it("没声明的模型 ⇒ 思考面空态（fail-visible，不摆假按键）", () => {
    const options = menuOptionsFrom(
      configWith([{ id: "coder", model: "deepseek-coder", contextWindow: 65_536 }]),
      "myprovider-coder",
    );
    const opt = options.find((o) => o.registryId === "myprovider-coder");
    expect(opt?.thinkingLevels).toBeUndefined();
    expect(opt?.thinkingDefault).toBeUndefined();
    const html = renderToStaticMarkup(
      <ModelMenu
        options={options}
        value="myprovider-coder"
        onPick={() => undefined}
        thinking="off"
        thinkingSupported={false}
        onThinkingChange={() => undefined}
        initialFocus="effort"
      />,
    );
    expect(html).not.toContain('data-e='); // 没有可摆的档位行（不摆假按键）
    expect(html).not.toContain("disabled"); // 也没有被禁用的行——是空态不是禁用
    expect(html).toContain("当前模型不支持思考强度"); // 且明说为什么
  });
});

describe("设置表单里的那一格（勾选四档 + 首选档）", () => {
  const FINAL_MODAL = (thinking: Record<string, { levels: string[]; default: string }>): string =>
    renderToStaticMarkup(
      <ModelPickModal
        rows={ROWS}
        selected={{ chat: true, coder: false, video: true }}
        onChange={() => undefined}
        onDone={() => undefined}
        thinking={thinking}
        onThinkingChange={() => undefined}
      />,
    );

  it("勾选的行出四档按钮与首选档；未勾选的行不出这一格", () => {
    const html = FINAL_MODAL({ chat: { levels: ["low", "high"], default: "high" }, video: { levels: [], default: "off" } });
    expect(html).toContain('aria-label="chat 的思考档位"');
    expect(html).toContain('aria-label="chat 的首选思考档"');
    expect(html).not.toContain('aria-label="coder 的思考档位"'); // coder 没勾选
    // 选中态走 aria-pressed（与菜单里的思考段同一读法）：勾了两档 ⇒ 恰好两个 true
    const chatGroup = html.slice(html.indexOf('aria-label="chat 的思考档位"'), html.indexOf('aria-label="video 的思考档位"'));
    expect((chatGroup.match(/aria-pressed="true"/g) ?? []).length).toBe(2);
    expect(chatGroup).toContain('<option value="high"');
  });

  it("空档位 = 不支持：明说（不许让用户以为这只是显示问题）", () => {
    const html = FINAL_MODAL({ chat: { levels: [], default: "off" }, video: { levels: [], default: "off" } });
    expect(html).toContain("未勾选档位 = 该模型不支持思考");
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(0);
  });

  it("接线：表单把声明交给弹窗、把载荷交给 providerSave", () => {
    const src = readRendererFile("components/CustomProviderForm.tsx");
    expect(src).toContain("thinking={thinking}");
    expect(src).toContain("onThinkingChange={(id, next) => setThinking((cur) => ({ ...cur, [id]: next }))}");
    expect(src).toContain("const models = modelsFromPicker(discovered.rows, selected, thinking, overrides);");
    expect(src).toContain("setThinking(initialDeclarations(r.rows, props.editing?.models));");
  });
});
