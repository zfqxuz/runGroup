import { z } from "zod";
import { PRESET_TIERS, RARITIES } from "@touhou/rules";

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
  maxHp: z.number().int().min(1).max(9999),
  maxMp: z.number().int().min(0).max(99999),
  maxSan: z.number().int().min(0).max(999),
  maxDp: z.number().int().min(0).max(99999),
  tags: z.array(z.string().max(30)).max(20).default([]),
  rarity: z.enum(RARITIES).default("COMMON")
});

export type NpcStats = z.output<typeof NpcStatsSchema>;
