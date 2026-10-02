// 第 312 页的复现器：`lessonsSection` 那句「无出处的条目不会出现在这里」在**空指针**这一支上做不到。
//
// 已有判卷（`tests/memory-lessons.test.ts` E 组）钉的是「正文里**没有** `evidence-line:`」⇒ 不收。
// 这一格是它的兄弟支：行**在**、指针为空（`evidence-line:` 后面什么都没有）。
// 修之前：`parseLessonDigest` 只按"有没有那行"判 null ⇒ 空串带着 `evidence: ""` 往下走，
// 撞到 `lessonLine` 的抛；而三个生产调用点（glm-session / sidechat / worker-prompt）都把注入异常
// **静默吞掉** ⇒ 后果不是"这一条不注入"，是整段 LESSONS（含同批合格条目）消失且无人知道。
//
// 两栏各自出声，标签由**值**导出（不写死结论）：
//  栏一＝解析层：空指针算不算合格；
//  栏二＝注入层：一条空指针混在合格条目里，LESSONS 段还剩不剩东西。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildMemoryInjection } from "../../src/agent/memory/inject.ts";
import { parseLessonDigest } from "../../src/agent/memory/lessons.ts";
import { projectMemoryDir, writeTopic } from "../../src/agent/memory/store.ts";

const dir = await mkdtemp(join(tmpdir(), "dsh-lesson-empty-"));
const g = await mkdtemp(join(tmpdir(), "dsh-lesson-global-"));
try {
  const d1 = parseLessonDigest("空指针教训抬头\nevidence-line:");
  console.log(`栏一（解析层）：parseLessonDigest("…evidence-line:") = ${JSON.stringify(d1)}`
    + ` ⇒ 空指针${d1 === null ? "**不合格**（与「没有那行」走同一道门）" : "仍算合格（往下走会撞 lessonLine 的抛）"}`);

  const iso = "2026-10-03T00:00:00.000Z";
  await writeTopic(projectMemoryDir(dir), "lesson-good-1", "feedback",
    "合格教训抬头\nevidence-line:[验证红] sess-2026-10-03-abc#c1", iso);
  await writeTopic(projectMemoryDir(dir), "lesson-empty-1", "feedback",
    "空指针教训抬头\nevidence-line:", "2026-10-03T00:00:01.000Z");

  let outcome = "";
  let project = "";
  try {
    const inj = await buildMemoryInjection({ workspace: dir, globalRoot: g });
    project = inj.project ?? "";
    outcome = "没抛";
  } catch (e) {
    outcome = `抛了：${(e as Error).message}`;
  }
  const hasGood = project.includes("合格教训抬头") && project.includes("〔证据: [验证红] sess-2026-10-03-abc#c1〕");
  const hasEmptyLine = project.includes("〔证据: 〕");
  console.log(`栏二（注入层）：${outcome}｜合格那条连同证据指针可见=${String(hasGood)}`
    + `｜空指针被拼成「〔证据: 〕」=${String(hasEmptyLine)}`);
  console.log(`读法：合格可见 ${hasGood ? "成立" : "**不成立**（整段没了或被挤掉）"}`
    + `；空指针成行 ${hasEmptyLine ? "**成立**（那句承诺是假话）" : "不成立 ⇒ 它没进 LESSONS 段"}`);
  console.log("另记一格的边界：索引段（[MEMORY.md 索引]）列的是 topic 文件，与「有没有证据指针」无关 ⇒"
    + "「不会出现在这里」只对 LESSONS 段成立，对整块注入不成立。");
} finally {
  await rm(dir, { recursive: true, force: true });
  await rm(g, { recursive: true, force: true });
}
