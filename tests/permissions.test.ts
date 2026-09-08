import { describe, expect, it } from "vitest";
import { checkPermission, gate } from "../src/permissions";

describe("权限门", () => {
  it("read-only 档 write_file → deny", () => {
    expect(checkPermission("read-only", "write_file")).toBe("deny");
    expect(gate("read-only", "write_file", true)).toBe("deny");
    expect(gate("read-only", "write_file", false)).toBe("deny");
  });

  it("default 档 run_shell → ask；非交互被拒（fail-closed）", () => {
    expect(checkPermission("default", "run_shell")).toBe("ask");
    expect(gate("default", "run_shell", false)).toBe("deny");
    // 交互模式下 ask 保持 ask，等人拍板
    expect(gate("default", "run_shell", true)).toBe("ask");
  });

  it("read_file 任何档都放行；auto 档全放行", () => {
    expect(checkPermission("read-only", "read_file")).toBe("allow");
    expect(checkPermission("default", "read_file")).toBe("allow");
    for (const tool of ["read_file", "write_file", "run_shell"] as const) {
      expect(gate("auto", tool, false)).toBe("allow");
    }
  });
});
