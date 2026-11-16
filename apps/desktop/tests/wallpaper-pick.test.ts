// 壁纸选文件决策壳判卷（设计规格 §3.3）。
//
// 判的是什么：
//   ① 取消是**合法结果**（`canceled: true`），不是错误——用户反悔不该看到红字；
//   ② 选中的路径一定过校验（渲染层拿不到没验过的路径）；
//   ③ 面板的扩展名白名单与 `wallpaperKindOf` 的分类**同一组**（两处各自漂会被这条咬住）。
import { describe, expect, it } from "vitest";
import { WALLPAPER_PICK_FILTERS, pickWallpaper, wallpaperDialogOptions } from "../src/main/wallpaper-pick";
import { wallpaperKindOf } from "../src/main/wallpaper";

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"];
const VIDEO_EXT = [".mp4", ".webm", ".mov"];

describe("壁纸选文件", () => {
  it("取消 ⇒ canceled:true（合法结果，不校验、不报错）", async () => {
    let validated = 0;
    const result = await pickWallpaper({
      openDialog: async () => ({ canceled: true, filePaths: [] }),
      validate: async () => { validated += 1; return { ok: true }; },
    });
    expect(result).toEqual({ ok: false, canceled: true });
    expect(validated).toBe(0);
  });

  it("面板回空路径 ⇒ 同样按取消处理", async () => {
    const result = await pickWallpaper({
      openDialog: async () => ({ canceled: false, filePaths: [] }),
      validate: async () => ({ ok: true }),
    });
    expect(result.canceled).toBe(true);
  });

  it("选中路径 ⇒ 一定过校验（返回校验结果，不自己造答案）", async () => {
    const seen: string[] = [];
    const result = await pickWallpaper({
      openDialog: async () => ({ canceled: false, filePaths: ["/tmp/a.png"] }),
      validate: async (path) => { seen.push(path); return { ok: true, kind: "image", path }; },
    });
    expect(seen).toEqual(["/tmp/a.png"]);
    expect(result).toEqual({ ok: true, kind: "image", path: "/tmp/a.png" });
    // 校验失败照样原样回（错误文案来自 validate，不在这里另写一套）
    const bad = await pickWallpaper({
      openDialog: async () => ({ canceled: false, filePaths: ["/tmp/a.txt"] }),
      validate: async () => ({ ok: false, error: "只支持图片或视频文件" }),
    });
    expect(bad).toEqual({ ok: false, error: "只支持图片或视频文件" });
  });

  it("面板参数：单选 openFile + 与媒体分类同一组扩展名", async () => {
    const options = wallpaperDialogOptions();
    expect(options.properties).toEqual(["openFile"]);
    expect(options.title).toBe("选择壁纸");
    const listed = WALLPAPER_PICK_FILTERS.flatMap((f) => f.extensions).map((e) => `.${e}`).sort();
    expect(listed).toEqual([...IMAGE_EXT, ...VIDEO_EXT].sort());
    // 反向：白名单里每一个扩展名都被媒体层认得出（否则用户能选到、媒体层却拒）
    for (const ext of listed) expect(wallpaperKindOf(`/x${ext}`)).not.toBeNull();
  });
});
