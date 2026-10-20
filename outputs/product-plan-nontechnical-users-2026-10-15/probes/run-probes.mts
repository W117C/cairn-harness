// 第一批第 5 条：两条运行可行性探针（静态网页 / React 小工具）。
//
// 边界先说清楚：这不是"干净机器"验证——用的是本机已装的 Node 与 pnpm；"干净"指的是
// 全新临时目录 + 全新依赖解析（react/vite 真装真起），不碰仓库已有 node_modules。
// 结论只覆盖：模板 → 目录 → 预览运行时 → HTTP 200 这条链。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectFromTemplate } from "../../../src/main/project-templates";
import { PreviewRuntime } from "../../../src/main/project-preview";

const results: { probe: string; ok: boolean; detail: string }[] = [];
const parent = mkdtempSync(join(tmpdir(), "cairn-probe-"));
const runtime = new PreviewRuntime();

async function probe(templateId: "static-site" | "react-vite"): Promise<void> {
  const made = createProjectFromTemplate({ name: templateId, parentDir: parent, templateId });
  if (!made.ok) {
    results.push({ probe: templateId, ok: false, detail: `建项目失败：${made.message}` });
    return;
  }
  const started = Date.now();
  const snap = await runtime.start(made.path);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (snap.status !== "ready" || snap.url === undefined) {
    results.push({ probe: templateId, ok: false, detail: `预览未就绪：${snap.status} ${snap.stage ?? ""} ${snap.message ?? ""} ${snap.hint ?? ""}` });
    return;
  }
  try {
    const res = await fetch(snap.url);
    const html = await res.text();
    const ok = res.status === 200 && html.length > 0;
    results.push({ probe: templateId, ok, detail: `${res.status} · ${String(html.length)} 字节 · ${seconds}s 到就绪（${snap.url}）` });
  } catch (err) {
    results.push({ probe: templateId, ok: false, detail: `抓取失败：${err instanceof Error ? err.message : String(err)}` });
  } finally {
    await runtime.stop(made.path);
  }
}

await probe("static-site");
await probe("react-vite");
await runtime.stopAll();
rmSync(parent, { recursive: true, force: true });

for (const r of results) {
  console.log(`[probe] ${r.ok ? "PASS" : "FAIL"} ${r.probe}: ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`[probe] ${String(results.length - failed.length)}/${String(results.length)} passed`);
process.exit(failed.length === 0 ? 0 : 1);
