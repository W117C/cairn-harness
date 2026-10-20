// 固定上游源码的离线同步：node apps/desktop/scripts/sync-dsh-claude-style.mjs <上游 checkout>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "484ece039400ab45a97e935abb5bc47245845a96";
if (!process.argv[2]) throw new Error("需要 dsh-claude-style 源码目录");
const source = resolve(process.argv[2]);
if (execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim() !== revision) {
  throw new Error(`上游必须固定在 ${revision}；升级时显式更新版本并重新验收`);
}
const renderer = fileURLToPath(new URL("../src/renderer/", import.meta.url));
const vendor = join(renderer, "vendor/dsh-claude-style");
const notices = join(renderer, "public/licenses/dsh-claude-style");
const files = [];
function copy(from, to, transform) {
  const input = readFileSync(join(source, from));
  const output = transform ? Buffer.from(transform(input.toString("utf8"))) : input;
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, output);
  files.push({ source: from, file: to.slice(renderer.length), sha256: createHash("sha256").update(input).digest("hex"), adapted: !!transform });
}
for (const name of ["tokens.json", "tokens.schema.json", "tokens.css", "hero.css"]) {
  copy(`packages/client/src/theme/${name}`, join(vendor, name));
}
// 只注册本次实际打包的 OFL 字体；移除上游私有字体和宿主 HTTP 字体路由的注册。
copy("packages/client/src/theme/typography.css", join(vendor, "typography.css"), (css) =>
  css.replace(/@font-face\s*\{[\s\S]*?\}\s*/g, ""));
for (const name of ["card", "vars"]) {
  copy(`packages/client/src/features/composer/${name}.css`, join(vendor, `composer-${name}.css`));
}
for (const name of ["InterVariable.woff2", "NotoSerifVariable.woff2", "JetBrainsMonoVariable.ttf", "JetBrainsMonoItalicVariable.ttf"]) {
  copy(`packages/assets/src/fonts/${name}`, join(vendor, "fonts", name));
}
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) copy(name, join(notices, name));
for (const name of ["OFL.txt", "OFL-Inter.txt", "OFL-NotoSerif.txt", "AUTHORS.txt"]) {
  copy(`packages/assets/src/fonts/${name}`, join(notices, name));
}
const tokens = JSON.parse(readFileSync(join(vendor, "tokens.json"), "utf8"));
const block = (selector, items, pick) => `${selector} {\n${items.flatMap((item) => {
  const value = pick(item);
  return value === undefined ? [] : [`  ${item.token}: ${value};`];
}).join("\n")}\n}\n`;
const scope = "body[data-dsh-claude-style]";
const css = [
  "/*! dsh-claude-style 0.17.0, Nwflower, MIT. Generated from upstream tokens.json. */\n",
  block(scope, [...tokens.motion, ...tokens.layer], (item) => item.value),
  block(scope, tokens.typeface, (item) => item.claude),
  ...["light", "dark"].flatMap((theme) => {
    const selector = scope + (theme === "dark" ? "[data-ds-dark-theme]" : ":not([data-ds-dark-theme])");
    return [block(selector, tokens.apex, (item) => item[theme]), block(selector, tokens.palette, (item) => item.claude?.[theme])];
  }),
].join("\n");
writeFileSync(join(vendor, "palette.css"), css);
writeFileSync(join(vendor, "UPSTREAM.json"), JSON.stringify({
  repository: "https://github.com/Nwflower/dsh-claude-style", version: "0.17.0", revision, files,
}, null, 2) + "\n");
console.log(`dsh-claude-style 0.17.0 @ ${revision}: ${files.length} 个源码/字体/许可文件已同步`);
