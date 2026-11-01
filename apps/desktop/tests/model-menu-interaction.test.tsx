import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelMenu, modelMenuLayout } from "../src/renderer/components/ModelPicker";

describe("模型弹层的空间与键盘语义", () => {
  it("靠近窗口顶部时向下开，保留标题栏和窗口边距", () => {
    expect(modelMenuLayout(100, 132, 600)).toEqual({ up: false, maxHeight: 460 });
    expect(modelMenuLayout(620, 652, 700)).toEqual({ up: true, maxHeight: 560 });
    expect(modelMenuLayout(120, 152, 240)).toEqual({ up: false, maxHeight: 184, viewportTop: 44 });
    expect(modelMenuLayout(238, 270, 420)).toEqual({ up: false, maxHeight: 364, viewportTop: 44 });
  });

  it("两边都有空间时取空间大的一边（真机形态：上 327 / 下 453 该向下开）", () => {
    // 1440×864 空屏上 composer 触发器实测 top=371 bottom=403。
    // 旧判据 `above >= min(320, below)` 会向上开并把列表挤成 139px（内容 209px），
    // 最后一个 provider 的组头露着、它那一行模型整行看不见 ⇒ 读起来是空分组。
    expect(modelMenuLayout(371, 403, 864)).toEqual({ up: false, maxHeight: 453 });
    // 反向自证：镜像过来（上多下少）就该向上开，规则不是"一律向下"。
    expect(modelMenuLayout(600, 632, 864).up).toBe(true);
    // 单调性：任何一侧空间更大，就不许选另一侧（扫一遍，不靠单点）。
    let worst = "";
    for (let top = 60; top <= 800; top += 7) {
      const { up, maxHeight } = modelMenuLayout(top, top + 32, 864);
      const above = Math.max(0, Math.min(560, Math.floor(top - 44)));
      const below = Math.max(0, Math.min(560, Math.floor(864 - top - 32 - 8)));
      if (Math.max(above, below) < 260) continue; // 矮窗口那档走窗口内浮层
      const want = above >= below ? above : below;
      if (maxHeight !== want) worst = `top=${top} 选到 ${maxHeight}，应 ${want}`;
    }
    expect(worst, "弹层选边与空间不一致：" + worst).toBe("");
  });

  it("搜索框关联独立列表与当前焦点行，思考控件不属于列表", () => {
    const html = renderToStaticMarkup(<ModelMenu
      options={[
        { registryId: "a", provider: "deepseek", label: "Model A", ctxWindow: 128000, tier: "standard" },
        { registryId: "b", provider: "deepseek", label: "Model B" },
      ]}
      value="b" onPick={() => undefined} thinkingSupported onThinkingChange={() => undefined}
    />);
    expect(html).toContain('role="combobox"');
    const list = html.match(/id="([^"]+)" class="mp-models" role="listbox"/);
    expect(list).not.toBeNull();
    expect(html).toContain(`aria-controls="${list![1]}"`);
    const active = html.match(/aria-activedescendant="([^"]+)"/);
    expect(active).not.toBeNull();
    expect(html).toContain(`id="${active![1]}"`);
    expect(html).toMatch(/data-highlighted="true"[^>]*><span class="mi-name">Model B/);
    expect(html.indexOf('class="mp-controls"')).toBeGreaterThan(html.indexOf('class="mp-models"'));
    expect(html).not.toContain('class="th-hint"');
    expect(html).toContain('title="标准 · 窗口 128.0k"');
  });
});
