// 字节刻度（第 924 页）：附件行与日志窗必须读同一份实现，且 1 MB 门口不许写出四位数。
import { describe, expect, it } from "vitest";
import { formatBytes } from "../src/renderer/derived/format-bytes";
import { formatSize } from "../src/renderer/components/Composer";

describe("formatBytes：一把尺（B/KB/MB，一位小数）", () => {
  it("三档与一位小数", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });

  it("1 MB 门口不写四位数：1024.0 KB 进位成 1.0 MB", () => {
    expect(formatBytes(1048575)).toBe("1.0 MB");
    expect(formatBytes(1048570)).toBe("1.0 MB");
    expect(formatBytes(1047552)).toBe("1023.0 KB"); // 1023 × 1024
  });

  it("非法与负数返回 null（不冒充 0）", () => {
    expect(formatBytes(Number.NaN)).toBeNull();
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
  });

  it("两个调用面读同一份：附件行 formatSize 与日志窗同口径", () => {
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(512)).toBe("512 B"); // 此前是没单位的裸数 "512"
    expect(formatSize(Number.NaN)).toBe("—"); // 附件行拿不到大小：破折号，不显示 0 B
  });
});
