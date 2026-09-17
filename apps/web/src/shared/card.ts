import { z } from "zod";
import { MagicEffectSchema, type MagicEffect } from "@touhou/rules";
import { DanmakuPatternSchema } from "./danmaku/schema";

/** 通用卡牌效果 / 目标 / 消耗：魔法、道具、符卡、武器共用同一套结构。 */
export const CARD_TARGETINGS = ["SELF", "ALLY", "ENEMY", "ANY"] as const;
export const CARD_TARGETING_LABELS: Record<(typeof CARD_TARGETINGS)[number], string> = {
  SELF: "自身",
  ALLY: "友方",
  ENEMY: "敌方",
  ANY: "任意"
};
export const CARD_USABLE_IN = ["FIELD", "COMBAT"] as const;

/** 效果作用范围：自身 / 单体 / 全体。 */
export const CARD_TARGET_SCOPES = ["SELF", "ONE", "ALL"] as const;
export const CARD_TARGET_SCOPE_LABELS: Record<(typeof CARD_TARGET_SCOPES)[number], string> = {
  SELF: "自身",
  ONE: "单体",
  ALL: "全体"
};

export const CardCostSchema = z.object({
  /** 灵力 / MP 消耗。 */
  mp: z.number().int().min(0).max(999).default(0),
  /** SAN 消耗表达式，例如 "1d4"；空表示无。 */
  san: z.string().max(20).nullable().default(null),
  /** 使用次数；null 表示不限次。 */
  uses: z.number().int().min(1).max(99).nullable().default(null),
  /** 冷却行动轮次。 */
  cooldownRounds: z.number().int().min(0).max(99).default(0)
});

export const CardBaseStatsSchema = z.object({
  effects: z.array(MagicEffectSchema).default([]),
  targeting: z.enum(CARD_TARGETINGS).default("ENEMY"),
  /** 作用范围：自身 / 单体 / 全体；targeting 决定敌我阵营。 */
  targetScope: z.enum(CARD_TARGET_SCOPES).default("ONE"),
  cost: CardCostSchema.default({}),
  /** 可在哪些场景使用：战斗内 / 战斗外。 */
  usableIn: z.array(z.enum(CARD_USABLE_IN)).default(["COMBAT"]),
  /** 装备时可由玩家选择是否生效的效果下标；未列出的效果固定生效。 */
  selectableEffects: z.array(z.number().int().min(0)).default([]),
  /** 装备时实际选中的效果下标；null 表示全部效果生效。 */
  equippedEffects: z.array(z.number().int().min(0)).nullable().default(null)
});

/**
 * 计算一张卡当前实际生效的效果。
 * - equippedEffects 为空 / null：全部效果生效；
 * - 否则：取下标命中的效果。装备时会把固定生效的效果下标一并写入。
 */
export function activeCardEffects(stats: {
  readonly effects: readonly MagicEffect[];
  readonly equippedEffects?: readonly number[] | null;
}): readonly MagicEffect[] {
  const effects = stats.effects;
  const selected = stats.equippedEffects;
  if (selected === null || selected === undefined || selected.length === 0) return [...effects];
  return effects.filter((_effect, index) => selected.includes(index));
}

/** 这张卡是否有「装备时可选」的效果；没有时装备不需要弹选择。 */
export function hasSelectableEffects(stats: { readonly selectableEffects?: readonly number[] | null }): boolean {
  return (stats.selectableEffects ?? []).length > 0;
}

/** 武器类型 → 使用技能 / 射程 / 基础伤害。伤害由系统自动带出。 */
export interface WeaponTypeDefinition {
  readonly id: string;
  readonly label: string;
  readonly skillId: string;
  readonly range: "MELEE" | "NEAR" | "FAR";
  readonly damage: string;
}

export const WEAPON_TYPES: readonly WeaponTypeDefinition[] = [
  { id: "BRAWL", label: "斗殴 / 徒手", skillId: "FIGHTING_BRAWL", range: "MELEE", damage: "1d3+db" },
  { id: "AXE", label: "斧 / 钝器", skillId: "FIGHTING_AXE", range: "MELEE", damage: "1d8+2+db" },
  { id: "BLADE", label: "剑 / 刀", skillId: "FIGHTING_BRAWL", range: "MELEE", damage: "1d6+db" },
  { id: "SPEAR", label: "矛 / 长柄", skillId: "FIGHTING_BRAWL", range: "MELEE", damage: "1d8+db" },
  { id: "WHIP", label: "鞭 / 链", skillId: "FIGHTING_BRAWL", range: "MELEE", damage: "1d3+db" },
  { id: "HANDGUN", label: "手枪", skillId: "FIREARMS_HANDGUN", range: "NEAR", damage: "1d10" },
  { id: "RIFLE", label: "步枪 / 霰弹枪", skillId: "FIREARMS_RIFLE", range: "FAR", damage: "2d6" },
  { id: "BOW", label: "弓 / 弩", skillId: "FIREARMS_BOW", range: "FAR", damage: "1d8+db" },
  { id: "THROW", label: "投掷", skillId: "THROW", range: "NEAR", damage: "1d4+db" }
];

export function weaponTypeDefinition(id: string): WeaponTypeDefinition {
  return WEAPON_TYPES.find((item) => item.id === id) ?? WEAPON_TYPES[0]!;
}

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

const SpellCardStatsCoreSchema = z.object({
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
  enhanceValue: z.number().min(0).max(10),
  /** 结构化弹幕演出；纯视觉，不参与战斗判定。旧卡可以没有。 */
  pattern: DanmakuPatternSchema.nullable().optional()
});
export const SpellCardStatsSchema = SpellCardStatsCoreSchema.merge(CardBaseStatsSchema);

const WeaponStatsCoreSchema = z.object({
  damage: z
    .string()
    .min(1)
    .max(30)
    // 允许 db（伤害加值）与多个修正项，例如 "1d3+db" / "1d8+2+db" / "2d6"。
    .regex(/^\s*[+-]?\s*\d*d\d+(\s*[+-]\s*(\d+|db))*\s*$/i, "格式如 2d6+3 / 1d3+db"),
  range: z.enum(["MELEE", "NEAR", "FAR"]),
  skillId: z.string().max(60).nullable().default(null),
  accuracyMod: z.number().int().min(-50).max(50),
  mpCost: z.number().int().min(0).max(999),
  /** 武器类型；damage / range / skillId 由它自动带出。 */
  weaponType: z.string().max(40).default("BRAWL")
});
export const WeaponStatsSchema = WeaponStatsCoreSchema.merge(CardBaseStatsSchema);

const ItemStatsCoreSchema = z.object({
  /** 自由文本效果说明；真正的结算走通用 effects。 */
  effect: z.string().max(200).default(""),
  uses: z.number().int().min(1).max(99).nullable().default(null),
  sanCost: z.string().max(20).nullable().default(null)
});
export const ItemStatsSchema = ItemStatsCoreSchema.merge(CardBaseStatsSchema);

export type SpellCardStats = z.output<typeof SpellCardStatsSchema>;
export type WeaponStats = z.output<typeof WeaponStatsSchema>;
export type ItemStats = z.output<typeof ItemStatsSchema>;
export type CardStats = SpellCardStats | WeaponStats | ItemStats;

export function parseCardStats(kind: CardKind, stats: unknown): CardStats | null {
  const result =
    kind === "SPELLCARD"
      ? SpellCardStatsSchema.safeParse(stats)
      : kind === "WEAPON"
        ? WeaponStatsSchema.safeParse(stats)
        : ItemStatsSchema.safeParse(stats);
  return result.success ? result.data : null;
}

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
