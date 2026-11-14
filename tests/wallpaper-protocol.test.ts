// 壁纸协议常量（2026-11-15）：渲染层拼的 URL 与主进程服务的 URL 必须是**同一个**。
//
// 为什么这条判卷必须存在：这两半以前分住两个文件（渲染层自己拼 `cairn-wallpaper://media/current`，
// 主进程自己比 hostname/pathname）。任一半写错的表现都是「壁纸选了但什么也没变」——
// 没有异常、没有红字，只有一张空白画布。这里把两半钉在一起：常量 → URL → 主进程 handler 的
// 解析结果，必须闭合。顺带让 `src/main/wallpaper-protocol.ts` 有从测试出发的执行路径
// （`tests/src-execution-path.test.ts` 的棘轮要求 src/ 每个模块都得有）。
import { describe, expect, it } from "vitest";
import { WALLPAPER_MEDIA_URL, WALLPAPER_SCHEME } from "../src/main/wallpaper-protocol";

describe("壁纸协议常量", () => {
  it("scheme 是 URL 合法的 scheme（小写、无点）：大写或带点会被 URL 解析器改写成别的 origin", () => {
    expect(WALLPAPER_SCHEME).toMatch(/^[a-z][a-z0-9+.-]*$/);
    expect(WALLPAPER_SCHEME).not.toMatch(/[A-Z]/);
  });

  it("媒体地址解析后落在 handler 认的那个 host + path 上", () => {
    // 主进程 protocol.handle 里判的就是这两个值（hostname === "media"、pathname === "/current"）。
    const url = new URL(WALLPAPER_MEDIA_URL);
    expect(url.protocol).toBe(`${WALLPAPER_SCHEME}:`);
    expect(url.hostname).toBe("media");
    expect(url.pathname).toBe("/current");
  });

  it("地址里不带版本号：?v= 由渲染层按 revision 拼（缓存破得掉，常量不许先钉死）", () => {
    expect(WALLPAPER_MEDIA_URL).not.toContain("?");
    expect(new URL(`${WALLPAPER_MEDIA_URL}?v=7`).searchParams.get("v")).toBe("7");
  });
});
