import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { composerLockReason } from "../src/renderer/send-queue";
import { Composer } from "../src/renderer/components/Composer";
import { QueueDock } from "../src/renderer/panes/QueueDock";

const noop = () => undefined;
describe("会话尚未完整读取时的写入保护", () => {
  it("读取失败继续锁住输入，不依赖请求是否仍在进行", () => {
    expect(composerLockReason({ creating: false, gateActive: false, sessionLoadFailed: true })).toBe("session");
    expect(composerLockReason({ creating: false, gateActive: false, sessionLoadFailed: false })).toBeNull();
  });
  it("输入框说明读取失败需要重试，不冒充仍在加载", () => {
    const html = renderToStaticMarkup(<Composer
      disabled disabledReason="session" mode="default" activeId="s1" providerInfo={null} pickerValue={null}
      usage={{ inputTokens: 0, outputTokens: 0, usageCount: 0, cacheReadTokens: 0, lastInputTokens: 0 }}
      events={[]}
      phaseLabel="" phase="idle" elapsedSec={0} steps={0} running={false} stopped={false}
      onSend={noop} onCancel={noop} onModeChange={noop} onModelChange={noop} onCompact={noop}
    />);
    const textarea = html.match(/<textarea[^>]*>/)?.[0] ?? "";
    expect(textarea).toContain("disabled");
    expect(textarea).toContain("会话未读取完成，请先重试");
  });
  it("读取期间缓存队列仍可见，但所有改写和派发按钮禁用", () => {
    const html = renderToStaticMarkup(<QueueDock
      activeId="s1" activeWorkspace="/tmp/ws"
      queue={{ current: new Map([['["/tmp/ws","s1"]', [{ id: 1, text: "保留的排队消息", attachments: [] }]]]) }}
      running queueLoading pendingSend={false} pendingClarify={null} pendingPlan={null}
      setQueueFor={noop} cancelRunHeal={noop} resumeQueueFor={noop}
    />);
    expect(html).toContain("保留的排队消息");
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.includes("disabled"))).toBe(true);
    expect(html).toContain("会话未读取完成，队列暂不可修改");
  });
});
