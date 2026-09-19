"use strict";

/**
 * 确定性 NPC 数值解析核心。
 *
 * 这个文件会被 scripts/build-n8n-workflows.mjs 内联进 n8n Code 节点。
 * 也可以在离线测试里直接 require，重点覆盖：
 * - 英文缩写 / 中文属性名 / 分隔符 / 全角数字
 * - 同一行、逗号分隔、表格标签行 + 数值行
 * - 3d6 这类骰点不会被误读为 3
 * - 按 NPC 名字附近窗口回填，避免串读相邻 NPC
 * - 额外从原文中直接收割带名字的数值块（AI 漏掉的 NPC 也能补回来）
 */

const NPC_STAT_ATTRIBUTE_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"];

const ATTRIBUTE_GROUPS = [
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

const VITAL_GROUPS = [
  { key: "hp", aliases: ["hit points", "hit point", "hp", "生命值", "生命", "耐久值", "耐久力", "耐久", "体力", "血量"] },
  { key: "mp", aliases: ["magic points", "magic point", "mp", "魔法值", "魔法点", "魔法", "魔力", "mp值"] },
  { key: "san", aliases: ["san值", "san", "理智值", "理智"] },
  { key: "dp", aliases: ["dp值", "dp"] }
];

const SEPARATORS = "[ \\t:：=,，;；|/()（）为是值可有达到\"\']{0,12}";
const NUMBER_PATTERN = "(\\d{1,4})(?![0-9])(?![dD]\\d)";
const SIGNED_NUMBER_PATTERN = "([+-]?\\d{1,5})(?![0-9])(?![dD]\\d)";
const ALL_GROUPS = [...ATTRIBUTE_GROUPS, ...VITAL_GROUPS];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/[\uFF10-\uFF19]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/＝/g, "=")
    // HTML / XML 表格：标签换成空格，保留单元格文本，方便按表格解析。
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"");
}

function normalizeNameKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "")
    .slice(0, 120);
}

function parseArmorExpression(value) {
  const text = normalizeText(value);
  if (text.length === 0) return null;
  const patterns = [
    /["']?(?:护甲|护甲值|armor)["']?\s*[:：=]?\s*(\d+[dD]\d+(?:\s*[+-]\s*\d+)?|\d+)/i,
    /(?:获得|拥有|有|提供|给予|增加|提升)\s*(\d+[dD]\d+(?:\s*[+-]\s*\d+)?|\d+)\s*(?:点)?\s*(?:的)?\s*(?:防非魔法伤害的)?护甲/i,
    /(\d+[dD]\d+(?:\s*[+-]\s*\d+)?|\d+)\s*点?\s*(?:防非魔法伤害的)?护甲/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1] !== undefined) return String(match[1]).replace(/\s+/g, "").toUpperCase();
  }
  return null;
}

function groupValue(groups, alias) {
  const key = String(alias || "").trim().toLowerCase();
  for (const group of groups) {
    if (group.aliases.some((item) => item.toLowerCase() === key)) return group.key;
  }
  return undefined;
}

function collectDirectMatches(text, groups, signed) {
  const output = new Map();
  const aliases = groups.flatMap((group) => group.aliases);
  const english = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias)).sort((a, b) => b.length - a.length);
  const chinese = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias) === false).sort((a, b) => b.length - a.length);
  const numberPattern = signed ? SIGNED_NUMBER_PATTERN : NUMBER_PATTERN;
  const found = [];

  if (english.length > 0) {
    const labelPattern = "(?<![a-z])(" + english.map(escapeRegExp).join("|") + ")(?![a-z])";
    const pattern = new RegExp(labelPattern + SEPARATORS + numberPattern, "gi");
    for (const match of text.matchAll(pattern)) {
      const key = groupValue(groups, match[1] || "");
      if (key === undefined) continue;
      const value = Number(match[2]);
      if (Number.isFinite(value)) found.push({ index: match.index ?? 0, key, value });
    }
  }
  if (chinese.length > 0) {
    const pattern = new RegExp("(" + chinese.map(escapeRegExp).join("|") + ")" + SEPARATORS + numberPattern, "g");
    for (const match of text.matchAll(pattern)) {
      const key = groupValue(groups, match[1] || "");
      if (key === undefined) continue;
      const value = Number(match[2]);
      if (Number.isFinite(value)) found.push({ index: match.index ?? 0, key, value });
    }
  }

  // 按正文出现顺序取每个属性的首个值，避免后出现的英文标签覆盖更早的中文数值。
  found.sort((left, right) => left.index - right.index);
  for (const item of found) {
    if (output.has(item.key) === false) output.set(item.key, item.value);
  }
  return output;
}

