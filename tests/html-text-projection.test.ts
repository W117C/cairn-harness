import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { htmlToText } from "../src/tools/web_fetch";

it.each([
  ['<script>if (1 < 2) boot();</script><p>visible content</p>', "visible content"],
  ['<p>before</p><script>const html = "<div";</script><p>after</p>', "before\n\nafter"],
])("HTML raw text closes at the actual end tag: %s", (html, expected) => {
  expect(htmlToText(html)).toBe(expected);
});

it("malformed tag prefixes cannot cause quadratic synchronous parsing", () => {
  const moduleUrl = new URL("../src/tools/web_fetch.ts", import.meta.url).href;
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { htmlToText } from ${JSON.stringify(moduleUrl)};
    for (const unit of ['<', '< ']) {
      const input = unit.repeat(200000) + '>';
      assert.equal(htmlToText(input), input.trim());
    }
    console.log('linear-control-ok');
  `], { encoding: "utf8", timeout: 3000 });
  expect(output.trim()).toBe("linear-control-ok");
});
