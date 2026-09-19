import {
  parseStructuredBlocks,
  structuredOfContent,
  type StructuredModuleEntry
} from "@/server/modules/structure";

/**
 * 团本 NPC 数值同步：
 * - 页面删除 NPC 时，正文里的 yaml module-npc 块会被一起删掉，只剩正文数值行；
 * - dsh 重新补 NPC 时容易编数值、抄错隔壁 NPC，所以这里以正文为准做确定性回填。
 *
 * 规则：
 * 1. yaml module-npc 块优先提供显式字段（attributes / maxHp / maxMp / maxSan / maxDp / armor）；
 * 2. 再解析「名字 + 数值」的紧邻行，例如「鼠群：STR 35 CON 55 ... HP 9 MP 10」；
 * 3. 只在同一行解析，禁止跨 2600 字符泛窗口搜索，避免串到隔壁 NPC；
 * 4. 字段级 merge：正文没有提供的字段保留原值，不会因为 dsh 漏返回就清空。
 */

interface ParsedStats {
  readonly attributes: Readonly<Record<string, number>>;
  readonly maxHp: number | null;
  readonly maxMp: number | null;
  readonly maxSan: number | null;
  readonly maxDp: number | null;
  readonly armor: string | null;
}

const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  str: "str",
  strength: "str",
  力量: "str",
  con: "con",
  constitution: "con",
  体质: "con",
  siz: "siz",
  size: "siz",
  体型: "siz",
  dex: "dex",
  dexterity: "dex",
  敏捷: "dex",
  app: "app",
  appearance: "app",
  外貌: "app",
  int: "int",
  intelligence: "int",
  智力: "int",
  pow: "pow",
  power: "pow",
  意志: "pow",
  edu: "edu",
  education: "edu",
  教育: "edu",
  luck: "luck",
  幸运: "luck"
};

const VITAL_ALIASES: Readonly<Record<string, keyof Pick<ParsedStats, "maxHp" | "maxMp" | "maxSan" | "maxDp">>> = {
  hp: "maxHp",
  "生命": "maxHp",
  "生命值": "maxHp",
  mp: "maxMp",
  "魔法": "maxMp",
  "魔法值": "maxMp",
  san: "maxSan",
  "理智": "maxSan",
  "理智值": "maxSan",
  dp: "maxDp",
  "耐久": "maxDp"
};

const ARMOR_ALIASES = ["护甲", "护甲值", "armor"] as const;

const ATTRIBUTE_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s·・.,，。:：;；\-—_/\\()[\]{}"'`]/g, "");
}

function dataOf(entry: StructuredModuleEntry): Record<string, unknown> {
  return entry.data !== null && typeof entry.data === "object" ? entry.data : {};
}

function rawKeysOf(entry: StructuredModuleEntry): readonly string[] {
  const data = dataOf(entry);
  const values: unknown[] = [entry.id, data.id, data.name, data.title];
  const aliases = data.aliases;
  if (Array.isArray(aliases)) values.push(...aliases);
  const output: string[] = [];
  for (const value of values) {
    const key = String(value ?? "").trim();
    if (key.length > 0) output.push(key);
  }
  return output;
}

function keysOf(entry: StructuredModuleEntry): readonly string[] {
  const output: string[] = [];
  for (const value of rawKeysOf(entry)) {
    const key = normalizeKey(value);
    if (key.length > 0) output.push(key);
  }
  return output;
}

function findEntry(entries: StructuredModuleEntry[], incomingKeys: readonly string[]): StructuredModuleEntry | undefined {
  const wanted = new Set(incomingKeys);
  return entries.find((entry) => keysOf(entry).some((key) => wanted.has(key)));
}

