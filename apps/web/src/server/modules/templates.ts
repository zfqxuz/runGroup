import { compile, parseDice } from "@touhou/formula";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeDerived,
  RARITIES,
  resolveRulePack
} from "@touhou/rules";
import type { AttributeSet } from "@touhou/rules";
import { dedupeNpcRecords } from "@/server/ai/npc-dedupe";
import { enrichNpcStatsFromSources } from "@/server/ai/npc-stats";
import { prisma } from "@/server/db/prisma";
import {
  parseStructuredBlocks,
  structuredOfContent,
  type StructuredModuleData,
  type StructuredModuleEntry
} from "@/server/modules/structure";

export interface TemplateSyncCounts {
  readonly chapters: number;
  readonly npcs: number;
  readonly items: number;
  readonly clues: number;
  readonly scenes: number;
  readonly encounters: number;
  readonly magic: number;
  readonly warnings: readonly string[];
}

interface SkillPackLike {
  readonly skills: readonly { readonly id: string; readonly name: string }[];
}

export function moduleEntitySourceKey(input: string): string {
  return safeKey(input, "entity");
}

function safeKey(input: string, fallback: string): string {
  const key = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return key.length > 0 ? key : fallback;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function textOf(data: Record<string, unknown>, keys: readonly string[], fallback = ""): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(number) === false) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function boolOf(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function stringArray(value: unknown, max = 20): string[] {
  if (Array.isArray(value) === false) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 40))
    .slice(0, max);
}

function safeExpression(value: unknown, fallback: string): string {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (text.length === 0) return fallback;
  try {
    compile(text);
    return text;
  } catch {
    return fallback;
  }
}

function safeDice(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0) return null;
  try {
    parseDice(text);
    return text;
  } catch {
    return null;
  }
}

function normalizeSkillKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "");
}

function skillIdsOf(compiled: SkillPackLike): Map<string, string> {
  const byName = new Map<string, string>();
  const add = (key: string, skillId: string): void => {
    const normalized = normalizeSkillKey(key);
    if (normalized.length > 0) byName.set(normalized, skillId);
  };
  for (const skill of compiled.skills) {
    add(skill.id, skill.id);
    add(skill.name, skill.id);
    const alias = /^(.+?)[（(](.+?)[)）]$/.exec(skill.name);
    if (alias !== null) {
      add(alias[1] ?? "", skill.id);
      add(alias[2] ?? "", skill.id);
    }
  }
  const known = new Set(compiled.skills.map((skill) => skill.id));
  const commonAliases: Readonly<Record<string, string>> = {
    "斗殴": "FIGHTING_BRAWL",
    "格斗": "FIGHTING_BRAWL",
    "闪避": "DODGE",
    "潜行": "STEALTH",
    "侦查": "SPOT_HIDDEN",
    "聆听": "LISTEN",
    "图书馆使用": "LIBRARY_USE",
    "妙手": "SLEIGHT_OF_HAND",
    "克苏鲁神话": "CTHULHU_MYTHOS",
    "克苏鲁神话知识": "CTHULHU_MYTHOS",
    "魅惑": "CHARM",
    "话术": "FAST_TALK",
    "恐吓": "INTIMIDATE",
    "说服": "PERSUADE"
  };
  for (const [alias, skillId] of Object.entries(commonAliases)) {
    if (known.has(skillId)) add(alias, skillId);
  }
  return byName;
}

function skillPairsOf(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) {
    const pairs: [string, unknown][] = [];
    for (const item of value) {
      const record = recordOf(item);
      const name = textOf(record, ["skill_name", "skillName", "name", "skill", "title"], "");
      const raw = record.value ?? record.level ?? record.skill_value ?? record.score;
      if (name.length > 0) pairs.push([name, raw]);
    }
    return pairs;
  }
  return Object.entries(recordOf(value));
}

