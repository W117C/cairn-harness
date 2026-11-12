// 第 1141 页：MCP/Hooks 集成设置的行表与选中项按输入记忆。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("设置集成行表记忆", () => {
  it("MCP selected 与 Hooks rows/selected useMemo", () => {
    expect(src).toContain("const EMPTY_SERVERS: Server[] = [];");
    expect(src).toContain("const selected = useMemo(() => servers.find((server) => server.name === selectedName), [servers, selectedName]);");
    expect(src).toContain("const rows = useMemo(() => config ? rowsOf(config.hooks) : [], [config]);");
    expect(src).toContain("const selected = useMemo(() => rows.find((row) => row.event === target?.event && row.index === target?.index)");
  });
});
