import { z } from "zod";
import { GameConditionSchema, PRESET_TIERS, RARITIES } from "@touhou/rules";

export const NPC_ATTRIBUTE_KEYS = [
  "str",
  "con",
  "siz",
  "dex",
  "app",
  "int",
  "pow",
  "edu",
  "luck"
] as const;

export const NpcWeaponSchema = z.object({
  name: z.string().min(1).max(120),
  damage: z.string().max(80).default(""),
  range: z.string().max(40).default(""),
  skillId: z.string().max(80).default(""),
  attacks: z.union([z.string(), z.number()]).optional(),
  notes: z.string().max(300).default("")
});

export const NpcStatsSchema = z.object({
  presetId: z.string().nullable().default(null),
  tier: z.enum(PRESET_TIERS).default("STANDARD"),
  race: z.string().nullable().default(null),
  attributes: z.object({
    str: z.number().int().min(0).max(999),
    con: z.number().int().min(0).max(999),
    siz: z.number().int().min(0).max(999),
    dex: z.number().int().min(0).max(999),
    app: z.number().int().min(0).max(999),
    int: z.number().int().min(0).max(999),
    pow: z.number().int().min(0).max(999),
    edu: z.number().int().min(0).max(999),
    luck: z.number().int().min(0).max(999)
  }),
  skills: z.record(z.string(), z.number().int().min(0).max(999)).default({}),
  /** 原文中的武器 / 攻击方式；战斗攻击选项会直接读取这里。 */
  weapons: z.array(NpcWeaponSchema).max(30).default([]),
  /** 战前护甲表达式，如 "2d6" / "12"；0 表示无护甲。 */
  armor: z.string().max(40).default("0"),
  /** 该 NPC 可以施放的法术 id；团本物化时自动写入该团本的法术。 */
  spells: z.array(z.string().max(120)).max(200).default([]),
  maxHp: z.number().int().min(1).max(9999),
  maxMp: z.number().int().min(0).max(99999),
  maxSan: z.number().int().min(0).max(999),
  maxDp: z.number().int().min(0).max(99999),
  tags: z.array(z.string().max(30)).max(20).default([]),
  rarity: z.enum(RARITIES).default("COMMON"),
  /** 局内持久状态：召唤物、夺舍、中毒等。战斗结束后回写到这里。 */
  conditions: z.array(GameConditionSchema).max(50).default([]),
  /** 召唤来源标记；非召唤物为空。 */
  summoned: z.boolean().optional(),
  summonOrigin: z.record(z.string(), z.unknown()).optional(),
  /** 稳定召唤 key，用于跨译名匹配。 */
  summonKey: z.string().max(120).optional(),
  /** 别名列表：召唤 / 查找时可参与匹配。 */
  aliases: z.array(z.string().max(120)).max(20).optional()
});

export type NpcStats = z.output<typeof NpcStatsSchema>;
