import { z } from "zod";

export const CARD_KINDS = ["SPELLCARD", "WEAPON", "ITEM"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_KIND_LABELS: Record<CardKind, string> = {
  SPELLCARD: "符卡",
  WEAPON: "武器卡",
  ITEM: "道具卡"
};

/** 符卡强化方向，对应 RulePack 的 spellcard.enhance。 */
export const ENHANCE_TYPES = ["DANMAKU", "MELEE", "SPELL", "AREA"] as const;
export type EnhanceType = (typeof ENHANCE_TYPES)[number];

export const ENHANCE_LABELS: Record<EnhanceType, string> = {
  DANMAKU: "弹幕 · 伤害提升",
  MELEE: "近战 · 命中与伤害提升",
  SPELL: "法术 · 能力值提升，不消耗灵力",
  AREA: "范围 · 可攻击多个目标"
};

export const SpellCardStatsSchema = z.object({
  mode: z.enum(["DECLARATION", "CONSUMPTION"]),
  /** 一句话描述这张符卡长什么样。 */
  danmaku: z.string().min(1, "请填写弹幕描述").max(60),
  mpCost: z.number().int().min(0).max(999),
  /** 展开型：独立 HP = 角色最大 HP × hpRatio。 */
  hpRatio: z.number().min(0.5).max(10).nullable(),
  durationTicks: z.number().int().min(1).max(100000).nullable(),
  clearTargets: z.enum(["ALL", "OTHERS_ONLY"]).nullable(),
  enhanceType: z.enum(ENHANCE_TYPES),
  /** 强化倍率或加值，含义随 enhanceType 而定。 */
  enhanceValue: z.number().min(0).max(10)
});

export const WeaponStatsSchema = z.object({
  damage: z
    .string()
    .min(1)
    .max(30)
    .regex(/^\s*[+-]?\s*\d*d\d+(\s*[+-]\s*\d+)?\s*$/i, "格式如 2d6+3"),
  range: z.enum(["MELEE", "NEAR", "FAR"]),
  skillId: z.string().max(60).nullable().default(null),
  accuracyMod: z.number().int().min(-50).max(50),
  mpCost: z.number().int().min(0).max(999)
});

export const ItemStatsSchema = z.object({
  effect: z.string().max(200),
  uses: z.number().int().min(1).max(99).nullable(),
  sanCost: z.string().max(20).nullable()
});

export type SpellCardStats = z.output<typeof SpellCardStatsSchema>;
export type WeaponStats = z.output<typeof WeaponStatsSchema>;
export type ItemStats = z.output<typeof ItemStatsSchema>;

export const RANGE_LABELS: Record<WeaponStats["range"], string> = {
  MELEE: "近身",
  NEAR: "中距",
  FAR: "远距"
};

export const CARD_RARITIES = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"] as const;
export type CardRarity = (typeof CARD_RARITIES)[number];

export const RARITY_LABELS: Record<CardRarity, string> = {
  COMMON: "普通",
  UNCOMMON: "罕见",
  RARE: "稀有",
  EPIC: "史诗",
  LEGENDARY: "传说"
};

export const RARITY_BORDER_CLASSES: Record<CardRarity, string> = {
  COMMON: "border-white/15",
  UNCOMMON: "border-emerald-400/50",
  RARE: "border-sky-400/60",
  EPIC: "border-violet-400/70",
  LEGENDARY: "border-amber-400/80"
};

export function cardRarityBorderClass(rarity: string): string {
  if (Object.prototype.hasOwnProperty.call(RARITY_BORDER_CLASSES, rarity)) {
    return RARITY_BORDER_CLASSES[rarity as CardRarity];
  }
  return RARITY_BORDER_CLASSES.COMMON;
}
