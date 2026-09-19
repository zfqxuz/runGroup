// 生成回归测试的 expected.json（鬼屋 / 湖之仆从 / 一梦）。
// - 湖之仆从：手工核对过的官方 PDF 数值块 + 规则推导 HP/MP
// - 鬼屋 / 一梦：解析存储的 yaml module-npc 块，作为“AI 已给出 statText”的真实路径
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../test/fixtures/module-parse/regression");

function derivedHp(attrs) { return Math.max(1, Math.floor(((attrs.con ?? 50) + (attrs.siz ?? 50)) / 10)); }
function derivedMp(attrs) { return Math.floor((attrs.pow ?? 50) / 5); }

function fromYamlBlocks(moduleId) {
  const text = readFileSync(join(root, moduleId, "files", "module.md"), "utf8");
  const npcs = [];
  const seen = new Set();
  for (const match of text.matchAll(/```yaml module-npc\n([\s\S]*?)```/g)) {
    const block = match[1];
    let data;
    try { data = parseYaml(block); } catch { continue; }
    if (data === null || typeof data !== "object" || typeof data.name !== "string") continue;
    if (data.attributes === null || typeof data.attributes !== "object") continue;
    const attributes = {};
    for (const [key, value] of Object.entries(data.attributes)) {
      if (typeof value === "number" && ["str","con","siz","dex","app","int","pow","edu","luck"].includes(key)) attributes[key] = Math.floor(value);
    }
    if (Object.keys(attributes).length < 3) continue;
    if (seen.has(data.name)) continue;
    seen.add(data.name);
    npcs.push({
      name: data.name,
      attributes,
      hp: typeof data.hp === "number" ? data.hp : derivedHp(attributes),
      mp: typeof data.mp === "number" ? data.mp : derivedMp(attributes),
      statText: block
    });
  }
  return { entriesOnly: true, npcs };
}

writeFileSync(join(root, "鬼屋", "expected.json"), JSON.stringify(fromYamlBlocks("鬼屋"), null, 2));
writeFileSync(join(root, "一梦", "expected.json"), JSON.stringify(fromYamlBlocks("一梦"), null, 2));

const hufen = {
  entriesOnly: true,
  npcs: [
    { name: "格拉基的化身", attributes: { str: 100, con: 150, siz: 225, dex: 50, app: 75, pow: 140 }, hp: 37, mp: 28, statText: "100 150 225 50 75\n— 140 — — 37\n+3D6 4 6 28" },
    { name: "威廉·布罗菲", attributes: { str: 35, con: 110, siz: 80, dex: 25, app: 65, int: 45, pow: 60 }, hp: 19, mp: 12, statText: "35 110 80 25 65\n45 60 — — 19\n0 0 5 12" },
    { name: "罗伯特·布罗菲", attributes: { str: 40, con: 90, siz: 70, dex: 10, app: 55, int: 20, pow: 35 }, hp: 16, mp: 7, statText: "40 90 70 10 55\n20 35 — — 16\n0 0 2 7" },
    { name: "雅各布·特伦特", attributes: { str: 40, con: 65, siz: 55, dex: 75, app: 60, int: 50, pow: 60, edu: 70, luck: 60 }, hp: 12, mp: 12, statText: "40 65 55 75 60\n50 60 70 60 12\n0 0 8 12" },
    { name: "史密斯夫妇", attributes: { str: 80, con: 120, siz: 60, dex: 20, app: 65, int: 45, pow: 50 }, hp: 18, mp: 10, statText: "80 120 60 20 65\n45 50 — — 18\n+1D4 1 6 10" },
    { name: "不死行尸", attributes: { str: 80, con: 80, siz: 65, dex: 35, pow: 5 }, hp: 14, mp: 1, statText: "80 80 65 35 —\n— 05 — — 19\n+1D4 1 6 1" },
    { name: "詹姆斯·弗雷泽", attributes: { str: 90, con: 150, siz: 75, dex: 30, app: 70, int: 45, pow: 45 }, hp: 22, mp: 9, statText: "90 150 75 30 70\n45 45 — — 22\n+1D6 2 7 9" },
    { name: "比尔·邓斯顿", attributes: { str: 85, con: 70, siz: 80, dex: 60, app: 75, int: 40, pow: 40, edu: 70, luck: 40 }, hp: 15, mp: 8, statText: "85 70 80 60 75\n40 40 70 40 19\n+1D6 2 7 8" },
    { name: "萨拉", attributes: { str: 55, con: 70, siz: 50, dex: 75, app: 90, int: 85, pow: 80, edu: 75, luck: 80 }, hp: 12, mp: 16, statText: "55 70 50 75 90\n85 80 75 80 19\n0 0 9 16" }
  ]
};
writeFileSync(join(root, "湖之仆从", "expected.json"), JSON.stringify(hufen, null, 2));
console.log("regression expected written");
