/**
 * 从团本原文中确定性读取 NPC 属性 / 数值块。
 *
 * AI 分块提取时经常会省略 NPC 的 STR/CON/... 数值，导致物化到房间的 NPC
 * 全部落到默认 50。这里用规则解析兜底：
 * - 支持常见 COC 简写（STR/CON/...）、中文属性名（力量/体质/...）
 * - 支持同一行、逗号分隔、表格、以及“标签行 + 数值行”的排版
 * - 关联 NPC 名附近窗口，避免把别的 NPC 的数值抄过来
 */

export const NPC_STAT_ATTRIBUTE_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;
export type NpcStatAttributeKey = (typeof NPC_STAT_ATTRIBUTE_KEYS)[number];

export interface ParsedNpcStats {
  readonly attributes: Partial<Record<NpcStatAttributeKey, number>>;
  readonly maxHp: number | null;
  readonly maxMp: number | null;
  readonly maxSan: number | null;
  readonly maxDp: number | null;
  readonly matchedAttributes: number;
  readonly matchedVitals: number;
}

interface LabelGroup<T extends string> {
  readonly key: T;
  readonly aliases: readonly string[];
}

const ATTRIBUTE_GROUPS: readonly LabelGroup<NpcStatAttributeKey>[] = [
  { key: "str", aliases: ["strength", "str", "力量"] },
  { key: "con", aliases: ["constitution", "con", "体质"] },
  { key: "siz", aliases: ["size", "siz", "体型"] },
  { key: "dex", aliases: ["dexterity", "dex", "敏捷"] },
  { key: "app", aliases: ["appearance", "app", "外貌", "魅力"] },
  { key: "int", aliases: ["intelligence", "int", "智力"] },
  { key: "pow", aliases: ["power", "pow", "意志", "意志力"] },
  { key: "edu", aliases: ["education", "edu", "教育"] },
  { key: "luck", aliases: ["luck", "幸运"] }
];

type VitalKey = "hp" | "mp" | "san" | "dp";

const VITAL_GROUPS: readonly LabelGroup<VitalKey>[] = [
  { key: "hp", aliases: ["hit points", "hit point", "hp", "生命值", "生命", "耐久值", "耐久力", "耐久", "体力", "血量"] },
  { key: "mp", aliases: ["magic points", "magic point", "mp", "魔法值", "魔法点", "魔法", "魔力", "mp值"] },
  { key: "san", aliases: ["san值", "san", "理智值", "理智"] },
  { key: "dp", aliases: ["dp值", "dp"] }
];

const SEPARATORS = "[ \\t:：=,，;；|/()（）为是值可有达到]{0,12}";
const NUMBER_PATTERN = "(\\d{1,4})(?![0-9])(?![dD]\\d)";
const SIGNED_NUMBER_PATTERN = "([+-]?\\d{1,5})(?![0-9])(?![dD]\\d)";

export interface NpcStatSource {
  readonly filename?: string;
  readonly text: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value
    .replace(/[\uFF10-\uFF19]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/＝/g, "=");
}

function groupValue<T extends string>(
  groups: readonly LabelGroup<T>[],
  alias: string
): T | undefined {
  const key = alias.trim().toLowerCase();
  for (const group of groups) {
    if (group.aliases.some((item) => item.toLowerCase() === key)) return group.key;
  }
  return undefined;
}

function collectDirectMatches<T extends string>(
  text: string,
  groups: readonly LabelGroup<T>[],
  signed: boolean
): Map<T, number> {
  const output = new Map<T, number>();
  const aliases = groups.flatMap((group) => group.aliases);
  const english = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias)).sort((a, b) => b.length - a.length);
  const chinese = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias) === false).sort((a, b) => b.length - a.length);
  const numberPattern = signed ? SIGNED_NUMBER_PATTERN : NUMBER_PATTERN;

  if (english.length > 0) {
    const labelPattern = "(?<![a-z])(" + english.map(escapeRegExp).join("|") + ")(?![a-z])";
    const pattern = new RegExp(labelPattern + SEPARATORS + numberPattern, "gi");
    for (const match of text.matchAll(pattern)) {
      const key = groupValue(groups, match[1] ?? "");
      if (key === undefined || output.has(key)) continue;
      const value = Number(match[2]);
      if (Number.isFinite(value)) output.set(key, value);
    }
  }

  if (chinese.length > 0) {
    const pattern = new RegExp("(" + chinese.map(escapeRegExp).join("|") + ")" + SEPARATORS + numberPattern, "g");
    for (const match of text.matchAll(pattern)) {
      const key = groupValue(groups, match[1] ?? "");
      if (key === undefined || output.has(key)) continue;
      const value = Number(match[2]);
      if (Number.isFinite(value)) output.set(key, value);
    }
  }

  return output;
}