function parseStats(fragment: string): ParsedStats {
  const labels = [
    ...Object.keys(ATTRIBUTE_ALIASES),
    ...Object.keys(VITAL_ALIASES),
    ...ARMOR_ALIASES
  ].sort((left, right) => right.length - left.length);
  const pattern = new RegExp(
    "(?<![A-Za-z])(" + labels.map(escapeRegExp).join("|") + ")(?![A-Za-z])\\s*[:：=]?\\s*([+-]?\\d{1,4}|\\d+[dD]\\d+(?:[+-]\\d+)?)",
    "gi"
  );
  const attributes: Record<string, number> = {};
  let maxHp: number | null = null;
  let maxMp: number | null = null;
  let maxSan: number | null = null;
  let maxDp: number | null = null;
  let armor: string | null = null;

  for (const match of fragment.matchAll(pattern)) {
    const rawLabel = String(match[1] ?? "");
    const rawValue = String(match[2] ?? "");
    const lowerLabel = rawLabel.toLowerCase();
    const attributeKey = ATTRIBUTE_ALIASES[lowerLabel] ?? ATTRIBUTE_ALIASES[rawLabel];
    if (attributeKey !== undefined) {
      if (/^[+-]?\d+$/.test(rawValue)) {
        const value = Number(rawValue);
        if (Number.isFinite(value) && value >= 0 && value <= 999) attributes[attributeKey] = Math.floor(value);
      }
      continue;
    }
    const vitalKey = VITAL_ALIASES[lowerLabel] ?? VITAL_ALIASES[rawLabel];
    if (vitalKey !== undefined) {
      if (/^[+-]?\d+$/.test(rawValue)) {
        const value = Number(rawValue);
        if (Number.isFinite(value) && value >= 0 && value <= 99999) {
          if (vitalKey === "maxHp") maxHp = Math.floor(value);
          else if (vitalKey === "maxMp") maxMp = Math.floor(value);
          else if (vitalKey === "maxSan") maxSan = Math.floor(value);
          else maxDp = Math.floor(value);
        }
      }
      continue;
    }
    if (ARMOR_ALIASES.some((alias) => alias.toLowerCase() === lowerLabel)) {
      armor = rawValue.toUpperCase();
    }
  }

  return { attributes, maxHp, maxMp, maxSan, maxDp, armor };
}

function isAuthoritative(parsed: ParsedStats): boolean {
  const attributeCount = Object.keys(parsed.attributes).length;
  if (attributeCount >= 5) return true;
  return attributeCount >= 3 && (parsed.maxHp !== null || parsed.maxMp !== null);
}

function scoreOfStats(parsed: ParsedStats): number {
  return Object.keys(parsed.attributes).length
    + (parsed.maxHp !== null ? 1 : 0)
    + (parsed.maxMp !== null ? 1 : 0)
    + (parsed.maxSan !== null ? 1 : 0)
    + (parsed.maxDp !== null ? 1 : 0);
}

function scoreOfData(data: Record<string, unknown>): number {
  const attributes = data.attributes;
  const attributeCount = attributes !== null && typeof attributes === "object" && Array.isArray(attributes) === false
    ? Object.keys(attributes as Record<string, unknown>).length
    : 0;
  return attributeCount
    + (typeof data.maxHp === "number" ? 1 : 0)
    + (typeof data.maxMp === "number" ? 1 : 0)
    + (typeof data.maxSan === "number" ? 1 : 0)
    + (typeof data.maxDp === "number" ? 1 : 0);
}

function mergeStats(target: Record<string, unknown>, parsed: ParsedStats, overwrite: boolean): void {
  const attributes = target.attributes !== null && typeof target.attributes === "object" && Array.isArray(target.attributes) === false
    ? { ...(target.attributes as Record<string, unknown>) }
    : {};
  for (const [key, value] of Object.entries(parsed.attributes)) {
    if (overwrite || attributes[key] === undefined) attributes[key] = value;
  }
  if (Object.keys(attributes).length > 0) target.attributes = attributes;

  const vitalKeys = ["maxHp", "maxMp", "maxSan", "maxDp"] as const;
  for (const key of vitalKeys) {
    const value = parsed[key];
    if (value === null) continue;
    if (overwrite || target[key] === undefined || target[key] === null) target[key] = value;
  }
  if (parsed.armor !== null && (overwrite || target.armor === undefined || target.armor === null)) {
    target.armor = parsed.armor;
  }
}

function createNpcData(name: string, parsed: ParsedStats): Record<string, unknown> {
  return {
    id: "npc-" + normalizeKey(name).slice(0, 40),
    name,
    title: name,
    aliases: [],
    attributes: { ...parsed.attributes },
    maxHp: parsed.maxHp,
    maxMp: parsed.maxMp,
    maxSan: parsed.maxSan,
    maxDp: parsed.maxDp,
    armor: parsed.armor,
    description: "",
    tags: [],
    tier: "STANDARD",
    rarity: "COMMON",
    skills: [],
    weapons: [],
    skillsFromText: []
  };
}

function applyBlockEntries(entries: StructuredModuleEntry[], text: string): void {
  const parsed = parseStructuredBlocks(text);
  for (const block of parsed.npcs) {
    const data = dataOf(block);
    const name = String(data.name ?? data.title ?? block.title ?? "").trim();
    if (name.length === 0) continue;
    const incomingKeys = keysOf(block);
    const target = findEntry(entries, incomingKeys);
    if (target === undefined) {
      entries.push({
        kind: "npc",
        id: block.id,
        title: name,
        data: { ...data, id: block.id, name, title: name }
      });
      continue;
    }
    mergeNpcData(dataOf(target), data, true);
  }
}