function containsValueAfterLabel(line, groups) {
  const aliases = groups.flatMap((group) => group.aliases).sort((a, b) => b.length - a.length);
  if (aliases.length === 0) return false;
  const english = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias));
  const chinese = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias) === false);
  const patterns = [];
  if (english.length > 0) patterns.push(new RegExp("(?<![a-z])(?:" + english.map(escapeRegExp).join("|") + ")(?![a-z])" + SEPARATORS + NUMBER_PATTERN, "i"));
  if (chinese.length > 0) patterns.push(new RegExp("(?:" + chinese.map(escapeRegExp).join("|") + ")" + SEPARATORS + NUMBER_PATTERN));
  return patterns.some((pattern) => pattern.test(line));
}

function labelsInOrder(line, groups) {
  const aliases = groups.flatMap((group) => group.aliases).sort((a, b) => b.length - a.length);
  const english = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias));
  const chinese = aliases.filter((alias) => /^[a-z0-9 ]+$/i.test(alias) === false);
  const patternParts = [];
  if (english.length > 0) patternParts.push("(?<![a-z])(?:" + english.map(escapeRegExp).join("|") + ")(?![a-z])");
  if (chinese.length > 0) patternParts.push("(?:" + chinese.map(escapeRegExp).join("|") + ")");
  if (patternParts.length === 0) return [];
  const pattern = new RegExp(patternParts.join("|"), "gi");
  return Array.from(line.matchAll(pattern)).map((match) => groupValue(groups, match[0]) || "").filter((key) => key.length > 0);
}

