/**
 * NPC 去重。
 *
 * AI 分块 / 图片分析会让同一个角色以“全名 / 简称 / 带括号别名”等不同形态
 * 出现多次；这里按名称变体与包含关系合并，避免最终团本和房间里出现重复 NPC。
 */

export type NpcRecord = Record<string, unknown>;

const ROLE_TOKENS = [
  "boss",
  "npc",
  "小姐",
  "先生",
  "女士",
  "大人",
  "老师",
  "教师",
  "教授",
  "博士",
  "巫女",
  "魔法使",
  "妖怪",
  "人类",
  "店长",
  "老板娘",
  "服务员",
  "佣人",
  "女仆"
];

function isRecord(value: unknown): value is NpcRecord {
  return value !== null && typeof value === "object" && Array.isArray(value) === false;
}

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "");
}

function stripBrackets(value: string): string {
  return value.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, " ");
}

function stringOf(value: unknown): string[] {
  if (typeof value === "string" && value.trim().length > 0) return [value.trim()];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  return [];
}

function primaryNamesOf(record: NpcRecord): string[] {
  const names: string[] = [];
  for (const field of ["name", "fullName", "realName", "trueName", "commonName", "nickname"]) {
    names.push(...stringOf(record[field]));
  }
  for (const field of ["aliases", "alias", "aka", "alsoKnownAs"]) {
    names.push(...stringOf(record[field]));
  }
  if (names.length === 0) {
    names.push(...stringOf(record.title));
  }
  return [...new Set(names.map((item) => item.trim()).filter((item) => item.length > 0))];
}

function nameVariants(name: string): string[] {
  const output = new Set<string>();
  const normalized = normalizeName(name);
  if (normalized.length > 0) output.add(normalized);
  const withoutBrackets = normalizeName(stripBrackets(name));
  if (withoutBrackets.length > 0) output.add(withoutBrackets);

  for (const part of name.split(/[\/、,，;；|·•]+/)) {
    const piece = normalizeName(part);
    if (piece.length >= 2) output.add(piece);
  }

  for (const variant of [...output]) {
    for (const token of ROLE_TOKENS) {
      if (variant.startsWith(token) && variant.length > token.length) output.add(variant.slice(token.length));
      if (variant.endsWith(token) && variant.length > token.length) output.add(variant.slice(0, variant.length - token.length));
    }
  }

  return [...output].filter((item) => item.length >= 2).slice(0, 24);
}

export function npcIdentityKeys(record: NpcRecord): string[] {
  const keys = new Set<string>();
  for (const name of primaryNamesOf(record)) {
    for (const variant of nameVariants(name)) keys.add("n:" + variant);
  }
  return [...keys];
}

const GENERIC_NAME_TOKENS = new Set([
  "恶魔",
  "妖怪",
  "人类",
  "妖精",
  "幽灵",
  "亡灵",
  "女仆",
  "巫女",
  "魔法使",
  "店长",
  "老板娘",
  "村民",
  "士兵",
  "服务员",
  "佣人",
  "小姐",
  "先生",
  "女士",
  "大人",
  "老师",
  "教师",
  "教授",
  "博士",
  "boss",
  "npc"
]);

function containsLikelySameName(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length < 2 || long.includes(short) === false) return false;
  if (GENERIC_NAME_TOKENS.has(short)) return false;
  if (/^[a-z0-9]+$/.test(short)) return short.length >= 4;
  return long.length > short.length;
}

export function npcRecordsLikelySame(left: NpcRecord, right: NpcRecord): boolean {
  const leftKeys = npcIdentityKeys(left);
  const rightKeys = npcIdentityKeys(right);
  if (leftKeys.length === 0 || rightKeys.length === 0) return false;
  const rightSet = new Set(rightKeys);
  for (const key of leftKeys) if (rightSet.has(key)) return true;
  for (const a of leftKeys) {
    for (const b of rightKeys) {
      if (containsLikelySameName(a.slice(2), b.slice(2))) return true;
    }
  }
  return false;
}

function uniqueStrings(values: readonly unknown[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text.length === 0) continue;
    const key = normalizeName(text);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function mergeRecords(left: NpcRecord, right: NpcRecord): NpcRecord {
  const output: NpcRecord = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (value === undefined || value === null || value === "") continue;
    const current = output[key];
    if (current === undefined || current === null || current === "") {
      output[key] = value;
      continue;
    }

    if (key === "name" || key === "fullName" || key === "realName" || key === "trueName" || key === "commonName" || key === "title" || key === "subtitle") {
      if (typeof current === "string" && typeof value === "string") {
        if (value.length > current.length) output[key] = value;
      }
      continue;
    }

    if (key === "description" || key === "bio" || key === "background") {
      if (typeof current === "string" && typeof value === "string") {
        if (value.length > current.length) output[key] = value;
      }
      continue;
    }

    if (key === "statText" || key === "attributesText" || key === "statsText" || key === "attributeText" || key === "statLine") {
      if (typeof current === "string" && typeof value === "string") {
        if (current.includes(value)) continue;
        if (value.includes(current)) {
          output[key] = value;
          continue;
        }
        output[key] = current + "\n" + value;
      }
      continue;
    }

    if (key === "aliases" || key === "alias" || key === "aka" || key === "alsoKnownAs" || key === "tags") {
      output[key] = uniqueStrings([
        ...(Array.isArray(current) ? current : [current]),
        ...(Array.isArray(value) ? value : [value])
      ]);
      continue;
    }

    if (isRecord(current) && isRecord(value)) {
      output[key] = mergeRecords(current, value);
      continue;
    }

    if (Array.isArray(current) && Array.isArray(value)) {
      output[key] = uniqueStrings([...current, ...value]);
      continue;
    }

    // 数字 / 布尔 / 其他冲突：保留先出现的记录（文本分块通常先于图片分析）。
  }

  const aliases = uniqueStrings([
    ...stringOf(output.aliases),
    ...stringOf(output.alias),
    ...stringOf(output.aka),
    ...stringOf(output.alsoKnownAs),
    ...primaryNamesOf(left),
    ...primaryNamesOf(right)
  ]);
  if (aliases.length > 1) output.aliases = aliases;
  return output;
}

/** 合并重复 NPC；返回新数组，不修改入参数组里的对象引用关系（会保留合并后的新对象）。 */
export function dedupeNpcRecords(records: readonly NpcRecord[]): NpcRecord[] {
  const output = records.map((record) => ({ ...record }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < output.length; i += 1) {
      for (let j = i + 1; j < output.length; j += 1) {
        const left = output[i];
        const right = output[j];
        if (left === undefined || right === undefined) continue;
        if (npcRecordsLikelySame(left, right) === false) continue;
        output[i] = mergeRecords(left, right);
        output.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return output;
}
