import type { SummonTemplate } from "@touhou/combat";
import {
  coc7DamageBonus,
  type AttributeSet,
  type CompiledRulePack,
  type DerivedStats
} from "@touhou/rules";
import { NpcStatsSchema } from "@/shared/npc";

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "");
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
    weapons: [...parsed.data.weapons]
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
  return null;
}
