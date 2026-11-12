// 读面失败收口（第 1087 页）：设置相关读取把拒绝折成结果，不折成默认值/空态。
import { describe, expect, it } from "vitest";
import { readOrError } from "../src/renderer/read-result";

describe("readOrError", () => {
  it("成功：原值透传", async () => {
    await expect(readOrError(async () => ({ webAutoApprove: true }))).resolves.toEqual({
      ok: true,
      value: { webAutoApprove: true },
    });
  });

  it("拒绝：转成 {ok:false,error}，不抛出、不折成 undefined", async () => {
    await expect(readOrError(async () => { throw new Error("IPC down"); })).resolves.toEqual({
      ok: false,
      error: "IPC down",
    });
  });

  it("非 Error 拒绝：String 化，仍可上屏", async () => {
    await expect(readOrError(async () => { throw "boom"; })).resolves.toEqual({
      ok: false,
      error: "boom",
    });
  });
});
