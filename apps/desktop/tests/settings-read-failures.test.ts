// 设置读面失败不再折成默认值（第 1087 页）：
//   · SettingsPanel 的 providerKeyStatus 读失败，旧实现留默认 {stored:[]} ⇒ 界面显示「尚未存储 key」；
//   · NetworkSection 的 getSettings 读失败，旧实现留 webAuto=false ⇒ 界面显示「联网免批未开启」；
//   · WorkbenchOverlays 设置保存后的 getSettings 回灌失败，旧实现静默 ⇒ 主界面状态停在旧值。
// 三处都改走 readOrError（纯函数判卷在 read-result.test.ts），这里钉接线与文案值锚。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();

describe("设置读面失败不再折成默认值（第 1087 页）", () => {
  it("providerKeyStatus 读取走 readOrError + 密钥状态读取失败文案", () => {
    expect(app).toContain("readOrError(() => window.agent.providerKeyStatus())");
    expect(app).toContain("STR.settingsPanel.keyStatusReadFailedPrefix + r.error");
    // 旧静默形不许回来（then 直接 setStatus + catch 吞）
    expect(app).not.toContain("providerKeyStatus().then((s) => setStatus");
  });

  it("NetworkSection 的 getSettings 读取走 readOrError + 联网免批读取失败文案", () => {
    expect(app).toContain("readOrError(() => window.agent.getSettings())");
    expect(app).toContain("STR.network.webAutoLoadFailedPrefix + r.error");
    expect(app).not.toContain("getSettings().then((s) => { if (alive.current) setWebAuto");
  });

  it("WorkbenchOverlays 保存后回灌失败上屏，不再静默吞", () => {
    expect(app).toContain("STR.settingsPanel.liveRefreshFailedPrefix + r.error");
    expect(app).not.toContain("setCtrlTabCycle(s.ctrlTabCycle);\n              }).catch(() => undefined);");
  });

  // 第 1088 页：getProviderInfo 失败旧实现 setPvInfo(null) ⇒ ProviderSection 收到空 providers，
  // 界面看起来像「一个供应商都没有」；改走 readOrError + 供应商列表读取失败文案。
  it("getProviderInfo 读取失败走 readOrError + 供应商列表读取失败文案", () => {
    expect(app).toContain("readOrError(() => window.agent.getProviderInfo())");
    expect(app).toContain("STR.settingsPanel.providerInfoReadFailedPrefix + r.error");
    expect(app).not.toContain("window.agent.getProviderInfo().then(setPvInfo).catch(() => setPvInfo(null))");
  });

  // 第 1089 页：工作台首读 getSettings 失败旧实现 .catch(() => undefined) ⇒ mode/theme/ctrlTabCycle
  // 全停在默认值，界面看起来像「设置就是默认档」。改走 readOrError + 设置读取失败文案。
  it("工作台首读 getSettings 失败上屏，不静默用默认档", () => {
    expect(app.split("readOrError(() => window.agent.getSettings())").length - 1).toBeGreaterThanOrEqual(3);
    expect(app).toContain("STR.errors.settingsLoadFailedPrefix + r.error");
    expect(app).not.toContain("setUiSize(s.uiSize);\n    }).catch(() => undefined);");
  });

  // 第 1090 页：设置页 getState / capabilities 读失败也不许静默——旧实现分别把 about/settingsIssue
  // 置 null、把 cap 置 null；ProviderSection 的搜索行遇到 cap=null 会永远显示「正在读取配置…」。
  it("getState / capabilities 读取失败走 readOrError + 错误文案", () => {
    expect(app).toContain("readOrError(() => window.agent.getState())");
    expect(app).toContain("STR.settingsPanel.stateReadFailedPrefix + r.error");
    expect(app).toContain("readOrError(() => window.agent.capabilities())");
    expect(app).toContain("STR.settingsPanel.capabilitiesReadFailedPrefix + r.error");
    expect(app).not.toContain("capabilities().then(setCap).catch(() => setCap(null))");
    expect(app).toContain("capError={capError}");
    expect(app).toContain("STR.provider.capReadFailedPrefix + props.capError");
  });
});