export function normalizedSkills(
  value: unknown,
  compiled: SkillPackLike,
  warnings: string[],
  label: string
): Record<string, number> {
  const byName = skillIdsOf(compiled);
  const out: Record<string, number> = {};
  for (const [rawKey, rawValue] of skillPairsOf(value)) {
    const skillId = byName.get(normalizeSkillKey(rawKey));
    if (skillId === undefined) {
      warnings.push(label + " 的技能「" + rawKey + "」不在当前规则包中，已忽略");
      continue;
    }
    const number = numberIn(rawValue, 0, 0, 999);
    if (number > 0) out[skillId] = number;
  }
  return out;
}

export interface NormalizedNpcWeapon {
  readonly name: string;
  readonly damage: string;
  readonly range: string;
  readonly skillId: string;
  readonly attacks: string | number | null;
  readonly notes: string;
}

function normalizedRange(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (text.length === 0) return "";
  if (/^(melee|近战|格斗|白刃|刀|棍|斧|矛|拳)/i.test(text)) return "MELEE";
  if (/^(near|近距离|手枪|霰弹|短枪|短)/i.test(text)) return "NEAR";
  if (/^(far|远距离|步枪|狙击|远程|远)/i.test(text)) return "FAR";
  return text.slice(0, 20);
}

export function normalizedWeapons(value: unknown, compiled: SkillPackLike, warnings: string[], label: string): NormalizedNpcWeapon[] {
  const byName = skillIdsOf(compiled);
  const output: NormalizedNpcWeapon[] = [];
  const push = (rawName: unknown, rawDamage: unknown, rawRange?: unknown, rawSkill?: unknown, rawAttacks?: unknown, rawNotes?: unknown): void => {
    const name = typeof rawName === "string" ? rawName.trim().slice(0, 120) : "";
    if (name.length === 0) return;
    const damage = typeof rawDamage === "string" ? rawDamage.trim().slice(0, 80) : typeof rawDamage === "number" ? String(rawDamage) : "";
    const skillText = typeof rawSkill === "string" ? rawSkill.trim() : "";
    const skillId = skillText.length === 0 ? "" : (byName.get(normalizeSkillKey(skillText)) ?? "");
    const attacks = typeof rawAttacks === "string" || typeof rawAttacks === "number" ? rawAttacks : null;
    output.push({
      name,
      damage,
      range: normalizedRange(rawRange),
      skillId,
      attacks,
      notes: typeof rawNotes === "string" ? rawNotes.trim().slice(0, 300) : ""
    });
    if (skillText.length > 0 && skillId.length === 0) {
      warnings.push(label + " 的武器「" + name + "」技能「" + skillText + "」不在规则包中，战斗时将按武器距离推断");
    }
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      const record = recordOf(item);
      if (Object.keys(record).length > 0) {
        push(
          textOf(record, ["weapon_name", "weaponName", "name", "title"], ""),
          textOf(record, ["damage", "dmg", "伤害"], ""),
          record.range ?? record.type ?? record.attackType,
          record.skillId ?? record.skill_id ?? record.skillName ?? record.skill,
          record.attacks ?? record.attackCount ?? record.count,
          record.notes ?? record.note ?? record.description
        );
      } else if (typeof item === "string") {
        push(item, "", "", "", null, "");
      }
    }
    return output.slice(0, 30);
  }

  if (value !== null && typeof value === "object" && Array.isArray(value) === false) {
    const record = value as Record<string, unknown>;
    for (const [rawName, rawValue] of Object.entries(record)) {
      if (typeof rawValue === "string" || typeof rawValue === "number") {
        push(rawName, rawValue, "", "", null, "");
      } else {
        const detail = recordOf(rawValue);
        push(
          textOf(detail, ["weapon_name", "weaponName", "name", "title"], rawName),
          textOf(detail, ["damage", "dmg", "伤害"], ""),
          detail.range ?? detail.type,
          detail.skillId ?? detail.skill ?? detail.skillName,
          detail.attacks ?? detail.attackCount,
          detail.notes ?? detail.description
        );
      }
    }
    return output.slice(0, 30);
  }

  return output;
}