function extractAlignedPairs(text) {
  const output = new Map();
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const allAliases = ALL_GROUPS.flatMap((group) => group.aliases).sort((left, right) => right.length - left.length);
  const anyLabel = new RegExp("(" + allAliases.map(escapeRegExp).join("|") + ")", "gi");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (line.length > 240 || containsValueAfterLabel(line, ALL_GROUPS)) continue;
    const keys = labelsInOrder(line, ALL_GROUPS);
    if (keys.length < 1) continue;
    // 标签行必须只由标签 + 分隔符组成；正文里出现“敏捷”这种词不能被当成表头。
    const leftover = line.replace(anyLabel, "").replace(/[\s:：=,，;；|/()（）【】\[\]{}"']+/g, "");
    if (leftover.length > 0) continue;
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


// ---------------------------------------------------------------------------
// 表格 / 三行无标签数值块解析（覆盖 CSV / TSV / Markdown 表格 / HTML 表格 /
// 官方模组常见的“STR CON SIZ ... / INT POW EDU ... / DB Build MOV MP”排版）
// ---------------------------------------------------------------------------

function htmlCellTokens(line) {
  const matches = Array.from(String(line).matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi));
  return matches.map((match) => String(match[1] || "").replace(/<[^>]*>/g, " ").trim());
}

function cellTokens(line) {
  const html = htmlCellTokens(line);
  if (html.length > 0) return html;
  const text = String(line || "");
  if (/[|\t]/.test(text)) return text.split(/[|\t]+/).map((item) => item.trim()).filter((item) => item.length > 0);
  if (/[,，;；]/.test(text)) return text.split(/[,，;；]+/).map((item) => item.trim()).filter((item) => item.length > 0);
  return text.split(/\s+/).map((item) => item.trim()).filter((item) => item.length > 0);
}

function cleanCell(value) {
  return String(value || "").replace(/^[\s|"']+|[\s|"']+$/g, "").trim();
}

function headerKeyOfCell(value) {
  const cleaned = cleanCell(value);
  if (cleaned.length === 0) return null;
  const direct = groupValue(ALL_GROUPS, cleaned);
  if (direct !== undefined) return direct;
  for (const group of ALL_GROUPS) {
    for (const alias of group.aliases) {
      if (alias.length === 0) continue;
      const pattern = /^[a-z0-9 ]+$/i.test(alias)
        ? new RegExp("(?<![a-z])" + escapeRegExp(alias) + "(?![a-z])", "i")
        : new RegExp(escapeRegExp(alias));
      if (pattern.test(cleaned)) return group.key;
    }
  }
  return null;
}

function cellNumber(value) {
  const text = cleanCell(value).replace(/[，,]+$/, "");
  if (/^[—–－-]+$/.test(text)) return null;
  const match = /^([+-]?\d{1,4})(?![0-9])(?![dD]\d)/.exec(text);
  if (match === null) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function isHeaderSeparator(line) {
  return String(line || "").replace(/[|\s:，,;；=+\-—–_]/g, "").length === 0;
}

function looksLikeNameHeader(value) {
  return /(?:^|[\s_\-])(name|npc|title|名称|姓名|角色|单位)(?:$|[\s_\-])/i.test(cleanCell(value));
}

/** 解析“表头 + 多行数值”的表格；返回带行号的记录，便于调用方标记已消费行。 */
function parseTableRecords(lines) {
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    const headerCells = cellTokens(lines[index]);
    if (headerCells.length < 2) continue;
    const keys = headerCells.map((cell) => headerKeyOfCell(cell));
    if (keys.filter((key) => key !== null).length < 2) continue;

    let nameIndex = -1;
    for (let column = 0; column < headerCells.length; column += 1) {
      if (keys[column] !== null) continue;
      if (looksLikeNameHeader(headerCells[column])) {
        nameIndex = column;
        break;
      }
    }
    if (nameIndex < 0) {
      const firstLabel = keys.findIndex((key) => key !== null);
      // 没有显式 name 列时，若第一列不是属性标签，按第一列是名字处理（覆盖“| 名称 | 力量 |...”）
      if (firstLabel > 0) nameIndex = 0;
    }

    let cursor = index + 1;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (String(line).trim().length === 0) break;
      if (isHeaderSeparator(line)) {
        cursor += 1;
        continue;
      }
      const cells = cellTokens(line);
      if (cells.length < 2) break;
      const rowKeys = cells.map((cell) => headerKeyOfCell(cell)).filter((key) => key !== null);
      if (rowKeys.length >= 2) break;
      const attributes = {};
      const vitals = {};
      for (let column = 0; column < Math.min(cells.length, keys.length); column += 1) {
        const key = keys[column];
        if (key === null || key === undefined) continue;
        const number = cellNumber(cells[column]);
        if (number === null) continue;
        if (ATTRIBUTE_GROUPS.some((group) => group.key === key)) attributes[key] = number;
        else vitals[key] = number;
      }
      if (Object.keys(attributes).length >= 2) {
        records.push({
          rowIndex: cursor,
          headerIndex: index,
          name: nameIndex >= 0 && cells[nameIndex] !== undefined ? cleanCell(cells[nameIndex]) : "",
          attributes,
          vitals,
          matchedAttributes: Object.keys(attributes).length,
          matchedVitals: Object.keys(vitals).length
        });
      }
      cursor += 1;
    }
  }
  return records;
}

const POSITIONAL_ATTR_KEYS_1 = ["str", "con", "siz", "dex", "app"];
const POSITIONAL_ATTR_KEYS_2 = ["int", "pow", "edu", "luck"];

function positionalTokens(line, allowDice) {
  const raw = String(line || "").split(/[\s|,，;；]+/).map((token) => token.trim()).filter((token) => token.length > 0);
  const output = [];
  for (const token of raw) {
    if (/^[—–－-]+$/.test(token)) {
      output.push("—");
      continue;
    }
    if (/^\d{1,4}$/.test(token)) {
      output.push(Number(token));
      continue;
    }
    if (allowDice && /^[+-]?\d{1,3}[dD]\d{1,2}(?:[+-]\d{1,3})?$/.test(token)) {
      output.push(token.toUpperCase());
      continue;
    }
    // 其余字符视为 OCR 噪声，直接忽略（例如夹杂的“捷”）。
  }
  return output;
}

/** 解析官方模组常见的三行无标签数值块；校验 MP = floor(POW/5) 以降低误判。 */
function parsePositionalBlock(raw) {
  const lines = String(raw || "").split("\n").map((line) => line.trim());
  for (let index = 0; index + 2 < lines.length; index += 1) {
    const first = positionalTokens(lines[index], false);
    if (first.length !== 5) continue;
    const second = positionalTokens(lines[index + 1], false);
    if (second.length !== 5) continue;
    const third = positionalTokens(lines[index + 2], true);
    if (third.length !== 4) continue;
    const numericFirst = first.filter((value) => value !== "—").length;
    const numericSecond = second.filter((value) => value !== "—").length;
    if (numericFirst + numericSecond < 6) continue;
    const pow = typeof second[1] === "number" ? second[1] : null;
    const mp = typeof third[3] === "number" ? third[3] : null;
    if (pow !== null && mp !== null && Math.floor(pow / 5) !== mp) continue;

    const attributes = {};
    POSITIONAL_ATTR_KEYS_1.forEach((key, position) => {
      if (typeof first[position] === "number") attributes[key] = first[position];
    });
    POSITIONAL_ATTR_KEYS_2.forEach((key, position) => {
      if (typeof second[position] === "number") attributes[key] = second[position];
    });

    const vitals = {};
    if (typeof attributes.con === "number" && typeof attributes.siz === "number") {
      vitals.hp = Math.max(1, Math.floor((attributes.con + attributes.siz) / 10));
    } else if (typeof second[4] === "number") {
      vitals.hp = second[4];
    }
    if (typeof attributes.pow === "number") {
      vitals.mp = Math.floor(attributes.pow / 5);
    } else if (typeof third[3] === "number") {
      vitals.mp = third[3];
    }
    return {
      attributes,
      vitals,
      db: third[0],
      build: typeof third[1] === "number" ? third[1] : null,
      move: typeof third[2] === "number" ? third[2] : null,
      matchedAttributes: Object.keys(attributes).length,
      matchedVitals: Object.keys(vitals).length
    };
  }
  return null;
}

function parseNpcStatsText(raw) {
  const text = normalizeText(raw);
  const attributePairs = collectDirectMatches(text, ATTRIBUTE_GROUPS, false);
  const vitalPairs = collectDirectMatches(text, VITAL_GROUPS, true);
  const alignedPairs = extractAlignedPairs(text);
  const positional = parsePositionalBlock(text);

  const attributes = {};
  for (const group of ATTRIBUTE_GROUPS) {
    const value = attributePairs.get(group.key)
      ?? alignedPairs.get(group.key)
      ?? (positional !== null ? positional.attributes[group.key] : undefined);
    if (value !== undefined && value !== null && Number.isFinite(value) && value >= 0 && value <= 999) {
      attributes[group.key] = Math.floor(value);
    }
  }

  const vitalValues = {};
  const vitalLimits = {
    hp: { min: 1, max: 9999 },
    mp: { min: 0, max: 99999 },
    san: { min: 0, max: 999 },
    dp: { min: 0, max: 99999 }
  };
  for (const group of VITAL_GROUPS) {
    const value = vitalPairs.get(group.key)
      ?? alignedPairs.get(group.key)
      ?? (positional !== null ? positional.vitals[group.key] : undefined);
    const limit = vitalLimits[group.key];
    if (value !== undefined && value !== null && Number.isFinite(value) && value >= limit.min && value <= limit.max) {
      vitalValues[group.key] = Math.floor(value);
    }
  }

  // 没有显式 HP / MP 时按 COC7 规则从属性推导，避免缺项落到默认值。
  if (vitalValues.hp === undefined && typeof attributes.con === "number" && typeof attributes.siz === "number") {
    vitalValues.hp = Math.max(1, Math.floor((attributes.con + attributes.siz) / 10));
  }
  if (vitalValues.mp === undefined && typeof attributes.pow === "number") {
    vitalValues.mp = Math.floor(attributes.pow / 5);
  }

  return {
    attributes,
    maxHp: vitalValues.hp ?? null,
    maxMp: vitalValues.mp ?? null,
    maxSan: vitalValues.san ?? null,
    maxDp: vitalValues.dp ?? null,
    armor: parseArmorExpression(text) ?? (positional !== null ? null : null),
    matchedAttributes: Object.keys(attributes).length,
    matchedVitals: Object.keys(vitalValues).length
  };
}

function scoreOf(parsed) {
  return (parsed.matchedAttributes || 0) * 10 + (parsed.matchedVitals || 0) * 4;
}

function isUsable(parsed) {
  return scoreOf(parsed) >= 30;
}

function recordOf(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function stringOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringListOf(value) {
  if (typeof value === "string" && value.trim().length > 0) return [value.trim()];
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
  }
  return [];
}

function candidateNamesOf(entry) {
  const names = new Set();
  for (const field of ["name", "fullName", "realName", "trueName", "commonName", "nickname", "aliases", "alias", "aka", "alsoKnownAs"]) {
    for (const name of stringListOf(entry[field])) names.add(name);
  }
  if (names.size === 0) {
    const fallback = stringOf(entry.title) || stringOf(entry.id);
    if (fallback.length > 0) names.add(fallback);
  }
  return [...names].filter((name) => name.length >= 1).slice(0, 12);
}

function nameVariants(name) {
  const base = String(name || "").trim();
  const variants = new Set();
  if (base.length >= 1) variants.add(base);
  for (const separator of ["（", "(", "：", ":", " - ", "—", "【"]) {
    const index = base.indexOf(separator);
    if (index >= 2) variants.add(base.slice(0, index).trim());
  }
  return [...variants].filter((item) => item.length >= 1).slice(0, 6);
}

function truncateAtNextHeading(text, currentName) {
  const lines = String(text || "").split("\n");
  const output = [lines[0] ?? ""];
  const currentKey = normalizeNameKey(currentName);
  for (let index = 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "").trim();
    // 数值行 / 三行无标签块 / 带噪声的属性行不能当成下一个 NPC 标题。
    if (positionalTokens(line, true).length >= 3 && /[0-9—]/.test(line)) {
      output.push(lines[index]);
      continue;
    }
    // JSON / YAML 的结构符号行不能当成标题。
    if (/^[\{\}\[\],;]+$/.test(line)) {
      output.push(lines[index]);
      continue;
    }
    // 护甲 / DB / 体格 / 移动等数值元信息也不能当成标题。
    if (/^(?:["']?(?:护甲|护甲值|armor|db|build|move|mov|伤害加值|体格|移动)["']?)\s*[:：=]?\s*[+\-]?\d/i.test(line)) {
      output.push(lines[index]);
      continue;
    }
    const candidate = isLikelyNpcHeading(line);
    if (candidate.length > 0) {
      const candidateKey = normalizeNameKey(candidate);
      if (candidateKey.length > 0 && candidateKey.includes(currentKey) === false && currentKey.includes(candidateKey) === false) break;
    }
    output.push(lines[index]);
  }
  return output.join("\n");
}

function bestStatsNearName(sourceText, name) {
  const source = String(sourceText || "");
  const lower = source.toLowerCase();
  let best = null;
  let bestScore = -1;

  for (const variant of nameVariants(name)) {
    const needle = variant.toLowerCase();
    let from = 0;
    let hits = 0;
    while (hits < 8) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      hits += 1;
      const after = truncateAtNextHeading(source.slice(index, Math.min(source.length, index + 2600)), name);
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

  if (bestScore < 30) {
    for (const variant of nameVariants(name)) {
      const needle = variant.toLowerCase();
      let from = 0;
      let hits = 0;
      while (hits < 8) {
        const index = lower.indexOf(needle, from);
        if (index < 0) break;
        hits += 1;
        const before = source.slice(Math.max(0, index - 2600), Math.min(source.length, index + 120));
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

function mergeStats(entry, parsed) {
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
  if (parsed.armor !== null && parsed.armor !== undefined) entry.armor = parsed.armor;
}

function enrichNpcStatsFromSources(entries, sources) {
  let enriched = 0;
  for (const entry of entries) {
    let best = null;
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

function parsedFromEntry(entry) {
  const attrs = recordOf(entry.attributes);
  const attributes = {};
  for (const key of NPC_STAT_ATTRIBUTE_KEYS) {
    const upper = key.toUpperCase();
    const raw = attrs[key] ?? attrs[upper];
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0 && value <= 999) attributes[key] = Math.floor(value);
  }
  const vital = (name) => {
    const value = Number(entry[name]);
    return Number.isFinite(value) ? Math.floor(value) : null;
  };
  const parsed = {
    attributes,
    maxHp: vital("maxHp"),
    maxMp: vital("maxMp"),
    maxSan: vital("maxSan"),
    maxDp: vital("maxDp"),
    armor: typeof entry.armor === "string" && entry.armor.trim().length > 0
      ? entry.armor.trim()
      : parseArmorExpression(entry.statText || entry.attributesText || entry.statsText || entry.attributeText || entry.statLine || ""),
    matchedAttributes: Object.keys(attributes).length,
    matchedVitals: 0
  };
  if (parsed.maxHp !== null) parsed.matchedVitals += 1;
  if (parsed.maxMp !== null) parsed.matchedVitals += 1;
  if (parsed.maxSan !== null) parsed.matchedVitals += 1;
  if (parsed.maxDp !== null) parsed.matchedVitals += 1;
  return parsed;
}

function isLikelyNpcHeading(raw) {
  let line = String(raw || "").trim();
  if (line.length === 0) return "";
  line = line.replace(/^#{1,6}\s+/, "").trim();
  line = line.replace(/^【|】$/g, "").trim();
  line = line.replace(/^[>*\-•·]+\s*/, "").trim();

  const nameMatch = /^["']?(?:name|npc|title|名称|姓名)["']?\s*[:：]\s*["']?([^"',，}\n]+?)["']?\s*[,，]?$/.exec(line);
  if (nameMatch !== null) {
    const value = String(nameMatch[1] || "").trim();
    return value.length >= 2 && value.length <= 48 ? value : "";
  }
  if (/^(?:attributes?|attrs?|stats?|skills?|skillsfromtext|weapons?|data|属性|数值|数据|技能|装备|工作表|场景|章节|线索|物品|遭遇|结尾|奖励|note|notes)$/i.test(line)) return "";

  if (line.length < 2 || line.length > 48) return "";
  if (/^[\{\}\[\],;\s]+$/.test(line)) return "";
  if (/^[\d\s.,，、;；:：+\-—]+$/.test(line)) return "";
  if (containsValueAfterLabel(line, ALL_GROUPS)) return "";
  if (labelsInOrder(line, ALL_GROUPS).length > 0) return "";
  if (/[。！？!?；;]$/.test(line)) return "";
  if (/^(属性|数值|数据|能力|技能|装备|物品|道具|描述|说明|备注|注|来源|页码|第[一二三四五六七八九十百0-9]+[章节条项幕])/.test(line)) return "";
  if (line.includes(":") || line.includes("：")) {
    const prefix = line.split(/[:：]/)[0].replace(/^["'\s]+|["'\s]+$/g, "").trim();
    if (/^(?:attributes?|attrs?|stats?|skills?|skillsfromtext|weapons?|data|属性|数值|数据|技能|装备|工作表)$/i.test(prefix)) return "";
    if (prefix.length >= 2 && prefix.length <= 24 && /[\u4e00-\u9fa5A-Za-z]/.test(prefix)) return prefix;
    return "";
  }
  return line;
}

function harvestStatBlocks(sources) {
  const output = [];
  for (const source of sources) {
    const text = normalizeText(source && source.text);
    const lines = text.split("\n").map((line) => line.trim());
    const consumed = new Set();

    for (const record of parseTableRecords(lines)) {
      consumed.add(record.headerIndex);
      consumed.add(record.rowIndex);
      let name = record.name.length > 0 ? record.name : "";
      if (name.length === 0) {
        for (let cursor = record.headerIndex - 1; cursor >= Math.max(0, record.headerIndex - 12); cursor -= 1) {
          if (consumed.has(cursor)) continue;
          const candidate = isLikelyNpcHeading(lines[cursor]);
          if (candidate.length > 0) { name = candidate; break; }
        }
      }
      if (name.length === 0) continue;
      output.push({
        name,
        sourceFilename: source.filename || "",
        attributes: record.attributes,
        maxHp: record.vitals.hp ?? null,
        maxMp: record.vitals.mp ?? null,
        maxSan: record.vitals.san ?? null,
        maxDp: record.vitals.dp ?? null,
        armor: null,
        matchedAttributes: record.matchedAttributes,
        matchedVitals: record.matchedVitals
      });
    }

    for (let index = 0; index < lines.length; index += 1) {
      if (consumed.has(index)) continue;
      const line = lines[index] || "";
      if (line.length === 0) continue;
      const inline = containsValueAfterLabel(line, ALL_GROUPS);
      const labels = labelsInOrder(line, ALL_GROUPS);
      const positional = parsePositionalBlock(lines.slice(index, Math.min(lines.length, index + 3)).join("\n"));
      if (!inline && labels.length < 2 && positional === null) continue;

      const parsed = positional !== null
        ? positional
        : parseNpcStatsText(inline
          ? lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).join("\n")
          : lines.slice(index, Math.min(lines.length, index + 3)).join("\n"));
      if (isUsable(parsed) === false) continue;

      let name = "";
      for (let cursor = index - 1; cursor >= Math.max(0, index - 8); cursor -= 1) {
        const candidate = isLikelyNpcHeading(lines[cursor]);
        if (candidate.length > 0) { name = candidate; break; }
        const previousLabels = labelsInOrder(lines[cursor], ALL_GROUPS);
        if (previousLabels.length > 0) continue;
        if (/^[\d\s.,，、;；:：+\-—]+$/.test(lines[cursor])) continue;
      }
      if (name.length === 0) continue;
      output.push({
        name,
        sourceFilename: source.filename || "",
        attributes: parsed.attributes,
        maxHp: parsed.maxHp,
        maxMp: parsed.maxMp,
        maxSan: parsed.maxSan,
        maxDp: parsed.maxDp,
        armor: parsed.armor,
        matchedAttributes: parsed.matchedAttributes,
        matchedVitals: parsed.matchedVitals
      });
      if (positional !== null) {
        consumed.add(index);
        consumed.add(index + 1);
        consumed.add(index + 2);
      }
    }
  }
  return output;
}

function buildNpcStats(input) {
  const entries = Array.isArray(input && input.entries) ? input.entries : [];
  const sources = Array.isArray(input && input.sources) ? input.sources : [];
  const byKey = new Map();
  const signatureOwner = new Map();

  function signatureOf(parsed) {
    const parts = [];
    for (const key of NPC_STAT_ATTRIBUTE_KEYS) {
      const value = parsed.attributes[key];
      if (value !== undefined && value !== null) parts.push(key + ":" + String(value));
    }
    for (const [name, value] of [["hp", parsed.maxHp], ["mp", parsed.maxMp], ["san", parsed.maxSan], ["dp", parsed.maxDp]]) {
      if (value !== null && value !== undefined) parts.push(name + ":" + String(value));
    }
    if (parsed.armor !== null && parsed.armor !== undefined) parts.push("armor:" + String(parsed.armor));
    return parts.join("|");
  }

  function addRecord(name, parsed, sourceName, fromHarvest) {
    const key = normalizeNameKey(name);
    if (key.length < 2 || parsed === null) return;
    const signature = signatureOf(parsed);
    if (fromHarvest === true && signature.length > 0) {
      const owner = signatureOwner.get(signature);
      if (owner !== undefined && owner !== key) return;
    }
    let target = byKey.get(key);
    if (target === undefined) {
      target = {
        name,
        aliases: [],
        source: sourceName || "",
        attributes: {},
        maxHp: null,
        maxMp: null,
        maxSan: null,
        maxDp: null,
        armor: null
      };
      byKey.set(key, target);
    }
    if (sourceName && target.source.length === 0) target.source = sourceName;
    for (const attr of NPC_STAT_ATTRIBUTE_KEYS) {
      const value = parsed.attributes[attr];
      if (value !== undefined && value !== null) target.attributes[attr] = value;
    }
    if (parsed.maxHp !== null && parsed.maxHp !== undefined) target.maxHp = parsed.maxHp;
    if (parsed.maxMp !== null && parsed.maxMp !== undefined) target.maxMp = parsed.maxMp;
    if (parsed.maxSan !== null && parsed.maxSan !== undefined) target.maxSan = parsed.maxSan;
    if (parsed.maxDp !== null && parsed.maxDp !== undefined) target.maxDp = parsed.maxDp;
    if (parsed.armor !== null && parsed.armor !== undefined) target.armor = parsed.armor;
    if (signature.length > 0 && signatureOwner.has(signature) === false) signatureOwner.set(signature, key);
  }

  const aiEntries = entries.map((entry) => ({ ...recordOf(entry), attributes: { ...recordOf(entry.attributes) } }));
  enrichNpcStatsFromSources(aiEntries, sources);
  for (const entry of aiEntries) {
    const names = candidateNamesOf(entry);
    if (names.length === 0) continue;
    const parsed = parsedFromEntry(entry);
    if (isUsable(parsed) === false) continue;
    addRecord(names[0], parsed, entry.id || "", false);
    const target = byKey.get(normalizeNameKey(names[0]));
    if (target !== undefined) {
      for (const alias of names.slice(1)) {
        if (target.aliases.includes(alias) === false) target.aliases.push(alias);
      }
    }
  }

  // 先把同名碎片记录合并成完整数值，再做签名去重，避免逐个碎片绕过去重。
  const harvestedByKey = new Map();
  for (const block of harvestStatBlocks(sources)) {
    const key = normalizeNameKey(block.name);
    if (key.length === 0) continue;
    const existing = harvestedByKey.get(key);
    if (existing === undefined) {
      harvestedByKey.set(key, {
        ...block,
        attributes: { ...block.attributes }
      });
      continue;
    }
    Object.assign(existing.attributes, block.attributes);
    if (block.maxHp !== null && block.maxHp !== undefined) existing.maxHp = block.maxHp;
    if (block.maxMp !== null && block.maxMp !== undefined) existing.maxMp = block.maxMp;
    if (block.maxSan !== null && block.maxSan !== undefined) existing.maxSan = block.maxSan;
    if (block.maxDp !== null && block.maxDp !== undefined) existing.maxDp = block.maxDp;
    if (block.armor !== null && block.armor !== undefined) existing.armor = block.armor;
    existing.matchedAttributes = Object.keys(existing.attributes).length;
  }
  for (const block of harvestedByKey.values()) {
    addRecord(block.name, block, block.sourceFilename || "", true);
    const target = byKey.get(normalizeNameKey(block.name));
    if (target !== undefined && target.aliases.length === 0) target.aliases = nameVariants(block.name).slice(1);
  }

  return [...byKey.values()].map((item) => ({
    name: item.name,
    aliases: item.aliases,
    source: item.source,
    attributes: item.attributes,
    maxHp: item.maxHp,
    maxMp: item.maxMp,
    maxSan: item.maxSan,
    maxDp: item.maxDp,
    armor: item.armor ?? null
  }));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    NPC_STAT_ATTRIBUTE_KEYS,
    ATTRIBUTE_GROUPS,
    VITAL_GROUPS,
    normalizeText,
    normalizeNameKey,
    parseArmorExpression,
    parseNpcStatsText,
    scoreOf,
    isUsable,
    candidateNamesOf,
    bestStatsNearName,
    truncateAtNextHeading,
    parsePositionalBlock,
    parseTableRecords,
    enrichNpcStatsFromSources,
    harvestStatBlocks,
    buildNpcStats
  };
}
