// 预览失败 → 错误条载荷（纯投影，2026-11-02 真机订正）。
//
// 缺陷本体（真机截图）：预览失败时错误条上是这么一行：
//   「预览失败（spec）：这个文件夹里有网页，但没有入口页 index.html——根目录的网页：pelican-bicycle.html
//     ——把主页改名成 index.html（或新增一个）再导入一次，静态预览按这个名字找首页。」
// 三处毛病：
//   ① 内部代号漏给用户：「spec」是协议里的阶段枚举（spec/prepare/start/ready），对人没有含义；
//   ② 三件不同的事被拍成一行：结论 / 依据 / 下一步 用「——」串着，读者分不出哪句是哪句；
//   ③ 最该被看见的「下一步」被压在最后。
//
// 改法：阶段翻成人话，三件事分三个字段走，渲染层分行渲染（ErrorStrip 的结构化形态）。
import type { PreviewSnapshot } from "../../../../src/main/project-preview";
import type { SurfaceError } from "./surface-error";
import { STR } from "./strings";

/** 预览阶段的人话：协议里的枚举 → 用户读得懂的这一步。 */
export function previewStageLabel(stage: PreviewSnapshot["stage"]): string {
  switch (stage) {
    case "spec":
      return STR.preview.stageSpec;
    case "prepare":
      return STR.preview.stagePrepare;
    case "start":
      return STR.preview.stageStart;
    case "ready":
      return STR.preview.stageReady;
    default:
      return STR.preview.stageUnknown;
  }
}

/** 预览失败 → 结构化错误载荷（纯函数，可判卷）。 */
export function previewFailureError(snapshot: PreviewSnapshot): SurfaceError {
  const error: SurfaceError = {
    title: `${STR.preview.failedTitle} · ${previewStageLabel(snapshot.stage)}`,
  };
  if (snapshot.message !== undefined && snapshot.message !== "") error.body = snapshot.message;
  if (snapshot.reasons !== undefined && snapshot.reasons.length > 0) error.reasons = [...snapshot.reasons];
  if (snapshot.hint !== undefined && snapshot.hint !== "") error.next = snapshot.hint;
  return error;
}