const ATTRIBUTE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  str: ["str", "strength", "力量"],
  con: ["con", "constitution", "体质"],
  siz: ["siz", "size", "体型"],
  dex: ["dex", "dexterity", "敏捷"],
  app: ["app", "appearance", "外貌", "魅力"],
  int: ["int", "intelligence", "智力"],
  pow: ["pow", "power", "意志", "意志力"],
  edu: ["edu", "education", "教育"],
  luck: ["luck", "幸运"]
};

function attributeValueOf(source: Record<string, unknown>, key: string): unknown {
  for (const alias of ATTRIBUTE_ALIASES[key] ?? [key]) {
    if (source[alias] !== undefined && source[alias] !== null && source[alias] !== "") return source[alias];
  }
  const lowerKey = key.toLowerCase();
  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (rawKey.trim().toLowerCase() === lowerKey && rawValue !== undefined && rawValue !== null && rawValue !== "") return rawValue;
  }
  return undefined;
}

function normalizedAttributes(value: unknown, warnings: string[], label: string): Record<string, number> {
  const source = recordOf(value);
  const keys = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;
  const out: Record<string, number> = {};
  let matched = 0;
  for (const key of keys) {
    const raw = attributeValueOf(source, key);
    if (raw === undefined) {
      out[key] = 50;
      continue;
    }
    matched += 1;
    out[key] = numberIn(raw, 50, 0, 999);
  }
  if (matched === 0) {
    warnings.push(label + " 没有读取到属性，已使用默认 50");
  } else if (matched < keys.length) {
    warnings.push(label + " 只读取到 " + String(matched) + "/" + String(keys.length) + " 项属性，缺失项按 50 处理");
  }
  return out;
}

function numberWithFallback(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = /[+-]?\d+(?![0-9dD])/.exec(raw);
  if (match !== null) {
    const parsed = Number(match[0]);
    if (Number.isFinite(parsed)) return numberIn(parsed, fallback, min, max);
  }
  return numberIn(fallback, fallback, min, max);
}

function sourceKeyOf(entry: StructuredModuleEntry, index: number, kind: string): string {
  const raw = textOf(entry.data, ["id", "key", "sourceKey", "slug"], entry.id);
  return safeKey(raw, kind + "-" + String(index + 1));
}

function normalizeLayers(value: unknown, warnings: string[], label: string): unknown[] {
  if (Array.isArray(value) === false) return [];
  const layers: unknown[] = [];
  value.forEach((raw, index) => {
    const layer = recordOf(raw);
    const name = textOf(layer, ["name", "title"], "图层 " + String(index + 1));
    const imagePath = textOf(layer, ["image", "imagePath", "asset", "path", "background"], "");
    const type = textOf(layer, ["type", "layerType"], "TILE").toUpperCase();
    layers.push({
      name,
      type: ["BACKGROUND", "TILE", "OBJECT", "EFFECT", "FOREGROUND"].includes(type) ? type : "TILE",
      zIndex: numberIn(layer.zIndex, index, -100, 1000),
      opacity: Math.max(0, Math.min(1, numberIn(layer.opacity, 1, 0, 1))),
      visible: boolOf(layer.visible, true),
      locked: boolOf(layer.locked, false),
      offsetX: numberIn(layer.offsetX, 0, -8000, 8000),
      offsetY: numberIn(layer.offsetY, 0, -8000, 8000),
      scale: Math.max(0.1, Math.min(8, numberIn(layer.scale, 1, 0.1, 8))),
      imagePath: imagePath.length > 0 ? imagePath : null
    });
  });
  return layers;
}

function normalizeTokens(value: unknown): unknown[] {
  if (Array.isArray(value) === false) return [];
  return value.map((raw, index) => {
    const token = recordOf(raw);
    return {
      sourceNpcKey: textOf(token, ["npcId", "npcKey", "sourceNpcKey"], "") || null,
      name: textOf(token, ["name"], "Token " + String(index + 1)),
      x: numberIn(token.x, 0, 0, 100000),
      y: numberIn(token.y, 0, 0, 100000),
      size: Math.max(0.5, Math.min(4, numberIn(token.size, 1, 0.5, 4))),
      borderColor: textOf(token, ["borderColor"], "#ffffff").slice(0, 20),
      imagePath: textOf(token, ["image", "imagePath", "token"], "") || null
    };
  });
}

