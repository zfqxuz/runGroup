/**
 * 团本解析离线评测：
 * - 读取 apps/web/test/fixtures/module-parse 下各团本的 expected.json
 * - 调用应用层 prepareSources 提取不同文件类型的正文（md/txt/csv/json/yaml/html/xlsx/docx/pdf）
 * - 调用 n8n 工作流副本里的确定性 NPC 数值核心，按预期的 NPC 名单回填数值
 * - 逐团本计算字段级准确率（属性 / HP / MP / SAN / DP / 护甲），要求每个团本 >= 90%
 *
 * 运行：npx tsx --env-file=.env scripts/evaluate-module-parse.ts [--filter=关键字] [--verbose]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareSources } from "../src/server/ai/module-import";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const fixturesRoot = join(repoRoot, "apps", "web", "test", "fixtures", "module-parse");
const THRESHOLD = 0.9;

interface ExpectedNpc {
  readonly name: string;
  readonly statText?: string;
  readonly aliases?: readonly string[];
  readonly attributes?: Readonly<Record<string, number>>;
  readonly hp?: number;
  readonly mp?: number;
  readonly san?: number;
  readonly dp?: number;
  readonly armor?: string | number;
}

interface ExpectedStructure {
  readonly entriesOnly?: boolean;
  readonly npcs: readonly ExpectedNpc[];
  readonly chapters?: readonly string[];
  readonly scenes?: readonly string[];
  readonly clues?: readonly string[];
  readonly items?: readonly string[];
}

interface Core {
  readonly buildNpcStats: (input: {
    readonly entries: readonly Record<string, unknown>[];
    readonly sources: readonly { readonly filename?: string; readonly text: string }[];
  }) => readonly {
    readonly name: string;
    readonly aliases: readonly string[];
    readonly attributes: Readonly<Record<string, number>>;
    readonly maxHp: number | null;
    readonly maxMp: number | null;
    readonly maxSan: number | null;
    readonly maxDp: number | null;
    readonly armor: string | null;
  }[];
  readonly normalizeNameKey: (value: string) => string;
}

interface FixtureReport {
  readonly id: string;
  readonly files: readonly string[];
  readonly sources: readonly { readonly filename: string; readonly chars: number }[];
  readonly warnings: readonly string[];
  readonly accuracy: number;
  readonly attributeAccuracy: number;
  readonly vitalAccuracy: number;
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly wrong: readonly { readonly npc: string; readonly field: string; readonly expected: unknown; readonly actual: unknown }[];
  readonly npcCount: number;
}

const ATTRIBUTE_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;

function listFixtures(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (entry === "expected.json") out.push(dirname(full));
    }
  };
  visit(root);
  return out.sort();
}

async function loadSourceTexts(dir: string): Promise<{ files: string[]; sources: { filename: string; text: string }[]; images: number; warnings: string[] }> {
  const filesDir = join(dir, "files");
  if (!existsSync(filesDir)) return { files: [], sources: [], images: 0, warnings: [] };
  const names = readdirSync(filesDir).sort();
  const fileObjects = names.map((name) => {
    const buffer = readFileSync(join(filesDir, name));
    const type = name.endsWith(".pdf")
      ? "application/pdf"
      : name.endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : name.endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : name.endsWith(".png")
            ? "image/png"
            : name.endsWith(".csv")
              ? "text/csv"
              : name.endsWith(".json")
                ? "application/json"
                : name.endsWith(".html")
                  ? "text/html"
                  : "text/plain";
    return new File([new Uint8Array(buffer)], name, { type });
  });
  const warnings: { filename: string; message: string }[] = [];
  const result = await prepareSources(fileObjects, warnings);
  return {
    files: names,
    sources: result.sources.map((source) => ({ filename: source.filename, text: source.text })),
    images: result.images.length,
    warnings: warnings.map((warning) => warning.filename + ": " + warning.message)
  };
}

function expectedFields(npc: ExpectedNpc): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const key of ATTRIBUTE_KEYS) {
    const value = npc.attributes?.[key];
    if (typeof value === "number") out.push([key, value]);
  }
  if (typeof npc.hp === "number") out.push(["hp", npc.hp]);
  if (typeof npc.mp === "number") out.push(["mp", npc.mp]);
  if (typeof npc.san === "number") out.push(["san", npc.san]);
  if (typeof npc.dp === "number") out.push(["dp", npc.dp]);
  if (npc.armor !== undefined) out.push(["armor", String(npc.armor).toLowerCase()]);
  return out;
}

function actualValue(extracted: { attributes: Readonly<Record<string, number>>; maxHp: number | null; maxMp: number | null; maxSan: number | null; maxDp: number | null; armor: string | null }, field: string): unknown {
  if (field === "hp") return extracted.maxHp;
  if (field === "mp") return extracted.maxMp;
  if (field === "san") return extracted.maxSan;
  if (field === "dp") return extracted.maxDp;
  if (field === "armor") return extracted.armor === null ? null : extracted.armor.toLowerCase();
  return extracted.attributes[field];
}

async function evaluateFixture(dir: string, core: Core, verbose: boolean): Promise<FixtureReport> {
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as ExpectedStructure;
  const loaded = await loadSourceTexts(dir);
  const sources = loaded.sources.filter((source) => source.text.trim().length > 0).map((source) => ({ filename: source.filename, text: source.text }));
  const entries = expected.npcs.map((npc) => ({ id: npc.name, name: npc.name, aliases: npc.aliases ?? [], ...(npc.statText === undefined ? {} : { statText: npc.statText }) }));
  const usableSources = expected.entriesOnly === true ? [] : sources;
  const extracted = usableSources.length === 0 && expected.entriesOnly !== true ? [] : core.buildNpcStats({ entries, sources: usableSources });

  const byKey = new Map<string, (typeof extracted)[number]>();
  for (const item of extracted) {
    byKey.set(core.normalizeNameKey(item.name), item);
    for (const alias of item.aliases ?? []) byKey.set(core.normalizeNameKey(alias), item);
  }

  const missing: string[] = [];
  const wrong: { npc: string; field: string; expected: unknown; actual: unknown }[] = [];
  const usedKeys = new Set<string>();
  let totalFields = 0;
  let correctFields = 0;
  let attributeTotal = 0;
  let attributeCorrect = 0;
  let vitalTotal = 0;
  let vitalCorrect = 0;

  for (const npc of expected.npcs) {
    const fields = expectedFields(npc);
    totalFields += fields.length;
    const keys = [npc.name, ...(npc.aliases ?? [])].map((name) => core.normalizeNameKey(name));
    let match: (typeof extracted)[number] | undefined;
    for (const key of keys) {
      const candidate = byKey.get(key);
      if (candidate !== undefined) {
        match = candidate;
        break;
      }
    }
    if (match === undefined) {
      for (const key of keys) {
        if (key.length < 1) continue;
        for (const [extractedKey, candidate] of byKey) {
          if (extractedKey.length < 1) continue;
          if (extractedKey.includes(key) || key.includes(extractedKey)) {
            match = candidate;
            break;
          }
        }
        if (match !== undefined) break;
      }
    }
    if (match === undefined) {
      missing.push(npc.name);
      continue;
    }
    usedKeys.add(core.normalizeNameKey(match.name));
    for (const alias of match.aliases ?? []) usedKeys.add(core.normalizeNameKey(alias));
    for (const [field, expectedValue] of fields) {
      const actual = actualValue(match, field);
      const isAttribute = (ATTRIBUTE_KEYS as readonly string[]).includes(field);
      if (isAttribute) attributeTotal += 1;
      else vitalTotal += 1;
      if (actual === expectedValue) {
        correctFields += 1;
        if (isAttribute) attributeCorrect += 1;
        else vitalCorrect += 1;
      } else {
        wrong.push({ npc: npc.name, field, expected: expectedValue, actual });
      }
    }
  }

  const extra = extracted.filter((item) => {
    const keys = [item.name, ...(item.aliases ?? [])].map((name) => core.normalizeNameKey(name));
    return keys.every((key) => usedKeys.has(key) === false);
  });
  // 多出来的 NPC 视为一整组错误字段，避免"乱抓 NPC"刷高准确率。
  totalFields += extra.length * 10;

  const accuracy = totalFields === 0 ? 0 : correctFields / totalFields;
  const attributeAccuracy = attributeTotal === 0 ? 1 : attributeCorrect / attributeTotal;
  const vitalAccuracy = vitalTotal === 0 ? 1 : vitalCorrect / vitalTotal;
  const report: FixtureReport = {
    id: dir.slice(fixturesRoot.length + 1),
    files: loaded.files,
    sources: loaded.sources.map((source) => ({ filename: source.filename, chars: source.text.length })),
    warnings: loaded.warnings,
    accuracy,
    attributeAccuracy,
    vitalAccuracy,
    missing,
    extra: extra.map((item) => item.name),
    wrong,
    npcCount: extracted.length
  };
  if (verbose) {
    console.log("  sources: " + report.sources.map((s) => s.filename + "(" + String(s.chars) + ")").join(", "));
    console.log("  npc: expected=" + String(expected.npcs.length) + " extracted=" + String(extracted.length) + " missing=" + JSON.stringify(missing) + " extra=" + JSON.stringify(report.extra));
    if (report.warnings.length > 0) console.log("  warnings: " + report.warnings.join(" | "));
    for (const item of wrong.slice(0, 12)) console.log("  wrong " + item.npc + "." + item.field + " expected=" + JSON.stringify(item.expected) + " actual=" + JSON.stringify(item.actual));
    if (wrong.length > 12) console.log("  ... " + String(wrong.length - 12) + " more wrong fields");
  }
  return report;
}

async function main(): Promise<void> {
  const filterArg = process.argv.find((arg) => arg.startsWith("--filter="));
  const filter = filterArg === undefined ? "" : filterArg.slice("--filter=".length);
  const verbose = process.argv.includes("--verbose");
  const corePath = join(repoRoot, "n8n", "workflow-src-v2", "npc-stats-core.js");
  if (existsSync(corePath) === false) throw new Error("缺少工作流副本核心：" + corePath);
  const core = require(corePath) as Core;

  const fixtures = listFixtures(fixturesRoot).filter((dir) => filter.length === 0 || dir.includes(filter));
  if (fixtures.length === 0) throw new Error("没有找到测试团本：" + fixturesRoot);

  const reports: FixtureReport[] = [];
  for (const dir of fixtures) {
    if (verbose) console.log("\n### " + dir.slice(fixturesRoot.length + 1));
    reports.push(await evaluateFixture(dir, core, verbose));
  }

  console.log("\n================ 团本解析准确率 ================");
  console.log("fixture".padEnd(46) + "acc".padStart(7) + "attr".padStart(8) + "vital".padStart(8) + "npc".padStart(5));
  let failed = 0;
  for (const report of reports) {
    const ok = report.accuracy >= THRESHOLD;
    if (!ok) failed += 1;
    console.log(
      report.id.padEnd(46) +
      (report.accuracy * 100).toFixed(1).padStart(6) + "%" +
      (report.attributeAccuracy * 100).toFixed(1).padStart(7) + "%" +
      (report.vitalAccuracy * 100).toFixed(1).padStart(7) + "%" +
      String(report.npcCount).padStart(5) +
      (ok ? "" : "  <FAIL>")
    );
    if (ok === false && verbose === false) {
      console.log("    missing=" + JSON.stringify(report.missing) + " extra=" + JSON.stringify(report.extra));
    }
  }
  const average = reports.reduce((sum, report) => sum + report.accuracy, 0) / reports.length;
  console.log("------------------------------------------------");
  console.log("fixtures=" + String(reports.length) + "  failed(<" + String(THRESHOLD * 100) + "%)=" + String(failed) + "  average=" + (average * 100).toFixed(1) + "%");
  if (failed > 0) process.exitCode = 1;
}

void main();
