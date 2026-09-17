import type { SummonTemplate } from "@touhou/combat";
import {
  coc7DamageBonus,
  type AttributeSet,
  type CompiledRulePack,
  type DerivedStats
} from "@touhou/rules";
import { NpcStatsSchema } from "@/shared/npc";
import { armorExpressionFromValue } from "@/server/combat/armor";

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "");
}

function characterSet(value: string): Set<string> {
  return new Set([...value]);
}

function characterSimilarity(left: string, right: string): number {
  if (left.length < 2 || right.length < 2) return 0;
  const a = characterSet(left);
  const b = characterSet(right);
  let intersection = 0;
  for (const char of a) if (b.has(char)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export interface SummonCardLike {
  readonly name: string;
  readonly stats: unknown;
}

/** 从房间内独立 NPC 卡构建召唤模板；卡不合法或找不到时由引擎走通用兜底。 */
export function summonTemplateFromCard(
  card: SummonCardLike,
  pack: CompiledRulePack
): SummonTemplate | null {
  const parsed = NpcStatsSchema.safeParse(card.stats);
  if (parsed.success === false) return null;
  const attributes = parsed.data.attributes as AttributeSet;
  const derived: DerivedStats = {
    hp: parsed.data.maxHp,
    maxHp: parsed.data.maxHp,
    mp: parsed.data.maxMp,
    maxMp: parsed.data.maxMp,
    san: parsed.data.maxSan,
    maxSan: parsed.data.maxSan,
    dp: parsed.data.maxDp,
    maxDp: parsed.data.maxDp
  };
  return {
    name: card.name,
    attributes,
    derived,
    skills: { ...parsed.data.skills },
    spells: [...parsed.data.spells],
    damageBonus: pack.system === "COC7" ? coc7DamageBonus(attributes.str + attributes.siz) : "0",
    weapons: [...parsed.data.weapons],
    armorExpression: parsed.data.armor !== "0" ? parsed.data.armor : (armorExpressionFromValue(card.stats) ?? undefined)
  };
}

/** 按召唤名匹配房间 NPC 卡：精确名优先，其次双向包含，最后别名包含。 */
export function findSummonCard<T extends SummonCardLike>(
  cards: readonly T[],
  summonName: string
): T | null {
  const wanted = normalizeName(summonName);
  if (wanted.length === 0) return null;
  for (const card of cards) {
    if (normalizeName(card.name) === wanted) return card;
  }
  for (const card of cards) {
    const cardName = normalizeName(card.name);
    if (cardName.length > 0 && (cardName.includes(wanted) || wanted.includes(cardName))) return card;
  }
  for (const card of cards) {
    const stats = card.stats as { aliases?: unknown } | null;
    const aliases = stats !== null && typeof stats === "object" && Array.isArray(stats.aliases) ? stats.aliases : [];
    for (const alias of aliases) {
      if (typeof alias !== "string") continue;
      const aliasName = normalizeName(alias);
      if (aliasName.length > 0 && (aliasName === wanted || aliasName.includes(wanted) || wanted.includes(aliasName))) return card;
    }
  }
  // 通用模糊兜底：不同译名（如「次元蹑蹒者 / 异次元蹒跚者」）允许按汉字集合相似度匹配。
  let best: T | null = null;
  let bestScore = 0;
  let bestCount = 0;
  for (const card of cards) {
    const score = characterSimilarity(wanted, normalizeName(card.name));
    if (score > bestScore) {
      best = card;
      bestScore = score;
      bestCount = 1;
    } else if (score === bestScore && score > 0) {
      bestCount += 1;
    }
  }
  return best !== null && bestScore >= 0.5 && bestCount === 1 ? best : null;
}
