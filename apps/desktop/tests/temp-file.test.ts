// v11 主界面批：⌘V 粘贴落临时文件判卷（文件名消毒纯函数 + 字节校验 fail-visible）。
// 不触达 electron：sanitizePasteName 纯函数；saveTempFile 的字节校验先于 electron 动态导入。
import { describe, expect, it } from "vitest";
import { MAX_TEMP_BYTES, sanitizePasteName, saveTempFile } from "../src/main/temp-file";

describe("sanitizePasteName", () => {
  it("剥路径分隔符与控制字符，防穿越；限长 80", () => {
    expect(sanitizePasteName("../../evil.sh")).toBe(".._.._evil.sh");
    expect(sanitizePasteName("a/b\\c:d*e?f\"g<h>i|j.txt")).toBe("a_b_c_d_e_f_g_h_i_j.txt");
    expect(sanitizePasteName("bad\u0000name\n.png")).toBe("bad_name_.png");
    expect(sanitizePasteName("x".repeat(200))).toHaveLength(80);
  });
  it("空/全点/纯空白 = paste.bin", () => {
    expect(sanitizePasteName("")).toBe("paste.bin");
    expect(sanitizePasteName("   ")).toBe("paste.bin");
    expect(sanitizePasteName("...")).toBe("paste.bin");
  });
});

describe("saveTempFile 字节校验（fail-visible，不触达 electron）", () => {
  it("非字节 / 空内容 / 超帽都拒且原因可辨", async () => {
    expect((await saveTempFile("x.png", null)).ok).toBe(false);
    expect((await saveTempFile("x.png", "not-bytes")).ok).toBe(false);
    expect((await saveTempFile("x.png", new Uint8Array(0))).error).toContain("空");
    const big = new Uint8Array(MAX_TEMP_BYTES + 1);
    expect((await saveTempFile("x.png", big)).error).toContain("20MB");
  });
});
