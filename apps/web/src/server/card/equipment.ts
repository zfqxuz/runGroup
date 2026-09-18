import {
  ItemStatsSchema,
  SpellCardStatsSchema,
  WeaponStatsSchema,
  allowedEffectTypesForKind,
  weaponTypeDefinition,
  type CardKind
} from "@/shared/card";

/**
 * 道具卡 ↔ 武器卡互转：通用字段（效果 / 目标 / 消耗 / 场景）按目标类型过滤后保留，
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
  const allowed = new Set<string>(allowedEffectTypesForKind(toKind));
  const rawEffects = Array.isArray(source.effects) ? source.effects : [];
  // 转换后只保留目标卡类型允许的效果（例如道具上的治疗不会跟着变进武器）。
  const effects = rawEffects.filter((effect) => {
    if (effect === null || typeof effect !== "object" || Array.isArray(effect)) return false;
    const type = (effect as Record<string, unknown>).type;
    return typeof type === "string" && allowed.has(type);
  });
  const generic: Record<string, unknown> = { effects };
  for (const key of ["targeting", "targetScope", "cost", "usableIn"]) {
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