function mergeNpcData(target: Record<string, unknown>, incoming: Record<string, unknown>, overwrite: boolean): void {
  const attributes = incoming.attributes;
  if (attributes !== null && typeof attributes === "object" && Array.isArray(attributes) === false) {
    const parsed: ParsedStats = {
      attributes: attributes as Record<string, number>,
      maxHp: typeof incoming.maxHp === "number" ? incoming.maxHp : null,
      maxMp: typeof incoming.maxMp === "number" ? incoming.maxMp : null,
      maxSan: typeof incoming.maxSan === "number" ? incoming.maxSan : null,
      maxDp: typeof incoming.maxDp === "number" ? incoming.maxDp : null,
      armor: typeof incoming.armor === "string" ? incoming.armor : null
    };
    mergeStats(target, parsed, overwrite);
  } else {
    const parsed: ParsedStats = {
      attributes: {},
      maxHp: typeof incoming.maxHp === "number" ? incoming.maxHp : null,
      maxMp: typeof incoming.maxMp === "number" ? incoming.maxMp : null,
      maxSan: typeof incoming.maxSan === "number" ? incoming.maxSan : null,
      maxDp: typeof incoming.maxDp === "number" ? incoming.maxDp : null,
      armor: typeof incoming.armor === "string" ? incoming.armor : null
    };
    mergeStats(target, parsed, overwrite);
  }
  for (const key of ["name", "title", "description", "tags", "tier", "rarity", "skills", "weapons", "skillsFromText"]) {
    const value = incoming[key];
    if (value === undefined || value === null) continue;
    if (overwrite || target[key] === undefined || target[key] === null) target[key] = value;
  }
}

function applyNamedLines(entries: StructuredModuleEntry[], text: string, addMissing: boolean, forceOverwrite: boolean): void {
  const lines = String(text ?? "").split(/\r?\n/);
  let inFence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.length === 0) continue;

    // 1) 已有 NPC 的别名/名字打头：严格只解析本行剩余部分。
    let matched = false;
    const byAlias = entries
      .flatMap((entry) => rawKeysOf(entry).map((key) => ({ key, entry })))
      .filter((item) => item.key.length >= 1)
      .sort((left, right) => right.key.length - left.key.length);
    for (const alias of byAlias) {
      if (line.startsWith(alias.key) === false) continue;
      const rest = line.slice(alias.key.length);
      const parsed = parseStats(rest);
      if (Object.keys(parsed.attributes).length === 0 && parsed.maxHp === null && parsed.maxMp === null) continue;
      const targetData = dataOf(alias.entry);
      mergeStats(targetData, parsed, forceOverwrite || (isAuthoritative(parsed) && scoreOfStats(parsed) > scoreOfData(targetData)));
      matched = true;
      break;
    }
    if (matched) continue;

    // 2) 未知名字的「名字：数值」行：只有解析出足够数值时才补成新 NPC。
    if (addMissing === false) continue;
    const candidate = /^([^:：\n]{1,48}?)[:：]\s*(.+)$/.exec(line);
    if (candidate === null) continue;
    const name = (candidate[1] ?? "").trim();
    if (name.length < 2) continue;
    if (/^(summary|content|description|name|title|id|type|kind|trigger|note|check|armor|maxHp|maxMp|maxSan)$/i.test(name)) continue;
    const parsed = parseStats(candidate[2] ?? "");
    if (isAuthoritative(parsed) === false) continue;
    const incomingKeys = [normalizeKey(name)];
    const target = findEntry(entries, incomingKeys);
    if (target !== undefined) {
      mergeStats(dataOf(target), parsed, true);
      continue;
    }
    entries.push({
      kind: "npc",
      id: "npc-" + normalizeKey(name).slice(0, 40),
      title: name,
      data: createNpcData(name, parsed)
    });
  }
}

export interface NpcTextSyncInput {
  readonly newText: string;
  readonly fallbackText?: string;
  readonly structured: Record<string, unknown>;
  /** 用户明确要求补回缺失对象时，才允许从旧正文新增 NPC。 */
  readonly recoverMissing?: boolean;
}

export function syncNpcStatsFromText(input: NpcTextSyncInput): Record<string, unknown> {
  const base = structuredOfContent({ structured: input.structured });
  const entries: StructuredModuleEntry[] = [...base.npcs];

  const recoverMissing = input.recoverMissing === true;
  // YAML 块反映页面上的结构化编辑，先作为基础。
  applyBlockEntries(entries, input.newText);
  // 用户明确要求补回缺失对象时，正文数值行是最终裁决，顺序上让新正文覆盖旧正文。
  if (typeof input.fallbackText === "string" && input.fallbackText.length > 0) {
    applyNamedLines(entries, input.fallbackText, recoverMissing, recoverMissing);
  }
  applyNamedLines(entries, input.newText, true, recoverMissing);

  return { ...input.structured, npcs: entries };
}
