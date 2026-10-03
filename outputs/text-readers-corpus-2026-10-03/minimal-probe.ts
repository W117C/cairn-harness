import { scanJudgeForCorpusReaders, scanJudgeForReaders } from "../../scripts/lib/text-readers.ts";
const J = "tests/env-cue-single-source.test.ts";
const c = (label: string, src: string) => {
  const s = scanJudgeForCorpusReaders(J, src);
  console.log(label, JSON.stringify({ corpus: s.corpus, local: s.local, unknown: s.unknown, shapes: s.shapes, faces: s.faces }));
};
c("A join(REPO)  ", 'const X = join(REPO, "scripts/replay");\nreaddirSync(X);\n');
c("B url const   ", 'const X = fileURLToPath(new URL("../scripts/replay", import.meta.url));\nreaddirSync(X);\n');
c("C inline url  ", 'readdirSync(fileURLToPath(new URL("../scripts/replay", import.meta.url)));\n');
c("D inline join ", 'readdirSync(join(REPO, "scripts/replay"));\n');
console.log("reader classify of bare ident:", JSON.stringify(scanJudgeForReaders(J, 'readFileSync(X, "utf8");\n', () => true).hits[0]));
console.log("reader classify of url expr  :", JSON.stringify(scanJudgeForReaders(J, 'readFileSync(fileURLToPath(new URL("../scripts/replay", import.meta.url)), "utf8");\n', () => true).hits[0]));
