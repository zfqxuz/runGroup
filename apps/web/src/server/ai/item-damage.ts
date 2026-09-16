/**
 * 从原文确定性回填物品 / 武器伤害。
 *
 * AI 在分块提取时经常把同一段攻击描述里的伤害串到物品上，或者干脆漏掉。
 * 这里不依赖任何具体模组：
 * - 用物品名称 / 别名找到原文中包含它的段落；
 * - 在段落里收集骰式伤害（如 1D4 + 2、2D6-1）；
 * - 出现次数最多 / 最靠前的表达式胜出；
 * - 只有出现 >= 2 次才覆盖，避免单次提及造成误判。
 */

export interface ItemDamageSource {
  readonly filename?: string;
  readonly text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false;
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "");
}

function stringListOf(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 ? [text] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function itemNamesOf(entry: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const field of ["name", "title", "id", "aliases", "alias", "aka", "alsoKnownAs"]) {
    for (const name of stringListOf(entry[field])) names.add(name);
  }
  return [...names].filter((name) => name.length >= 2);
}

function damageExpressionsIn(text: string): string[] {
  const output: string[] = [];
  const pattern = /(\d{1,2})\s*[dD]\s*(\d{1,3})(?:\s*([+-])\s*(\d{1,3}))?/g;
  for (const match of text.matchAll(pattern)) {
    const dice = match[1];
    const sides = match[2];
    if (dice === undefined || sides === undefined) continue;
    const sign = match[3];
    const modifier = match[4];
    output.push(dice + "d" + sides + (sign !== undefined && modifier !== undefined ? sign + modifier : ""));
  }
  return output;
}

export function enrichItemDamageFromSources(
  entries: readonly Record<string, unknown>[],
  sources: readonly ItemDamageSource[]
): number {
  const sourceTexts = sources.map((source) => source.text).filter((text) => text.trim().length > 0);
  let fixed = 0;
  for (const entry of entries) {
    if (isRecord(entry) === false) continue;
    const rawType = String(entry.itemType ?? entry.kind ?? entry.type ?? "").toUpperCase();
    const hasDamage = typeof entry.damage === "string" && entry.damage.trim().length > 0;
    if (hasDamage === false && rawType !== "WEAPON" && rawType !== "ARTIFACT") continue;
    const names = itemNamesOf(entry).map(normalizeKey).filter((name) => name.length >= 2);
    if (names.length === 0) continue;

    const votes = new Map<string, { count: number; firstIndex: number }>();
    const rawNames = itemNamesOf(entry);
    for (const text of sourceTexts) {
      let globalIndex = 0;
      for (const rawName of rawNames) {
        let from = 0;
        while (true) {
          const index = text.indexOf(rawName, from);
          if (index < 0) break;
          const windowText = text.slice(Math.max(0, index - 300), Math.min(text.length, index + 1600));
          for (const expression of damageExpressionsIn(windowText)) {
            const current = votes.get(expression);
            if (current === undefined) votes.set(expression, { count: 1, firstIndex: globalIndex });
            else current.count += 1;
          }
          globalIndex += 1;
          from = index + rawName.length;
        }
      }
    }
    if (votes.size === 0) continue;
    const best = [...votes.entries()].sort(
      (left, right) => right[1].count - left[1].count || left[1].firstIndex - right[1].firstIndex
    )[0];
    if (best === undefined || best[1].count < 2) continue;
    if (entry.damage !== best[0]) {
      entry.damage = best[0];
      fixed += 1;
    }
  }
  return fixed;
}