export async function syncModuleTemplates(
  moduleId: string,
  moduleSystem: string,
  structured: StructuredModuleData
): Promise<TemplateSyncCounts> {
  const warnings: string[] = [];
  const packId = moduleSystem === "TOUHOU" ? "touhou-ext" : "coc7-baseline";
  const compiled = compileParsedRulePack(resolveRulePack(packId, builtinRegistry()));
  const compiledPack: SkillPackLike = compiled;

  let chapters = 0;
  let npcs = 0;
  let items = 0;
  let clues = 0;
  let scenes = 0;
  let encounters = 0;
  let magic = 0;

  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < structured.chapters.length; index += 1) {
      const entry = structured.chapters[index];
      if (entry === undefined) continue;
      const sourceKey = sourceKeyOf(entry, index, "chapter");
      const data = {
        moduleId,
        sourceKey,
        title: textOf(entry.data, ["title", "name"], entry.title).slice(0, 160),
        summary: textOf(entry.data, ["summary", "description"], "") || null,
        orderIndex: numberIn(entry.data.orderIndex, index, 0, 10000)
      };
      await tx.chapterTemplate.upsert({
        where: { moduleId_sourceKey: { moduleId, sourceKey } },
        update: data,
        create: data
      });
      chapters += 1;
    }

    for (let index = 0; index < structured.npcs.length; index += 1) {
      const entry = structured.npcs[index];
      if (entry === undefined) continue;
      const sourceKey = sourceKeyOf(entry, index, "npc");
      const name = textOf(entry.data, ["name", "title"], entry.title).slice(0, 120);
      const label = "NPC「" + name + "」";
      const statsValue = recordOf(entry.data.stats);
      const attributesValue = recordOf(entry.data.attributes ?? statsValue.attributes ?? statsValue);
      const skillsValue = entry.data.skills ?? statsValue.skills;
      const tierRaw = textOf(entry.data, ["tier", "rank"], "STANDARD").toUpperCase();
      const rarityRaw = textOf(entry.data, ["rarity"], "COMMON").toUpperCase();
      const raceRaw = textOf(entry.data, ["race"], "");
      const attributes = normalizedAttributes(attributesValue, warnings, label);
      const skills = normalizedSkills(skillsValue, compiledPack, warnings, label);
      const weapons = normalizedWeapons(
        entry.data.weapons ?? entry.data.attacks ?? [],
        compiledPack,
        warnings,
        label
      );

      let derived: Record<string, number> | null = null;
      try {
        const knownRace = raceRaw.length > 0 && compiled.races[raceRaw] !== undefined ? raceRaw : null;
        derived = computeDerived(compiled, {
          attributes: attributes as unknown as AttributeSet,
          race: knownRace,
          skills
        }).derived;
      } catch {
        derived = null;
      }

      const data = {
        moduleId,
        sourceKey,
        name,
        subtitle: textOf(entry.data, ["subtitle"], "") || null,
        description: textOf(entry.data, ["description", "bio", "background"], "") || null,
        tier: ["MINION", "STANDARD", "ELITE", "BOSS"].includes(tierRaw) ? tierRaw : "STANDARD",
        rarity: (RARITIES as readonly string[]).includes(rarityRaw) ? rarityRaw : "COMMON",
        race: raceRaw.length > 0 ? raceRaw : null,
        tags: stringArray(entry.data.tags),
        attributes,
        skills,
        weapons: weapons as never,
        maxHp: numberWithFallback(entry.data.maxHp ?? statsValue.maxHp, derived?.maxHp ?? 10, 1, 9999),
        maxMp: numberWithFallback(entry.data.maxMp ?? statsValue.maxMp, derived?.maxMp ?? 0, 0, 99999),
        maxSan: numberWithFallback(entry.data.maxSan ?? statsValue.maxSan, derived?.maxSan ?? 0, 0, 999),
        maxDp: numberWithFallback(entry.data.maxDp ?? statsValue.maxDp, derived?.maxDp ?? 0, 0, 99999),
        portraitPath: textOf(entry.data, ["portrait", "portraitPath", "image"], "") || null,
        tokenPath: textOf(entry.data, ["token", "tokenPath"], "") || null,
        isPublicDefault: boolOf(entry.data.isPublic ?? entry.data.public, false),
        orderIndex: numberIn(entry.data.orderIndex, index, 0, 10000)
      };
      await tx.npcTemplate.upsert({
        where: { moduleId_sourceKey: { moduleId, sourceKey } },
        update: data,
        create: data
      });
      npcs += 1;
    }

    for (let index = 0; index < structured.items.length; index += 1) {
      const entry = structured.items[index];
      if (entry === undefined) continue;
      const sourceKey = sourceKeyOf(entry, index, "item");
      const name = textOf(entry.data, ["name", "title"], entry.title).slice(0, 120);
      const label = "物品「" + name + "」";
      const rawType = textOf(entry.data, ["itemType", "kind", "type", "category"], "ITEM").toUpperCase();
      const itemType =
        rawType === "WEAPON"
          ? "WEAPON"
          : rawType === "TOME"
            ? "TOME"
            : rawType === "ARTIFACT"
              ? "ARTIFACT"
              : rawType === "EVIDENCE" || rawType === "CLUE"
                ? "EVIDENCE"
                : "ITEM";
      void label;
      const stats = recordOf(entry.data.stats);
      const data = {
        moduleId,
        sourceKey,
        name,
        itemType: itemType as never,
        description: textOf(entry.data, ["description", "effect", "text"], "") || null,
        rarity: (() => {
          const raw = textOf(entry.data, ["rarity"], "COMMON").toUpperCase();
          return (RARITIES as readonly string[]).includes(raw) ? raw : "COMMON";
        })(),
        imagePath: textOf(entry.data, ["image", "imagePath", "art"], "") || null,
        stats: {
          ...stats,
          damage: textOf(entry.data, ["damage"], textOf(stats, ["damage"], "")),
          range: textOf(entry.data, ["range"], textOf(stats, ["range"], "")),
          skillId: textOf(entry.data, ["skillId", "skill"], textOf(stats, ["skillId"], "")),
          accuracyMod: numberIn(entry.data.accuracyMod ?? stats.accuracyMod, 0, -100, 100),
          mpCost: textOf(entry.data, ["mpCost"], textOf(stats, ["mpCost"], "0")),
          sanCost: textOf(entry.data, ["sanCost"], textOf(stats, ["sanCost"], "0")),
          effect: textOf(entry.data, ["effect"], textOf(stats, ["effect"], "")),
          uses: numberIn(entry.data.uses ?? stats.uses, 0, 0, 9999)
        },
        quantity: numberIn(entry.data.quantity, 1, 1, 9999),
        orderIndex: numberIn(entry.data.orderIndex, index, 0, 10000)
      };
      await tx.itemTemplate.upsert({
        where: { moduleId_sourceKey: { moduleId, sourceKey } },
        update: data,
        create: data
      });
      items += 1;
    }

    for (let index = 0; index < structured.clues.length; index += 1) {
      const entry = structured.clues[index];
      if (entry === undefined) continue;
      const sourceKey = sourceKeyOf(entry, index, "clue");
      const data = {
        moduleId,
        sourceKey,
        title: textOf(entry.data, ["title", "name"], entry.title).slice(0, 160),
        content: textOf(entry.data, ["content", "description", "text"], "").slice(0, 8000),
        imagePath: textOf(entry.data, ["image", "imagePath", "handout"], "") || null,
        linkedItemKey: textOf(entry.data, ["linkedItemId", "linkedItemKey", "itemId", "item"], "") || null,
        isPublicDefault: boolOf(entry.data.isPublic ?? entry.data.public, false),
        orderIndex: numberIn(entry.data.orderIndex, index, 0, 10000)
      };
      await tx.clueTemplate.upsert({
        where: { moduleId_sourceKey: { moduleId, sourceKey } },
        update: data,
        create: data
      });
      clues += 1;
    }

    for (let index = 0; index < structured.scenes.length; index += 1) {
      const entry = structured.scenes[index];
      if (entry === undefined) continue;
      const sourceKey = sourceKeyOf(entry, index, "scene");
      const name = textOf(entry.data, ["name", "title"], entry.title).slice(0, 120);
      const gridRaw = textOf(entry.data, ["gridType", "grid"], "SQUARE").toUpperCase();
      const data = {
        moduleId,
        sourceKey,
        name,
        description: textOf(entry.data, ["description", "summary"], "") || null,
        narration: textOf(entry.data, ["narration", "readAloud", "text"], "") || null,
        weather: textOf(entry.data, ["weather"], "NONE").toUpperCase(),
        timeOfDay: textOf(entry.data, ["timeOfDay", "time"], "DAY").toUpperCase(),
        width: numberIn(entry.data.width, 1600, 200, 8000),
        height: numberIn(entry.data.height, 1000, 200, 8000),
        gridSize: numberIn(entry.data.gridSize, 70, 10, 400),
        gridType: gridRaw === "HEX" || gridRaw === "NONE" ? gridRaw : "SQUARE",
        bgColor: textOf(entry.data, ["bgColor", "backgroundColor"], "#1a1a2e").slice(0, 20),
        showGrid: boolOf(entry.data.showGrid, true),
        showFog: boolOf(entry.data.showFog ?? entry.data.fog, false),
        backgroundPath: textOf(entry.data, ["background", "backgroundPath", "map", "image"], "") || null,
        bgMusicPath: textOf(entry.data, ["bgMusic", "bgMusicPath", "music"], "") || null,
        ambientPath: textOf(entry.data, ["ambient", "ambientPath", "ambientSound"], "") || null,
        layers: normalizeLayers(entry.data.layers, warnings, "场景「" + name + "」"),
        tokens: normalizeTokens(entry.data.tokens),
        orderIndex: numberIn(entry.data.orderIndex, index, 0, 10000)
      };
      await tx.sceneTemplate.upsert({
        where: { moduleId_sourceKey: { moduleId, sourceKey } },
        update: data as never,
        create: data as never
      });
      scenes += 1;
    }

    for (let index = 0; index < structured.encounters.length; index += 1) {
      const entry = structured.encounters[index];
      if (entry === undefined) continue;
      const sourceKey = sourceKeyOf(entry, index, "encounter");
      const setup = recordOf(entry.data.setup);
      const data = {
        moduleId,
        sourceKey,
        title: textOf(entry.data, ["title", "name"], entry.title).slice(0, 160),
        chapterKey: textOf(entry.data, ["chapterId", "chapterKey", "chapter"], "") || null,
        sceneKey: textOf(entry.data, ["sceneId", "sceneKey", "scene", "location"], "") || null,
        trigger: textOf(entry.data, ["trigger", "condition"], "") || null,
        setup: {
          ...setup,
          npcs: stringArray(entry.data.npcs ?? setup.npcs, 40),
          items: stringArray(entry.data.items ?? setup.items, 40)
        } as never,
        orderIndex: numberIn(entry.data.orderIndex, index, 0, 10000)
      };
      await tx.encounterTemplate.upsert({
        where: { moduleId_sourceKey: { moduleId, sourceKey } },
        update: data,
        create: data
      });
      encounters += 1;
    }

    for (let index = 0; index < structured.magic.length; index += 1) {
      const entry = structured.magic[index];
      if (entry === undefined) continue;
      const sourceKey = sourceKeyOf(entry, index, "magic");
      const defaultSkill = moduleSystem === "TOUHOU" ? "MAGIC" : "OCCULT";
      const targetRaw = textOf(entry.data, ["target", "range"], "ONE").toUpperCase();
      const damage = safeDice(entry.data.damage ?? entry.data.damageExpr);
      const data = {
        moduleId,
        sourceKey,
        name: textOf(entry.data, ["name", "title"], entry.title).slice(0, 120),
        skill: textOf(entry.data, ["skill", "skillId", "check"], defaultSkill).slice(0, 60),
        description: textOf(entry.data, ["description", "effect", "summary"], "") || null,
        mpCost: safeExpression(entry.data.mpCost ?? entry.data.cost, "0"),
        sanCost: safeDice(entry.data.sanCost ?? entry.data.sanityCost) ?? "0",
        damage,
        target: targetRaw === "SELF" || targetRaw === "ALL" ? targetRaw : "ONE",
        orderIndex: numberIn(entry.data.orderIndex, index, 0, 10000)
      };
      await tx.magicTemplate.upsert({
        where: { moduleId_sourceKey: { moduleId, sourceKey } },
        update: data,
        create: data
      });
      magic += 1;
    }
  });

  return { chapters, npcs, items, clues, scenes, encounters, magic, warnings };
}

