import { ItemStatsSchema, SpellCardStatsSchema, WeaponStatsSchema, weaponTypeDefinition, type CardKind } from "@/shared/card";

/**
 * 装备时计算「实际生效的效果下标」。
 *
 * - 未标记 selectableEffects 的效果固定生效；
 * - selectableEffects 里的效果由玩家勾选（requested）；
 * - 没有任何可选效果时返回 null（表示全部效果生效）。
 */
export function computeEquippedEffects(
  effectsCount: number,
  selectableEffects: readonly number[],
  requested: readonly number[]
): number[] | null {
  if (effectsCount <= 0) return null;
  const validSelectable = [...new Set(selectableEffects)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < effectsCount)
    .sort((a, b) => a - b);
  if (validSelectable.length === 0) return null;
  const mandatory = Array.from({ length: effectsCount }, (_value, index) => index).filter(
    (index) => validSelectable.includes(index) === false
  );
  const chosen = requested.filter((index) => validSelectable.includes(index));
  return [...new Set([...mandatory, ...chosen])].sort((a, b) => a - b);
}

/**
 * 道具卡 ↔ 武器卡互转：通用字段（效果 / 目标 / 消耗 / 场景）原样保留，
 * 专属字段按目标类型重建；返回 null 表示结果不合法。
 */
export function convertCardStats(fromKind: CardKind, toKind: CardKind, stats: unknown): unknown | null {
  if ((fromKind === "ITEM" && toKind === "WEAPON") === false && (fromKind === "WEAPON" && toKind === "ITEM") === false) {
    return null;
  }
  const source =
    stats !== null && typeof stats === "object" && Array.isArray(stats) === false
      ? (stats as Record<string, unknown>)
      : {};
  const generic: Record<string, unknown> = {};
  for (const key of ["effects", "targeting", "targetScope", "cost", "usableIn", "selectableEffects", "equippedEffects"]) {
    if (source[key] !== undefined) generic[key] = source[key];
  }
  const cost =
    source.cost !== null && typeof source.cost === "object" && Array.isArray(source.cost) === false
      ? (source.cost as Record<string, unknown>)
      : {};
  const next =
    toKind === "WEAPON"
      ? {
          ...generic,
          weaponType: "BRAWL",
          damage: weaponTypeDefinition("BRAWL").damage,
          range: weaponTypeDefinition("BRAWL").range,
          skillId: weaponTypeDefinition("BRAWL").skillId,
          accuracyMod: 0,
          mpCost: typeof cost.mp === "number" ? cost.mp : 0
        }
      : {
          ...generic,
          effect: "",
          uses: typeof cost.uses === "number" ? cost.uses : null,
          sanCost: typeof cost.san === "string" ? cost.san : null
        };
  const result =
    toKind === "SPELLCARD"
      ? SpellCardStatsSchema.safeParse(next)
      : toKind === "WEAPON"
        ? WeaponStatsSchema.safeParse(next)
        : ItemStatsSchema.safeParse(next);
  return result.success ? result.data : null;
}