function containsValueAfterLabel(line: string, groups: readonly LabelGroup<string>[]): boolean {
  const aliases = groups.flatMap((group) => group.aliases).sort((a, b) => b.length - a.length);
  if (aliases.length === 0) return false;
  const english = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias));
  const chinese = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias) === false);
  const patterns: RegExp[] = [];
  if (english.length > 0) patterns.push(new RegExp("(?<![a-z])(?:" + english.map(escapeRegExp).join("|") + ")(?![a-z])" + SEPARATORS + NUMBER_PATTERN, "i"));
  if (chinese.length > 0) patterns.push(new RegExp("(?:" + chinese.map(escapeRegExp).join("|") + ")" + SEPARATORS + NUMBER_PATTERN));
  return patterns.some((pattern) => pattern.test(line));
}

function labelsInOrder(line: string, groups: readonly LabelGroup<string>[]): string[] {
  const aliases = groups.flatMap((group) => group.aliases).sort((a, b) => b.length - a.length);
  const english = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias));
  const chinese = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias) === false);
  const patternParts: string[] = [];
  if (english.length > 0) patternParts.push("(?<![a-z])(?:" + english.map(escapeRegExp).join("|") + ")(?![a-z])");
  if (chinese.length > 0) patternParts.push("(?:" + chinese.map(escapeRegExp).join("|") + ")");
  if (patternParts.length === 0) return [];
  const pattern = new RegExp(patternParts.join("|"), "gi");
  return Array.from(line.matchAll(pattern)).map((match) => groupValue(groups, match[0]) ?? "").filter((key) => key.length > 0);
}

function extractAlignedPairs(text: string): Map<string, number> {
  const output = new Map<string, number>();
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const allGroups: readonly LabelGroup<string>[] = [...ATTRIBUTE_GROUPS, ...VITAL_GROUPS] as readonly LabelGroup<string>[];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.length > 240 || containsValueAfterLabel(line, allGroups)) continue;
    const keys = labelsInOrder(line, allGroups);
    if (keys.length < 1) continue;
    for (let offset = 1; offset <= 2; offset += 1) {
      const next = lines[index + offset];
      if (next === undefined) break;
      const numbers = Array.from(next.matchAll(new RegExp(NUMBER_PATTERN, "g")))
        .map((match) => Number(match[1]))
        .filter((value) => Number.isFinite(value));
      if (keys.length === 1 ? numbers.length < 1 : numbers.length < keys.length) continue;
      for (let item = 0; item < keys.length; item += 1) {
        const key = keys[item];
        const value = numbers[item];
        if (key !== undefined && key.length > 0 && value !== undefined && output.has(key) === false) {
          output.set(key, value);
        }
      }
      break;
    }
  }
  return output;
}

export function parseNpcStatsText(raw: string): ParsedNpcStats {
  const text = normalizeText(raw);
  const attributePairs = collectDirectMatches(text, ATTRIBUTE_GROUPS, false);
  const alignedPairs = extractAlignedPairs(text);

  const attributes: Partial<Record<NpcStatAttributeKey, number>> = {};
  for (const group of ATTRIBUTE_GROUPS) {
    const value = attributePairs.get(group.key) ?? alignedPairs.get(group.key);
    if (value !== undefined && Number.isFinite(value) && value >= 0 && value <= 999) {
      attributes[group.key] = Math.floor(value);
    }
  }

  const vitalPairs = collectDirectMatches(text, VITAL_GROUPS, true);
  const vitalLimits: Record<VitalKey, { readonly min: number; readonly max: number }> = {
    hp: { min: 1, max: 9999 },
    mp: { min: 0, max: 99999 },
    san: { min: 0, max: 999 },
    dp: { min: 0, max: 99999 }
  };
  const vitalValues: Partial<Record<VitalKey, number>> = {};
  for (const group of VITAL_GROUPS) {
    const value = vitalPairs.get(group.key);
    const limit = vitalLimits[group.key];
    if (value !== undefined && Number.isFinite(value) && value >= limit.min && value <= limit.max) {
      vitalValues[group.key] = Math.floor(value);
    }
  }

  const matchedAttributes = Object.keys(attributes).length;
  const matchedVitals = Object.keys(vitalValues).length;
  return {
    attributes,
    maxHp: vitalValues.hp ?? null,
    maxMp: vitalValues.mp ?? null,
    maxSan: vitalValues.san ?? null,
    maxDp: vitalValues.dp ?? null,
    matchedAttributes,
    matchedVitals
  };
}

function scoreOf(parsed: ParsedNpcStats): number {
  return parsed.matchedAttributes * 10 + parsed.matchedVitals * 4;
}

