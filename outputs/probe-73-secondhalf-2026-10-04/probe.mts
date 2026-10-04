import { buildSkillRoutingList, SKILL_ROUTING_CHAR_LIMIT } from "../../src/agent/plugins/skills.ts";
const skills = [
  { plugin: "a", name: "one", description: "短描述" },
  { plugin: "a", name: "two", description: "x".repeat(2000) },
  { plugin: "b", name: "three", description: "y".repeat(2000) },
  { plugin: null, name: "loose", description: "散装" },
];
const r = buildSkillRoutingList(skills);
console.log("cap =", SKILL_ROUTING_CHAR_LIMIT, " len =", r.text.length, " truncated =", r.truncated);
console.log("---- text ----");
console.log(r.text);
console.log("---- end ----");
const has = (t: string, line: string) => t.split("\n").includes("- " + line.replace(/^- /, ""));
console.log("skillListHas(text, '/loose — 散装') =", has(r.text, "/loose — 散装"));
