/** 通用护甲表达式解析。规则引擎和 NPC 数据管线共用。 */
export function armorExpressionFromText(text: string): string | null {
  const direct = /(?:护甲|护甲值|armor)\s*[:：=]\s*(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)/i.exec(text);
  if (direct?.[1] !== undefined) return direct[1].replace(/\s+/g, "").toUpperCase();
  const granted = /(?:获得|拥有|有|提供|给予|增加|提升)\s*(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s*(?:点)?\s*(?:的)?\s*(?:防非魔法伤害的)?护甲/i.exec(text);
  if (granted?.[1] !== undefined) return granted[1].replace(/\s+/g, "").toUpperCase();
  const after = /(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s*点?\s*(?:防非魔法伤害的)?护甲/i.exec(text);
  if (after?.[1] !== undefined) return after[1].replace(/\s+/g, "").toUpperCase();
  return null;
}

/** 从任意 NPC 卡 JSON 中递归寻找护甲表达式，例如 "2d6" 或 "12"。 */
export function armorExpressionFromValue(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === "number") return null;
  if (typeof value === "string") return armorExpressionFromText(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = armorExpressionFromValue(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/armor|护甲/i.test(key)) {
        if (typeof item === "number" && Number.isFinite(item) && item >= 0) return String(Math.floor(item));
        if (typeof item === "string") {
          const trimmed = item.trim();
          if (/^\d+[dD]\d+(?:\s*[+-]\s*\d+)?$/.test(trimmed) || /^\d+$/.test(trimmed)) {
            return trimmed.replace(/\s+/g, "").toUpperCase();
          }
          const found = armorExpressionFromText(item);
          if (found !== null) return found;
        }
      }
    }
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = armorExpressionFromValue(item, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}