function isUsable(parsed: ParsedNpcStats): boolean {
  return scoreOf(parsed) >= 30;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringListOf(value: unknown): string[] {
  if (typeof value === "string" && value.trim().length > 0) return [value.trim()];
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
  }
  return [];
}

function candidateNamesOf(entry: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const field of ["name", "fullName", "realName", "trueName", "commonName", "nickname", "aliases", "alias", "aka", "alsoKnownAs"]) {
    for (const name of stringListOf(entry[field])) names.add(name);
  }
  if (names.size === 0) {
    const fallback = stringOf(entry.title) || stringOf(entry.id);
    if (fallback.length > 0) names.add(fallback);
  }
  return [...names].filter((name) => name.length >= 2).slice(0, 12);
}

function nameVariants(name: string): string[] {
  const base = name.trim();
  const variants = new Set<string>();
  if (base.length >= 2) variants.add(base);
  for (const separator of ["（", "(", "：", ":", " - ", "—", "【"]) {
    const index = base.indexOf(separator);
    if (index >= 2) variants.add(base.slice(0, index).trim());
  }
  return [...variants].filter((item) => item.length >= 2).slice(0, 6);
}

function bestStatsNearName(sourceText: string, name: string): ParsedNpcStats | null {
  const lower = sourceText.toLowerCase();
  let best: ParsedNpcStats | null = null;
  let bestScore = -1;

  // 属性块绝大多数位于 NPC 名之后：优先只截名字之后的窗口，避免吞到上一个 NPC 的数值。
  for (const variant of nameVariants(name)) {
    const needle = variant.toLowerCase();
    let from = 0;
    let hits = 0;
    while (hits < 8) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      hits += 1;
      const after = sourceText.slice(index, Math.min(sourceText.length, index + 2600));
      if (after.trim().length > 0) {
        const parsed = parseNpcStatsText(after);
        const score = scoreOf(parsed);
        if (score > bestScore) {
          best = parsed;
          bestScore = score;
        }
      }
      from = index + Math.max(1, needle.length);
    }
  }

  // 少数排版把数值放在名字之前，再用前面的窗口兜底。
  if (bestScore < 30) {
    for (const variant of nameVariants(name)) {
      const needle = variant.toLowerCase();
      let from = 0;
      let hits = 0;
      while (hits < 8) {
        const index = lower.indexOf(needle, from);
        if (index < 0) break;
        hits += 1;
        const before = sourceText.slice(Math.max(0, index - 2600), Math.min(sourceText.length, index + 120));
        const parsed = parseNpcStatsText(before);
        const score = scoreOf(parsed);
        if (score > bestScore) {
          best = parsed;
          bestScore = score;
        }
        from = index + Math.max(1, needle.length);
      }
    }
  }

  return bestScore >= 30 ? best : null;
}

function mergeStats(entry: Record<string, unknown>, parsed: ParsedNpcStats): void {
  const attributes = { ...recordOf(entry.attributes) };
  for (const key of NPC_STAT_ATTRIBUTE_KEYS) {
    const value = parsed.attributes[key];
    if (value !== undefined) attributes[key] = value;
  }
  if (Object.keys(attributes).length > 0) entry.attributes = attributes;
  if (parsed.maxHp !== null) entry.maxHp = parsed.maxHp;
  if (parsed.maxMp !== null) entry.maxMp = parsed.maxMp;
  if (parsed.maxSan !== null) entry.maxSan = parsed.maxSan;
  if (parsed.maxDp !== null) entry.maxDp = parsed.maxDp;
}

/**
 * 对一组结构化 NPC 记录做数值回填。
 * 优先读 entry 里的 statText / attributesText 等字段；没有的话再到 source 原文里
 * 找 NPC 名附近窗口。
 */
export function enrichNpcStatsFromSources(
  entries: readonly Record<string, unknown>[],
  sources: readonly NpcStatSource[]
): number {
  let enriched = 0;
  for (const entry of entries) {
    let best: ParsedNpcStats | null = null;
    let bestScore = -1;
    for (const field of ["statText", "attributesText", "statsText", "attributeText", "statLine", "attributes"]) {
      const raw = entry[field];
      if (typeof raw !== "string" || raw.trim().length === 0) continue;
      const parsed = parseNpcStatsText(raw);
      const score = scoreOf(parsed);
      if (score > bestScore) {
        best = parsed;
        bestScore = score;
      }
    }

    for (const name of candidateNamesOf(entry)) {
      for (const source of sources) {
        const parsed = bestStatsNearName(source.text, name);
        if (parsed === null) continue;
        const score = scoreOf(parsed);
        if (score > bestScore) {
          best = parsed;
          bestScore = score;
        }
      }
    }

    if (best === null || isUsable(best) === false) continue;
    mergeStats(entry, best);
    enriched += 1;
  }
  return enriched;
}
