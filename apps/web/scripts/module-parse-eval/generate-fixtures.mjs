// 生成团本解析测试素材（synthetic）。运行：node scripts/module-parse-eval/generate-fixtures.mjs
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../test/fixtures/module-parse/synthetic");
rmSync(root, { recursive: true, force: true });

function write(id, files, expected, meta = {}) {
  const dir = join(root, id);
  mkdirSync(join(dir, "files"), { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    const target = join(dir, "files", name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  writeFileSync(join(dir, "expected.json"), JSON.stringify({ ...expected, ...meta }, null, 2));
}

function npc(name, attributes, vitals = {}, aliases) {
  return { name, ...(aliases ? { aliases } : {}), attributes, ...vitals };
}

function hpOf(con, siz) { return Math.floor((con + siz) / 10); }
function mpOf(pow) { return Math.floor(pow / 5); }

// ---- 1. 中文标签同行 ----
write("s01-cn-inline", {
  "团本.md": [
    "# 雾之村",
    "## 村正 山田",
    "力量 65 体质 60 体型 70 敏捷 55 外貌 45 智力 50 意志 55 教育 60 幸运 40",
    "生命 13 魔法 11",
    "## 巫女 铃",
    "力量 40 体质 50 体型 45 敏捷 75 外貌 80 智力 70 意志 85 教育 65 幸运 60",
    "HP 9 MP 17 SAN 85"
  ].join("\n")
}, { npcs: [
  npc("山田", { str: 65, con: 60, siz: 70, dex: 55, app: 45, int: 50, pow: 55, edu: 60, luck: 40 }, { hp: 13, mp: 11 }),
  npc("铃", { str: 40, con: 50, siz: 45, dex: 75, app: 80, int: 70, pow: 85, edu: 65, luck: 60 }, { hp: 9, mp: 17, san: 85 })
] });

// ---- 2. 英文标签同行 ----
write("s02-en-inline", {
  "module.txt": [
    "# Old Mill",
    "## Miller Hob",
    "STR 70 CON 65 SIZ 75 DEX 45 APP 50 INT 55 POW 60 EDU 40 LUCK 35 HP 14 MP 12",
    "## Hound",
    "STR 55 CON 50 SIZ 40 DEX 80 APP 5 INT 10 POW 45 EDU 5 LUCK 20 HP 9 MP 9 SAN 45"
  ].join("\n")
}, { npcs: [
  npc("Miller Hob", { str: 70, con: 65, siz: 75, dex: 45, app: 50, int: 55, pow: 60, edu: 40, luck: 35 }, { hp: 14, mp: 12 }),
  npc("Hound", { str: 55, con: 50, siz: 40, dex: 80, app: 5, int: 10, pow: 45, edu: 5, luck: 20 }, { hp: 9, mp: 9, san: 45 })
] });

// ---- 3. 冒号逐行 ----
write("s03-colon-lines", {
  "stat.md": [
    "# 灯塔",
    "## 看守 老陈",
    "力量: 60",
    "体质: 70",
    "体型: 65",
    "敏捷: 45",
    "外貌: 40",
    "智力: 55",
    "意志: 65",
    "教育: 50",
    "幸运: 30",
    "生命: 13",
    "魔法: 13",
    "",
    "## 幽影",
    "STR: 30",
    "CON: 40",
    "SIZ: 35",
    "DEX: 90",
    "APP: 1",
    "INT: 25",
    "POW: 70",
    "EDU: 1",
    "LUCK: 10",
    "HP: 7",
    "MP: 14"
  ].join("\n")
}, { npcs: [
  npc("老陈", { str: 60, con: 70, siz: 65, dex: 45, app: 40, int: 55, pow: 65, edu: 50, luck: 30 }, { hp: 13, mp: 13 }),
  npc("幽影", { str: 30, con: 40, siz: 35, dex: 90, app: 1, int: 25, pow: 70, edu: 1, luck: 10 }, { hp: 7, mp: 14 })
] });

// ---- 4. 无标签三行数值块（湖之仆从格式）----
const p4a = { str: 70, con: 60, siz: 55, dex: 65, app: 40, int: 45, pow: 55, edu: 50, luck: 0 };
const p4b = { str: 50, con: 80, siz: 70, dex: 45, app: 35, int: 60, pow: 70, edu: 65, luck: 40 };
write("s04-positional-3line", {
  "positional.txt": [
    "黑风是一个身形瘦长的山贼头目。",
    "70 60 55 65 40",
    "45 55 50 0 11",
    "0 0 8 11",
    "赤影曾是山中的猎户，如今动作依然敏捷。",
    "赤影",
    "50 80 70 45 35",
    "60 70 65 40 15",
    "+1D4 1 6 14"
  ].join("\n")
}, { npcs: [
  npc("黑风", p4a, { hp: hpOf(60, 55), mp: mpOf(55) }),
  npc("赤影", p4b, { hp: hpOf(80, 70), mp: mpOf(70) })
] });

// ---- 5. 标签表头 + 数值行 ----
write("s05-positional-header", {
  "gargoyle.md": [
    "# 钟楼",
    "## 石像鬼",
    "力量 体质 体型 敏捷 外貌",
    "80 90 75 40 5",
    "智力 意志 教育 幸运",
    "30 60 20 25",
    "生命 魔法",
    "16 12",
    "护甲 3"
  ].join("\n")
}, { npcs: [
  npc("石像鬼", { str: 80, con: 90, siz: 75, dex: 40, app: 5, int: 30, pow: 60, edu: 20, luck: 25 }, { hp: 16, mp: 12, armor: "3" })
] });

// ---- 6. Markdown 表格 ----
write("s06-md-table", {
  "swamp.md": [
    "# 沼泽",
    "| 名称 | 力量 | 体质 | 体型 | 敏捷 | 外貌 | 智力 | 意志 | 教育 | 幸运 | 生命 | 魔法 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "| 沼泽巨蛙 | 60 | 70 | 65 | 40 | 10 | 20 | 50 | 10 | 30 | 13 | 10 |",
    "| 泥怪 | 40 | 90 | 80 | 20 | 1 | 5 | 60 | 1 | 5 | 17 | 12 |"
  ].join("\n")
}, { npcs: [
  npc("沼泽巨蛙", { str: 60, con: 70, siz: 65, dex: 40, app: 10, int: 20, pow: 50, edu: 10, luck: 30 }, { hp: 13, mp: 10 }),
  npc("泥怪", { str: 40, con: 90, siz: 80, dex: 20, app: 1, int: 5, pow: 60, edu: 1, luck: 5 }, { hp: 17, mp: 12 })
] });

// ---- 7. CSV（带英文表头）----
write("s07-csv-labeled", {
  "actors.csv": [
    "name,STR,CON,SIZ,DEX,APP,INT,POW,EDU,LUCK,HP,MP",
    "自动人偶,50,60,55,45,30,40,50,20,25,11,10",
    "发条犬,45,50,40,70,5,10,40,5,15,9,8"
  ].join("\n")
}, { npcs: [
  npc("自动人偶", { str: 50, con: 60, siz: 55, dex: 45, app: 30, int: 40, pow: 50, edu: 20, luck: 25 }, { hp: 11, mp: 10 }),
  npc("发条犬", { str: 45, con: 50, siz: 40, dex: 70, app: 5, int: 10, pow: 40, edu: 5, luck: 15 }, { hp: 9, mp: 8 })
] });

// ---- 8. JSON ----
write("s08-json", {
  "module.json": JSON.stringify({
    title: "数据幽灵",
    npcs: [
      { name: "数据幽灵", attributes: { str: 45, con: 55, siz: 50, dex: 70, app: 20, int: 80, pow: 65, edu: 75, luck: 40 }, hp: 10, mp: 13 },
      { name: "防火墙", attributes: { str: 90, con: 95, siz: 85, dex: 15, app: 1, int: 5, pow: 70, edu: 1, luck: 1 }, hp: 18, mp: 14, armor: 4 }
    ]
  }, null, 2)
}, { npcs: [
  npc("数据幽灵", { str: 45, con: 55, siz: 50, dex: 70, app: 20, int: 80, pow: 65, edu: 75, luck: 40 }, { hp: 10, mp: 13 }),
  npc("防火墙", { str: 90, con: 95, siz: 85, dex: 15, app: 1, int: 5, pow: 70, edu: 1, luck: 1 }, { hp: 18, mp: 14, armor: "4" })
] });

// ---- 9. YAML ----
write("s09-yaml", {
  "module.yaml": [
    "title: 风暴祭坛",
    "npcs:",
    "  - name: 风暴祭司",
    "    attributes:",
    "      str: 65",
    "      con: 60",
    "      siz: 70",
    "      dex: 55",
    "      app: 40",
    "      int: 70",
    "      pow: 80",
    "      edu: 65",
    "      luck: 45",
    "    hp: 13",
    "    mp: 16",
    "  - name: 风元素",
    "    attributes:",
    "      str: 40",
    "      con: 45",
    "      siz: 60",
    "      dex: 95",
    "      app: 1",
    "      int: 15",
    "      pow: 75",
    "      edu: 1",
    "      luck: 10",
    "    hp: 10",
    "    mp: 15"
  ].join("\n")
}, { npcs: [
  npc("风暴祭司", { str: 65, con: 60, siz: 70, dex: 55, app: 40, int: 70, pow: 80, edu: 65, luck: 45 }, { hp: 13, mp: 16 }),
  npc("风元素", { str: 40, con: 45, siz: 60, dex: 95, app: 1, int: 15, pow: 75, edu: 1, luck: 10 }, { hp: 10, mp: 15 })
] });

// ---- 10. HTML 表格 ----
write("s10-html", {
  "module.html": [
    "<html><body><h1>旧矿坑</h1>",
    "<h2>矿工头目 周铁</h2>",
    "<table><tr><th>力量</th><th>体质</th><th>体型</th><th>敏捷</th><th>外貌</th><th>智力</th><th>意志</th><th>教育</th><th>幸运</th><th>生命</th><th>魔法</th></tr>",
    "<tr><td>75</td><td>70</td><td>80</td><td>50</td><td>45</td><td>40</td><td>55</td><td>35</td><td>30</td><td>15</td><td>11</td></tr></table>",
    "</body></html>"
  ].join("\n")
}, { npcs: [
  npc("周铁", { str: 75, con: 70, siz: 80, dex: 50, app: 45, int: 40, pow: 55, edu: 35, luck: 30 }, { hp: 15, mp: 11 })
] });

// ---- 11. XLSX ----
{
  const rows = [
    ["name", "STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK", "HP", "MP"],
    ["矿工甲", 60, 65, 70, 45, 40, 35, 50, 30, 25, 13, 10],
    ["矿工乙", 55, 60, 60, 50, 45, 40, 45, 35, 20, 12, 9]
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "NPC");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  write("s11-xlsx", { "actors.xlsx": buffer }, { npcs: [
    npc("矿工甲", { str: 60, con: 65, siz: 70, dex: 45, app: 40, int: 35, pow: 50, edu: 30, luck: 25 }, { hp: 13, mp: 10 }),
    npc("矿工乙", { str: 55, con: 60, siz: 60, dex: 50, app: 45, int: 40, pow: 45, edu: 35, luck: 20 }, { hp: 12, mp: 9 })
  ] });
}

// ---- 12. DOCX ----
{
  const paragraphs = [
    "废弃医院",
    "调查员在走廊尽头遇到护士长 林芳。",
    "林芳",
    "STR 45 CON 55 SIZ 50 DEX 60 APP 70 INT 65 POW 60 EDU 75 LUCK 55",
    "HP 10 MP 12 SAN 60",
    "病人 甲",
    "STR 80 CON 85 SIZ 90 DEX 25 APP 5 INT 10 POW 30 EDU 5 LUCK 5",
    "HP 17 MP 6"
  ];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    ...paragraphs.map((text) => '<w:p><w:r><w:t xml:space="preserve">' + text.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</w:t></w:r></w:p>"),
    "</w:body></w:document>"
  ].join("");
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  zip.addFile("_rels/.rels", Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
  zip.addFile("word/document.xml", Buffer.from(xml));
  write("s12-docx", { "module.docx": zip.toBuffer() }, { npcs: [
    npc("林芳", { str: 45, con: 55, siz: 50, dex: 60, app: 70, int: 65, pow: 60, edu: 75, luck: 55 }, { hp: 10, mp: 12, san: 60 }),
    npc("病人 甲", { str: 80, con: 85, siz: 90, dex: 25, app: 5, int: 10, pow: 30, edu: 5, luck: 5 }, { hp: 17, mp: 6 })
  ] });
}

// ---- 13. PDF（英文，简单 PDF 文本层）----
function simplePdf(lines) {
  const esc = (text) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = lines.map((line, index) => "BT /F1 12 Tf 72 " + String(760 - index * 18) + " Td (" + esc(line) + ") Tj ET").join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length " + Buffer.byteLength(content, "latin1") + " >>\nstream\n" + content + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += String(index + 1) + " 0 obj\n" + body + "\nendobj\n";
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 " + String(objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets) pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + String(objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + String(xrefOffset) + "\n%%EOF";
  return Buffer.from(pdf, "latin1");
}
write("s13-pdf-en", {
  "module.pdf": simplePdf([
    "Cursed Lighthouse",
    "Keeper Alden",
    "STR 60 CON 70 SIZ 65 DEX 50 APP 40 INT 55 POW 65 EDU 50 LUCK 35",
    "HP 13 MP 13 SAN 70",
    "Deep One",
    "STR 80 CON 80 SIZ 70 DEX 50 APP 10 INT 60 POW 75 EDU 20 LUCK 25",
    "HP 15 MP 15"
  ])
}, { npcs: [
  npc("Keeper Alden", { str: 60, con: 70, siz: 65, dex: 50, app: 40, int: 55, pow: 65, edu: 50, luck: 35 }, { hp: 13, mp: 13, san: 70 }),
  npc("Deep One", { str: 80, con: 80, siz: 70, dex: 50, app: 10, int: 60, pow: 75, edu: 20, luck: 25 }, { hp: 15, mp: 15 })
] });

// ---- 14. 骰点不应误读 ----
write("s14-dice-guard", {
  "guard.txt": [
    "## 淘气鬼",
    "STR 3D6 CON 45 SIZ 35 DEX 80 APP 15 INT 40 POW 55 EDU 10 LUCK 30",
    "HP 8 MP 11 SAN 55"
  ].join("\n")
}, { npcs: [
  npc("淘气鬼", { con: 45, siz: 35, dex: 80, app: 15, int: 40, pow: 55, edu: 10, luck: 30 }, { hp: 8, mp: 11, san: 55 })
] });

// ---- 15. 英文 NPC 名 ----
write("s15-en-names", {
  "module.md": [
    "# Asylum",
    "## Doctor Marcus Vale",
    "STR 55 CON 60 SIZ 65 DEX 50 APP 60 INT 80 POW 70 EDU 85 LUCK 45",
    "HP 12 MP 14 SAN 70",
    "## Nurse Edith Shaw",
    "STR 45 CON 55 SIZ 50 DEX 65 APP 75 INT 60 POW 55 EDU 70 LUCK 50",
    "HP 10 MP 11 SAN 55"
  ].join("\n")
}, { npcs: [
  npc("Doctor Marcus Vale", { str: 55, con: 60, siz: 65, dex: 50, app: 60, int: 80, pow: 70, edu: 85, luck: 45 }, { hp: 12, mp: 14, san: 70 }),
  npc("Nurse Edith Shaw", { str: 45, con: 55, siz: 50, dex: 65, app: 75, int: 60, pow: 55, edu: 70, luck: 50 }, { hp: 10, mp: 11, san: 55 })
] });

// ---- 16. 20 个 NPC ----
{
  const rows = ["name,STR,CON,SIZ,DEX,APP,INT,POW,EDU,LUCK,HP,MP"];
  const expected = [];
  const letters = "ABCDEFGHIJKLMNOPQRST";
  for (let i = 0; i < 20; i += 1) {
    const name = "守卫" + letters[i];
    const str = 40 + (i % 5) * 8;
    const con = 50 + (i % 4) * 10;
    const siz = 55 + (i % 3) * 5;
    const dex = 40 + (i % 6) * 5;
    const app = 20 + (i % 7) * 5;
    const int = 30 + (i % 5) * 6;
    const pow = 45 + (i % 6) * 5;
    const edu = 25 + (i % 4) * 10;
    const luck = 20 + (i % 8) * 5;
    const hp = hpOf(con, siz);
    const mp = mpOf(pow);
    rows.push([name, str, con, siz, dex, app, int, pow, edu, luck, hp, mp].join(","));
    expected.push(npc(name, { str, con, siz, dex, app, int, pow, edu, luck }, { hp, mp }));
  }
  rows.push("# total 20 guards");
  write("s16-many-npcs", { "guards.csv": rows.join("\n") }, { npcs: expected });
}

// ---- 17. 别名 ----
write("s17-aliases", {
  "night.md": [
    "# 夜枭",
    "夜枭（暗影）是屋顶的刺客。",
    "夜枭（暗影）",
    "STR 50 CON 55 SIZ 50 DEX 85 APP 45 INT 60 POW 50 EDU 40 LUCK 30",
    "HP 10 MP 10"
  ].join("\n")
}, { npcs: [
  npc("夜枭", { str: 50, con: 55, siz: 50, dex: 85, app: 45, int: 60, pow: 50, edu: 40, luck: 30 }, { hp: 10, mp: 10 }, ["暗影", "夜枭（暗影）"])
] });

// ---- 18. 显式全数值 + 护甲 ----
write("s18-full-vitals", {
  "tank.md": [
    "# 装甲车",
    "## 铁壁",
    "力量 90 体质 95 体型 100 敏捷 20 外貌 5 智力 10 意志 60 教育 5 幸运 10",
    "生命值 20 魔法值 12 SAN 40 DP 3",
    "护甲 6"
  ].join("\n")
}, { npcs: [
  npc("铁壁", { str: 90, con: 95, siz: 100, dex: 20, app: 5, int: 10, pow: 60, edu: 5, luck: 10 }, { hp: 20, mp: 12, san: 40, dp: 3, armor: "6" })
] });

// ---- 19. TSV ----
write("s19-tsv", {
  "actors.tsv": [
    "name\t力量\t体质\t体型\t敏捷\t外貌\t智力\t意志\t教育\t幸运\t生命\t魔法",
    "飞贼 燕子\t55\t50\t45\t90\t60\t50\t45\t30\t70\t9\t9"
  ].join("\n")
}, { npcs: [
  npc("燕子", { str: 55, con: 50, siz: 45, dex: 90, app: 60, int: 50, pow: 45, edu: 30, luck: 70 }, { hp: 9, mp: 9 })
] });

// ---- 20. 正文夹数值 ----
write("s20-prose-embedded", {
  "story.md": [
    "# 仓库夜班",
    "调查员在货架间遇到了守夜人老周。老周身材魁梧，手里握着一根铁管。",
    "他大声喊了几句，见没人回应，便朝门口走去。",
    "STR 70 CON 65 SIZ 75 DEX 45 APP 50 INT 55 POW 60 EDU 40 LUCK 35",
    "HP 14 MP 12 SAN 65",
    "仓库深处还有一只被惊动的野狗。",
    "STR 40 CON 45 SIZ 35 DEX 70 APP 5 INT 5 POW 40 EDU 5 LUCK 15",
    "HP 8 MP 8 SAN 40"
  ].join("\n")
}, { npcs: [
  npc("老周", { str: 70, con: 65, siz: 75, dex: 45, app: 50, int: 55, pow: 60, edu: 40, luck: 35 }, { hp: 14, mp: 12, san: 65 }),
  npc("野狗", { str: 40, con: 45, siz: 35, dex: 70, app: 5, int: 5, pow: 40, edu: 5, luck: 15 }, { hp: 8, mp: 8, san: 40 })
] });

// ---- 21. 多文件 ----
write("s21-multifile", {
  "main.md": [
    "# 矿场",
    "## 矿工头目",
    "力量 80 体质 75 体型 85 敏捷 40 外貌 30 智力 35 意志 50 教育 20 幸运 20",
    "生命 16 魔法 10"
  ].join("\n"),
  "appendix.txt": [
    "## 矿工 小六",
    "STR 50 CON 55 SIZ 50 DEX 60 APP 40 INT 45 POW 40 EDU 30 LUCK 35",
    "HP 10 MP 8"
  ].join("\n")
}, { npcs: [
  npc("矿工头目", { str: 80, con: 75, siz: 85, dex: 40, app: 30, int: 35, pow: 50, edu: 20, luck: 20 }, { hp: 16, mp: 10 }),
  npc("小六", { str: 50, con: 55, siz: 50, dex: 60, app: 40, int: 45, pow: 40, edu: 30, luck: 35 }, { hp: 10, mp: 8 })
] });

// ---- 22. 英文三行无标签 ----
write("s22-positional-en", {
  "positional-en.txt": [
    "Foreman Blake is a broad-shouldered overseer.",
    "Foreman Blake",
    "60 70 65 50 45",
    "55 60 50 40 13",
    "+1D4 1 7 12",
    "Rig Hand Cooper works the night shift.",
    "Rig Hand Cooper",
    "75 65 70 55 40",
    "40 50 35 30 13",
    "+1D4 1 7 10"
  ].join("\n")
}, { npcs: [
  npc("Foreman Blake", { str: 60, con: 70, siz: 65, dex: 50, app: 45, int: 55, pow: 60, edu: 50, luck: 40 }, { hp: 13, mp: 12 }),
  npc("Rig Hand Cooper", { str: 75, con: 65, siz: 70, dex: 55, app: 40, int: 40, pow: 50, edu: 35, luck: 30 }, { hp: 13, mp: 10 })
] });

// ---- 23. 噪声/错位字符 ----
write("s23-noisy-ocr", {
  "scan.txt": [
    "石像守卫",
    "80 80 65 35 捷 50",
    "— 05 — — 14",
    "+1D4 1 6 1",
    "腐化仆从",
    "45 70 捷 60 20 30",
    "10 40 — — 13",
    "0 0 7 8"
  ].join("\n")
}, { npcs: [
  npc("石像守卫", { str: 80, con: 80, siz: 65, dex: 35, app: 50, pow: 5 }, { hp: 14, mp: 1 }),
  npc("腐化仆从", { str: 45, con: 70, siz: 60, dex: 20, app: 30, int: 10, pow: 40 }, { hp: 13, mp: 8 })
] });

// ---- 24. 中英混合 + 无标签部分缺项 ----
write("s24-mixed-missing", {
  "mixed.md": [
    "# 混合写法",
    "## 半成品",
    "STR 55 CON 60 SIZ 65 DEX 50",
    "HP 12 MP 10",
    "## 缺项傀儡",
    "70 65 60 — 20",
    "— 35 40 — 12",
    "0 0 6 7"
  ].join("\n")
}, { npcs: [
  npc("半成品", { str: 55, con: 60, siz: 65, dex: 50 }, { hp: 12, mp: 10 }),
  npc("缺项傀儡", { str: 70, con: 65, siz: 60, app: 20, pow: 35, edu: 40 }, { hp: 12, mp: 7 })
] });

console.log("generated fixtures at " + root);
