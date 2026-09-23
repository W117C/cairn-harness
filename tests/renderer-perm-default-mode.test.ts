// 设置页「权限默认模式」的消费面（看板初值 / 档位↔行 id 别名表）。
//
// 这条簇起因是一处实测到的「有控件、没消费者」：设置页那格副标题写「新对话开始时使用的权限档」，
// 但看板的初值是 `PERM_MODES[1]`（按**下标**取），而 settings.mode 在渲染层只被用来点亮按钮的
// `aria-pressed`——于是把默认档设成「只读」再重启，看板仍是「标准」，每一笔 run 也仍按 default 发出去。
// 判卷重点在两半：① 档位↔看板行 id 的别名表只准有一份（今天 app.js 里那份与产品档位是抄本关系）；
// ② 回灌的**时机**判据（用户刚手动选过 / 设置认不出 / 与当前一致 ⇒ 一律不动，其余必须动）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_PERMISSION_MODES } from "../src/events";
import { PERMISSION_MODES } from "../src/permissions";
import {
  PERM_DEFAULT_ROW,
  PERM_ROW_BY_MODE,
  permModeMapByRow,
  permRowIdForMode,
  seedPermRowId,
} from "../src/renderer/projections";

const appSrc = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");

describe("档位 ↔ 看板行 id：别名表只此一份", () => {
  it("PERM_ROW_BY_MODE 覆盖每一档（少一档编译不过，这一条钉的是运行时对账）", () => {
    expect(Object.keys(PERM_ROW_BY_MODE).sort()).toEqual([...PERMISSION_MODES].sort());
    expect(Object.keys(PERM_ROW_BY_MODE).sort()).toEqual([...AGENT_PERMISSION_MODES].sort());
    for (const m of PERMISSION_MODES) expect(typeof PERM_ROW_BY_MODE[m]).toBe("string");
  });

  it("反向表与正向表互逆，且值集合 = 档位集合（新档在产品面可达的判据）", () => {
    const map = permModeMapByRow();
    expect(Object.values(map).sort()).toEqual([...PERMISSION_MODES].sort());
    for (const m of PERMISSION_MODES) {
      const row = PERM_ROW_BY_MODE[m];
      expect(map[row]).toBe(m);
    }
  });

  it("认不出的档位给 null，不给最松档也不给猜的一个", () => {
    expect(permRowIdForMode("chaos")).toBeNull();
    expect(permRowIdForMode(undefined)).toBeNull();
    expect(permRowIdForMode(null)).toBeNull();
    expect(permRowIdForMode(1)).toBeNull();
    expect(permRowIdForMode("constructor")).toBeNull();
  });

  it("app.js 的 PERM_MAP 由这只表派生，不再自己写一遍档名字面量", () => {
    const start = appSrc.indexOf("const PERM_MAP =");
    expect(start).toBeGreaterThanOrEqual(0);
    const line = appSrc.slice(start, appSrc.indexOf("\n", start));
    expect(line).toContain("permModeMapByRow()");
    for (const m of PERMISSION_MODES) expect(line).not.toContain("'" + m + "'");
  });
});

describe("seedPermRowId：什么时候回灌看板", () => {
  it("用户已经手动选过 ⇒ 不动（异步加载的设置不得盖掉刚点的那一下）", () => {
    expect(seedPermRowId({ storedMode: "read-only", currentRowId: PERM_DEFAULT_ROW, userChose: true })).toBeNull();
  });

  it("设置认不出 / 与当前行相同 ⇒ 不动（认不出时不降级到默认档，保持现场）", () => {
    expect(seedPermRowId({ storedMode: "chaos", currentRowId: PERM_DEFAULT_ROW, userChose: false })).toBeNull();
    expect(seedPermRowId({ storedMode: undefined, currentRowId: PERM_DEFAULT_ROW, userChose: false })).toBeNull();
    expect(
      seedPermRowId({ storedMode: "default", currentRowId: PERM_DEFAULT_ROW, userChose: false }),
    ).toBeNull();
    // 反向一侧：认不出时若偷偷回落到默认档，只有当前**不是**默认档才看得见——
    // 全部用 PERM_DEFAULT_ROW 当现值写，这条判据就永远绿（自己骗自己的典型形状）。
    expect(seedPermRowId({ storedMode: "chaos", currentRowId: "yolo", userChose: false })).toBeNull();
    expect(seedPermRowId({ storedMode: null, currentRowId: "strict", userChose: false })).toBeNull();
  });

  it("认得出且与当前不同 ⇒ 必须回灌（反向一侧：三档各给一行，静默不动就是这条红）", () => {
    expect(seedPermRowId({ storedMode: "read-only", currentRowId: PERM_DEFAULT_ROW, userChose: false })).toBe("strict");
    expect(seedPermRowId({ storedMode: "guided", currentRowId: PERM_DEFAULT_ROW, userChose: false })).toBe("guided");
    expect(seedPermRowId({ storedMode: "auto", currentRowId: PERM_DEFAULT_ROW, userChose: false })).toBe("yolo");
  });
});

describe("看板初值不再按数组下标取", () => {
  it("初值走 id 查表：插一档不会把默认档挪位", () => {
    expect(appSrc).not.toContain("let permMode = PERM_MODES[1]");
    expect(appSrc).toContain("permRowById(");
    expect(PERM_DEFAULT_ROW).toBe("standard");
  });

  it("看板行的 id 集与别名表的键集同源（少一行 = 设置里的档在产品面不可选）", () => {
    const start = appSrc.indexOf("const PERM_MODES = [");
    expect(start).toBeGreaterThanOrEqual(0);
    const block = appSrc.slice(start, appSrc.indexOf("];", start));
    const ids = [...block.matchAll(/id: '([^']+)'/g)].map((m) => m[1]).sort();
    expect(ids).toEqual(Object.keys(permModeMapByRow()).sort());
  });
});
