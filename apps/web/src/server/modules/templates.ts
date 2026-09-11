import { compile, parseDice } from "@touhou/formula";
import { builtinRegistry, RARITIES, resolveRulePack } from "@touhou/rules";
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

function skillIdsOf(compiled: SkillPackLike): Map<string, string> {
  const byName = new Map<string, string>();
  for (const skill of compiled.skills) {
    byName.set(skill.id.toLowerCase(), skill.id);
    byName.set(skill.name.toLowerCase(), skill.id);
    byName.set(skill.id, skill.id);
  }
  return byName;
}

function normalizedSkills(
  value: unknown,
  compiled: SkillPackLike,
  warnings: string[],
  label: string
): Record<string, number> {
  const source = recordOf(value);
  const byName = skillIdsOf(compiled);
  const out: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const skillId = byName.get(rawKey.toLowerCase()) ?? byName.get(rawKey);
    if (skillId === undefined) {
      warnings.push(label + " 的技能「" + rawKey + "」不在当前规则包中，已忽略");
      continue;
    }
    const number = numberIn(rawValue, 0, 0, 999);
    if (number > 0) out[skillId] = number;
  }
  return out;
}

function normalizedAttributes(value: unknown, warnings: string[], label: string): Record<string, number> {
  const source = recordOf(value);
  const keys = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = numberIn(source[key], 50, 0, 999);
  }
  if (Object.keys(source).length === 0) warnings.push(label + " 没有属性，已使用默认 50");
  return out;
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
  const compiled = resolveRulePack(packId, builtinRegistry());
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
      const attributesValue = recordOf(entry.data.attributes ?? statsValue.attributes);
      const skillsValue = entry.data.skills ?? statsValue.skills;
      const tierRaw = textOf(entry.data, ["tier", "rank"], "STANDARD").toUpperCase();
      const rarityRaw = textOf(entry.data, ["rarity"], "COMMON").toUpperCase();
      const data = {
        moduleId,
        sourceKey,
        name,
        subtitle: textOf(entry.data, ["subtitle"], "") || null,
        description: textOf(entry.data, ["description", "bio", "background"], "") || null,
        tier: ["MINION", "STANDARD", "ELITE", "BOSS"].includes(tierRaw) ? tierRaw : "STANDARD",
        rarity: (RARITIES as readonly string[]).includes(rarityRaw) ? rarityRaw : "COMMON",
        race: textOf(entry.data, ["race"], "") || null,
        tags: stringArray(entry.data.tags),
        attributes: normalizedAttributes(attributesValue, warnings, label),
        skills: normalizedSkills(skillsValue, compiledPack, warnings, label),
        maxHp: numberIn(entry.data.maxHp ?? statsValue.maxHp, 10, 1, 9999),
        maxMp: numberIn(entry.data.maxMp ?? statsValue.maxMp, 0, 0, 99999),
        maxSan: numberIn(entry.data.maxSan ?? statsValue.maxSan, 0, 0, 999),
        maxDp: numberIn(entry.data.maxDp ?? statsValue.maxDp, 0, 0, 99999),
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
  if (structured.chapters.length === 0 && structured.scenes.length === 0 && structured.npcs.length === 0) {
    const text = typeof content.text === "string" ? content.text : "";
    structured = parseStructuredBlocks(text);
  }
  return syncModuleTemplates(moduleId, moduleRecord.system ?? "COC7", structured);
}

export async function ensureModuleTemplates(moduleId: string): Promise<TemplateSyncCounts> {
  const [chapters, npcs, items, clues, scenes, encounters, magic] = await Promise.all([
    prisma.chapterTemplate.count({ where: { moduleId } }),
    prisma.npcTemplate.count({ where: { moduleId } }),
    prisma.itemTemplate.count({ where: { moduleId } }),
    prisma.clueTemplate.count({ where: { moduleId } }),
    prisma.sceneTemplate.count({ where: { moduleId } }),
    prisma.encounterTemplate.count({ where: { moduleId } }),
    prisma.magicTemplate.count({ where: { moduleId } })
  ]);
  if (chapters + npcs + items + clues + scenes + encounters + magic > 0) {
    return { chapters, npcs, items, clues, scenes, encounters, magic, warnings: [] };
  }
  return syncModuleTemplatesFromModule(moduleId);
}
