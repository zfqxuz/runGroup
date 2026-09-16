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

/** 「某人/某物的鬼魂」这类描述性称呼不能当作独立身份别名。 */
const GENERIC_ALIAS_SUFFIXES = new Set([
  "鬼魂",
  "幽灵",
  "亡魂",
  "亡灵",
  "怨灵",
  "恶灵",
  "灵魂",
  "魂魄",
  "影子",
  "化身",
  "分身",
  "尸体",
  "躯壳",
  "记忆",
  "声音",
  "幻影",
  "幻象",
  "形象"
]);

function isIdentityAlias(value: string): boolean {
  const index = value.lastIndexOf("的");
  if (index < 0) return true;
  const suffix = value.slice(index + 1).trim();
  return suffix.length > 0 && GENERIC_ALIAS_SUFFIXES.has(suffix) === false;
}

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
    names.push(...stringOf(record[field]).filter(isIdentityAlias));
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

  for (const variant of [...output]) {
    for (const token of ROLE_TOKENS) {
      if (variant.startsWith(token) && variant.length > token.length) output.add(variant.slice(token.length));
      if (variant.endsWith(token) && variant.length > token.length) output.add(variant.slice(0, variant.length - token.length));
    }
  }

  return [...output].filter((item) => item.length >= 2).slice(0, 24);
}

/**
 * 只用于精确身份匹配的昵称变体：
 * - "W·科比特" -> "科比特"
 * - "老科比特" / "小科比特" -> "科比特"
 *
 * 这些变体不进入 npcPrimaryKeys，避免 "科比特" 这种短名通过模糊包含
 * 把 "科比特的鬼魂" 这种独立实体也吸进同一个身份簇。
 */
function identityAliasesOfName(name: string): string[] {
  const output = new Set<string>();
  const trimmed = name.trim();

  const withoutLatinInitial = trimmed.match(
    /^[A-Za-z][\s·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\\-—–]*([\p{Script=Han}][\p{Script=Han}\p{N}·•\-—–]*)$/u
  );
  if (withoutLatinInitial?.[1] !== undefined) {
    const variant = normalizeName(withoutLatinInitial[1]);
    if (variant.length >= 2 && GENERIC_NAME_TOKENS.has(variant) === false) output.add(variant);
  }

  const withoutHonorific = trimmed.match(
    /^(老|小|大|阿)([\p{Script=Han}][\p{Script=Han}\p{N}·•\-—–]*)$/u
  );
  if (withoutHonorific?.[2] !== undefined) {
    const variant = normalizeName(withoutHonorific[2]);
    if (variant.length >= 2 && GENERIC_NAME_TOKENS.has(variant) === false) output.add(variant);
  }

  return [...output];
}

export function npcIdentityKeys(record: NpcRecord): string[] {
  const keys = new Set<string>();
  for (const name of primaryNamesOf(record)) {
    for (const variant of nameVariants(name)) keys.add("n:" + variant);
    for (const alias of identityAliasesOfName(name)) keys.add("n:" + alias);
  }
  return [...keys];
}

/** 只使用主名称做模糊包含匹配；别名只参与精确匹配，避免“某某的别名”污染身份。 */
export function npcPrimaryKeys(record: NpcRecord): string[] {
  const keys = new Set<string>();
  const names: string[] = [];
  for (const field of ["name", "fullName", "realName", "trueName", "commonName", "nickname"]) {
    names.push(...stringOf(record[field]));
  }
  if (names.length === 0) names.push(...stringOf(record.title));
  for (const name of names) {
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
  // 精确 id：主名称和别名都参与，用于合并“全名 / 括号别名”等同一角色。
  for (const key of leftKeys) if (rightSet.has(key)) return true;
  // 模糊包含：只用主名称，避免把某个角色的别名误当成另一个角色的身份。
  const leftPrimary = npcPrimaryKeys(left);
  const rightPrimary = npcPrimaryKeys(right);
  for (const a of leftPrimary) {
    for (const b of rightPrimary) {
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

/**
 * 合并数组字段（skillsFromText / skills / weapons 等）。
 * 字符串按归一化文本去重；对象优先按 id / name / skill / key 去重，
 * 避免旧实现用 uniqueStrings 把所有对象都过滤掉。
 */
function arrayItemKey(value: unknown): string {
  if (typeof value === "string") return "s:" + normalizeName(value);
  if (isRecord(value)) {
    for (const field of ["id", "skill", "name", "key"]) {
      const raw = value[field];
      if (typeof raw === "string" && raw.trim().length > 0) return "o:" + normalizeName(raw);
    }
    return "j:" + JSON.stringify(value);
  }
  return "p:" + String(value);
}

function mergeValueArrays(current: readonly unknown[], value: readonly unknown[]): unknown[] {
  const output = [...current];
  const seen = new Set(output.map(arrayItemKey));
  for (const item of value) {
    if (item === undefined || item === null) continue;
    const key = arrayItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

/** 合并 NPC 的展示别名；不修改 name 字段，只把新名称追加进 aliases。 */
export function mergeNpcAliasNames(record: NpcRecord, names: readonly string[]): void {
  const merged = uniqueStrings([
    ...stringOf(record.aliases),
    ...stringOf(record.alias),
    ...stringOf(record.aka),
    ...stringOf(record.alsoKnownAs),
    ...names
  ]);
  if (merged.length > 0) record.aliases = merged;
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
      output[key] = mergeValueArrays(current, value);
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