export async function syncModuleTemplatesFromModule(moduleId: string): Promise<TemplateSyncCounts> {
  const moduleRecord = await prisma.module.findUnique({
    where: { id: moduleId },
    select: {
      system: true,
      content: true
    }
  });
  if (moduleRecord === null) {
    return { chapters: 0, npcs: 0, items: 0, clues: 0, scenes: 0, encounters: 0, magic: 0, warnings: ["团本不存在"] };
  }
  let structured = structuredOfContent(moduleRecord.content);
  const content = recordOf(moduleRecord.content);
  const moduleText = typeof content.text === "string" ? content.text : "";
  if (structured.chapters.length === 0 && structured.scenes.length === 0 && structured.npcs.length === 0) {
    structured = parseStructuredBlocks(moduleText);
  }
  const dedupedNpcRecords = dedupeNpcRecords(structured.npcs.map((entry) => entry.data));
  if (dedupedNpcRecords.length !== structured.npcs.length) {
    structured = {
      ...structured,
      npcs: dedupedNpcRecords.map((data, index) => ({
        kind: "npc",
        id: typeof data.id === "string" && data.id.length > 0 ? data.id : "npc-" + String(index + 1),
        title:
          typeof data.name === "string" && data.name.length > 0
            ? data.name
            : typeof data.title === "string" && data.title.length > 0
              ? data.title
              : "npc-" + String(index + 1),
        data
      }))
    };
  }
  if (structured.npcs.length > 0) {
    enrichNpcStatsFromSources(
      structured.npcs.map((entry) => entry.data),
      moduleText.length > 0 ? [{ filename: "module-content", text: moduleText }] : []
    );
  }
  return syncModuleTemplates(moduleId, moduleRecord.system ?? "COC7", structured);
}

export async function ensureModuleTemplates(moduleId: string): Promise<TemplateSyncCounts> {
  // 每次应用预设前都重新同步一次结构化数据：修复旧模块 / 旧缓存中
  // 线索正文、NPC 属性为空的问题；只 upsert，不会删除 npcs.yaml 等来源的模板。
  try {
    await syncModuleTemplatesFromModule(moduleId);
  } catch {
    // 同步失败时仍返回数据库里已有模板计数，避免旧模块完全无法应用。
  }
  const [chapters, npcs, items, clues, scenes, encounters, magic] = await Promise.all([
    prisma.chapterTemplate.count({ where: { moduleId } }),
    prisma.npcTemplate.count({ where: { moduleId } }),
    prisma.itemTemplate.count({ where: { moduleId } }),
    prisma.clueTemplate.count({ where: { moduleId } }),
    prisma.sceneTemplate.count({ where: { moduleId } }),
    prisma.encounterTemplate.count({ where: { moduleId } }),
    prisma.magicTemplate.count({ where: { moduleId } })
  ]);
  return { chapters, npcs, items, clues, scenes, encounters, magic, warnings: [] };
}
