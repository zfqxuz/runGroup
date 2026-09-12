import { deepMerge } from "@touhou/rules";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { ensureModuleRevision } from "@/server/modules/revision";
import { ensureModuleTemplates, type TemplateSyncCounts } from "@/server/modules/templates";

export interface ApplyPresetResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly applicationId?: string;
  readonly alreadyApplied?: boolean;
  readonly counts?: {
    readonly chapters: number;
    readonly scenes: number;
    readonly npcs: number;
    readonly items: number;
    readonly clues: number;
    readonly encounters: number;
    readonly magic: number;
    readonly warnings: readonly string[];
  };
}

interface AssetRef {
  readonly assetId: string;
  readonly relativePath: string;
  readonly originalName: string | null;
}

interface AssetUrl {
  readonly id: string;
  readonly url: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function resolveAssetId(assets: readonly AssetRef[], value: string | null, warnings: string[], label: string): string | null {
  if (value === null || value.trim().length === 0) return null;
  const clean = value.replace(/^\.\//, "");
  const exact = assets.find((asset) => asset.relativePath === clean);
  if (exact !== undefined) return exact.assetId;
  const basename = clean.split("/").pop() ?? clean;
  const suffix = assets.find(
    (asset) => asset.relativePath.endsWith(clean) || asset.relativePath.endsWith("/" + basename) || asset.originalName === basename
  );
  if (suffix !== undefined) return suffix.assetId;
  warnings.push(label + " 引用的资源不存在：" + value);
  return null;
}

function jsonArray(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value) === false) return [];
  return value.filter((item): item is Record<string, unknown> => isPlainObject(item));
}

function numberFrom(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value) === false) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function itemCardType(itemType: string): "WEAPON" | "ITEM" | "CLUE" {
  if (itemType === "WEAPON") return "WEAPON";
  if (itemType === "EVIDENCE") return "CLUE";
  return "ITEM";
}

export async function applyModulePresetToRoom(input: {
  readonly roomId: string;
  readonly moduleId: string;
  readonly userId: string;
  readonly force?: boolean;
}): Promise<ApplyPresetResult> {
  const room = await prisma.room.findUnique({
    where: { id: input.roomId },
    select: {
      id: true,
      name: true,
      system: true,
      status: true,
      ruleOverride: true,
      magicEnabled: true,
      selectedModuleId: true
    }
  });
  if (room === null) return { ok: false, error: "房间不存在" };

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: input.roomId, userId: input.userId } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") return { ok: false, error: "只有 KP 可以应用团本预设" };

  const activeGame = await prisma.game.findFirst({
    where: { roomId: input.roomId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
    select: { id: true, title: true }
  });
  if (activeGame !== null) {
    return { ok: false, error: "当前局「" + activeGame.title + "」尚未结束，请先结束本局再更换预设" };
  }

  const moduleRecord = await prisma.module.findUnique({
    where: { id: input.moduleId },
    select: { id: true, title: true, system: true, roomId: true, isPublished: true, ownerId: true }
  });
  if (moduleRecord === null) return { ok: false, error: "团本不存在" };
  if (
    moduleRecord.roomId !== room.id &&
    moduleRecord.isPublished === false &&
    moduleRecord.ownerId !== input.userId
  ) {
    return { ok: false, error: "你不能在这个房间里使用该团本" };
  }
  if (moduleRecord.system !== null && moduleRecord.system !== room.system) {
    return { ok: false, error: "团本系统与房间不一致" };
  }

  const templateCounts: TemplateSyncCounts = await ensureModuleTemplates(moduleRecord.id);
  const totalTemplates =
    templateCounts.chapters +
    templateCounts.scenes +
    templateCounts.npcs +
    templateCounts.items +
    templateCounts.clues +
    templateCounts.encounters +
    templateCounts.magic;
  if (totalTemplates === 0) {
    return { ok: false, error: "该团本没有可应用的结构化预设：请先在团本管理里重新导入或补全 module-* 块" };
  }

  const [templates, moduleAssets, existingActive] = await Promise.all([
    Promise.all([
      prisma.chapterTemplate.findMany({ where: { moduleId: moduleRecord.id }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] }),
      prisma.sceneTemplate.findMany({ where: { moduleId: moduleRecord.id }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] }),
      prisma.npcTemplate.findMany({ where: { moduleId: moduleRecord.id }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] }),
      prisma.itemTemplate.findMany({ where: { moduleId: moduleRecord.id }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] }),
      prisma.clueTemplate.findMany({ where: { moduleId: moduleRecord.id }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] }),
      prisma.encounterTemplate.findMany({ where: { moduleId: moduleRecord.id }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] }),
      prisma.magicTemplate.findMany({ where: { moduleId: moduleRecord.id }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] })
    ]),
    prisma.moduleAsset.findMany({
      where: { moduleId: moduleRecord.id },
      select: { assetId: true, relativePath: true, originalName: true }
    }),
    prisma.roomPresetApplication.findFirst({
      where: { roomId: room.id, status: "ACTIVE" },
      select: { id: true, moduleId: true, moduleRevisionId: true }
    })
  ]);

  const [chapters, sceneTemplates, npcTemplates, itemTemplates, clueTemplates, encounterTemplates, magicTemplates] = templates;

  if (existingActive !== null && existingActive.moduleId === moduleRecord.id && input.force !== true) {
    return {
      ok: true,
      alreadyApplied: true,
      applicationId: existingActive.id,
      counts: {
        chapters: chapters.length,
        scenes: sceneTemplates.length,
        npcs: npcTemplates.length,
        items: itemTemplates.length,
        clues: clueTemplates.length,
        encounters: encounterTemplates.length,
        magic: magicTemplates.length,
        warnings: templateCounts.warnings
      }
    };
  }

  const revision = await ensureModuleRevision(moduleRecord.id).catch(() => null);
  const assetUrls = new Map<string, string>();
  if (moduleAssets.length > 0) {
    const ids = [...new Set(moduleAssets.map((asset) => asset.assetId))];
    const assets = await prisma.asset.findMany({ where: { id: { in: ids } }, select: { id: true, url: true } });
    for (const asset of assets) assetUrls.set(asset.id, asset.url);
  }
  const warnings: string[] = [...templateCounts.warnings];

  const result = await prisma.$transaction(
    async (tx) => {
      if (existingActive !== null) {
        const oldInstances = await tx.roomPresetInstance.findMany({ where: { applicationId: existingActive.id } });
        const idsOf = (type: string): string[] =>
          oldInstances.filter((item) => item.templateType === type).map((item) => item.entityId);
        const encounterIds = idsOf("ENCOUNTER");
        const sceneIds = idsOf("SCENE");
        const cardIds = idsOf("CARD");
        const clueIds = idsOf("CLUE");
        const chapterIds = idsOf("ROOM_CHAPTER");
        if (encounterIds.length > 0) await tx.encounter.deleteMany({ where: { id: { in: encounterIds } } });
        if (clueIds.length > 0) await tx.clue.deleteMany({ where: { id: { in: clueIds } } });
        if (cardIds.length > 0) await tx.card.deleteMany({ where: { id: { in: cardIds } } });
        if (sceneIds.length > 0) await tx.scene.deleteMany({ where: { id: { in: sceneIds } } });
        if (chapterIds.length > 0) await tx.roomChapter.deleteMany({ where: { id: { in: chapterIds } } });
        await tx.roomPresetInstance.deleteMany({ where: { applicationId: existingActive.id } });
        await tx.roomPresetApplication.update({
          where: { id: existingActive.id },
          data: { status: "REPLACED", replacedAt: new Date() }
        });
      }

      const application = await tx.roomPresetApplication.create({
        data: {
          roomId: room.id,
          moduleId: moduleRecord.id,
          moduleRevisionId: revision?.id ?? null,
          status: "ACTIVE",
          appliedBy: input.userId
        },
        select: { id: true }
      });

      const recordInstance = async (templateType: string, templateId: string, entityId: string): Promise<void> => {
        await tx.roomPresetInstance.create({
          data: { applicationId: application.id, templateType, templateId, entityId }
        });
      };

      const roomChapterIdByKey = new Map<string, string>();
      for (const [index, template] of chapters.entries()) {
        const chapter = await tx.roomChapter.create({
          data: {
            roomId: room.id,
            sourceTemplateId: template.id,
            title: template.title,
            summary: template.summary,
            orderIndex: index
          },
          select: { id: true }
        });
        roomChapterIdByKey.set(normalizeKey(template.sourceKey), chapter.id);
        roomChapterIdByKey.set(normalizeKey(template.title), chapter.id);
        await recordInstance("ROOM_CHAPTER", template.id, chapter.id);
      }

      const sceneIdByKey = new Map<string, string>();
      const mapIdBySceneId = new Map<string, string>();
      const existingSceneCount = await tx.scene.count({ where: { roomId: room.id } });
      let activeAssigned = existingSceneCount > 0;
      for (const [index, template] of sceneTemplates.entries()) {
        const backgroundId = resolveAssetId(moduleAssets, template.backgroundPath, warnings, "场景「" + template.name + "」");
        const scene = await tx.scene.create({
          data: {
            roomId: room.id,
            name: template.name,
            description: template.description,
            narration: template.narration,
            weather: template.weather as never,
            timeOfDay: template.timeOfDay as never,
            isActive: activeAssigned === false,
            orderIndex: existingSceneCount + index,
            map: {
              create: {
                name: template.name,
                width: template.width,
                height: template.height,
                gridSize: template.gridSize,
                gridType: template.gridType,
                bgColor: template.bgColor,
                showGrid: template.showGrid,
                showFog: template.showFog,
                backgroundId
              }
            }
          },
          select: { id: true, map: { select: { id: true } } }
        });
        if (activeAssigned === false) activeAssigned = true;
        sceneIdByKey.set(normalizeKey(template.sourceKey), scene.id);
        sceneIdByKey.set(normalizeKey(template.name), scene.id);
        await recordInstance("SCENE", template.id, scene.id);
        const mapId = scene.map?.id ?? null;
        if (mapId !== null) mapIdBySceneId.set(scene.id, mapId);

        const layers = jsonArray(template.layers);
        for (const [layerIndex, layer] of layers.entries()) {
          const layerPath = typeof layer.imagePath === "string" ? layer.imagePath : null;
          const assetId = resolveAssetId(moduleAssets, layerPath, warnings, "场景「" + template.name + "」图层");
          const rawType = typeof layer.type === "string" ? layer.type : "TILE";
          await tx.mapLayer.create({
            data: {
              mapId: mapId ?? "",
              name: typeof layer.name === "string" ? layer.name.slice(0, 80) : "图层 " + String(layerIndex + 1),
              type: (["BACKGROUND", "TILE", "OBJECT", "EFFECT", "FOREGROUND"].includes(rawType) ? rawType : "TILE") as never,
              zIndex: Math.floor(numberFrom(layer.zIndex, layerIndex)),
              opacity: Math.max(0, Math.min(1, numberFrom(layer.opacity, 1))),
              visible: layer.visible !== false,
              locked: layer.locked === true,
              offsetX: numberFrom(layer.offsetX, 0),
              offsetY: numberFrom(layer.offsetY, 0),
              scale: Math.max(0.1, Math.min(8, numberFrom(layer.scale, 1))),
              assetId
            }
          });
        }
      }

      const npcCardIdByKey = new Map<string, string>();
      for (const [index, template] of npcTemplates.entries()) {
        const portraitId = resolveAssetId(moduleAssets, template.portraitPath, warnings, "NPC「" + template.name + "」头像");
        const card = await tx.card.create({
          data: {
            scope: "ROOM",
            roomId: room.id,
            ownerId: input.userId,
            type: "NPC",
            name: template.name,
            subtitle: template.subtitle,
            description: template.description,
            rarity: template.rarity as never,
            system: room.system as never,
            imageUrl: portraitId === null ? null : assetUrls.get(portraitId) ?? null,
            isPublic: template.isPublicDefault,
            stats: {
              presetId: null,
              tier: template.tier,
              race: template.race,
              attributes: template.attributes as never,
              skills: template.skills as never,
              maxHp: template.maxHp,
              maxMp: template.maxMp,
              maxSan: template.maxSan,
              maxDp: template.maxDp,
              tags: template.tags as never,
              rarity: template.rarity
            } as never
          } as never,
          select: { id: true }
        });
        npcCardIdByKey.set(normalizeKey(template.sourceKey), card.id);
        npcCardIdByKey.set(normalizeKey(template.name), card.id);
        await recordInstance("CARD", template.id, card.id);
      }

      const itemCardIdByKey = new Map<string, string>();
      for (const [index, template] of itemTemplates.entries()) {
        const imageId = resolveAssetId(moduleAssets, template.imagePath, warnings, "物品「" + template.name + "」图片");
        const card = await tx.card.create({
          data: {
            scope: "ROOM",
            roomId: room.id,
            ownerId: input.userId,
            type: itemCardType(template.itemType),
            name: template.name,
            subtitle: template.itemType,
            description: template.description,
            rarity: template.rarity as never,
            system: room.system as never,
            imageUrl: imageId === null ? null : assetUrls.get(imageId) ?? null,
            quantity: template.quantity,
            stats: (template.stats ?? {}) as never
          } as never,
          select: { id: true }
        });
        itemCardIdByKey.set(normalizeKey(template.sourceKey), card.id);
        itemCardIdByKey.set(normalizeKey(template.name), card.id);
        await recordInstance("CARD", template.id, card.id);
      }

      const clueIdByKey = new Map<string, string>();
      for (const [index, template] of clueTemplates.entries()) {
        const imageId = resolveAssetId(moduleAssets, template.imagePath, warnings, "线索「" + template.title + "」图片");
        const clue = await tx.clue.create({
          data: {
            roomId: room.id,
            title: template.title,
            content: template.content,
            isPublic: template.isPublicDefault,
            assetId: imageId
          },
          select: { id: true }
        });
        clueIdByKey.set(normalizeKey(template.sourceKey), clue.id);
        clueIdByKey.set(normalizeKey(template.title), clue.id);
        await recordInstance("CLUE", template.id, clue.id);
        if (template.linkedItemKey !== null) {
          const cardId = itemCardIdByKey.get(normalizeKey(template.linkedItemKey));
          if (cardId === undefined) {
            warnings.push("线索「" + template.title + "」关联的证物 id 不存在：" + template.linkedItemKey);
          } else {
            const existing = await tx.card.findUnique({ where: { id: cardId }, select: { stats: true } });
            const stats = isPlainObject(existing?.stats) ? existing.stats : {};
            await tx.card.update({
              where: { id: cardId },
              data: { stats: { ...stats, linkedClueId: clue.id } as never }
            });
          }
        }
      }

      for (const template of sceneTemplates) {
        const sceneId = sceneIdByKey.get(normalizeKey(template.sourceKey));
        const mapId = sceneId === undefined ? null : mapIdBySceneId.get(sceneId) ?? null;
        if (mapId === null) continue;
        for (const token of jsonArray(template.tokens)) {
          const tokenPath = typeof token.imagePath === "string" ? token.imagePath : null;
          const tokenImageId = resolveAssetId(moduleAssets, tokenPath, warnings, "场景 Token");
          await tx.token.create({
            data: {
              roomId: room.id,
              mapId,
              assetId: tokenImageId,
              name: typeof token.name === "string" ? token.name.slice(0, 80) : "Token",
              x: numberFrom(token.x, 0),
              y: numberFrom(token.y, 0),
              size: Math.max(0.5, Math.min(4, numberFrom(token.size, 1))),
              borderColor: typeof token.borderColor === "string" ? token.borderColor.slice(0, 20) : "#ffffff"
            }
          });
        }
      }

      for (const [index, template] of encounterTemplates.entries()) {
        const roomChapterId =
          template.chapterKey === null ? null : roomChapterIdByKey.get(normalizeKey(template.chapterKey)) ?? null;
        const sceneId = template.sceneKey === null ? null : sceneIdByKey.get(normalizeKey(template.sceneKey)) ?? null;
        const setup = isPlainObject(template.setup) ? template.setup : {};
        const npcKeys = stringArray(setup.npcs);
        const itemKeys = stringArray(setup.items);
        const mappedNpcs = npcKeys
          .map((key) => npcCardIdByKey.get(normalizeKey(key)))
          .filter((id): id is string => typeof id === "string");
        const mappedItems = itemKeys
          .map((key) => itemCardIdByKey.get(normalizeKey(key)))
          .filter((id): id is string => typeof id === "string");
        if (npcKeys.length > 0 && mappedNpcs.length !== npcKeys.length) {
          warnings.push("遭遇「" + template.title + "」有 NPC 引用无法解析");
        }
        const encounter = await tx.encounter.create({
          data: {
            roomId: room.id,
            roomChapterId,
            sceneId,
            title: template.title,
            trigger: template.trigger,
            setup: { ...setup, npcIds: mappedNpcs, itemIds: mappedItems } as never,
            orderIndex: index
          },
          select: { id: true }
        });
        await recordInstance("ENCOUNTER", template.id, encounter.id);
      }

      if (magicTemplates.length > 0) {
        const spells = magicTemplates.map((template) => ({
          id: template.id,
          name: template.name,
          skill: template.skill,
          description: template.description ?? undefined,
          mpCost: template.mpCost,
          sanCost: template.sanCost,
          damage: template.damage ?? undefined,
          target: template.target === "SELF" || template.target === "ALL" ? template.target : "ONE"
        }));
        const existingMagic = isPlainObject(room.ruleOverride) ? room.ruleOverride.magic : {};
        const overlay = {
          magic: {
            ...(isPlainObject(existingMagic) ? existingMagic : {}),
            enabled: true,
            system: room.system,
            spells
          }
        };
        const merged = isPlainObject(room.ruleOverride) ? deepMerge(room.ruleOverride, overlay) : overlay;
        await tx.room.update({
          where: { id: room.id },
          data: { ruleOverride: merged as never, magicEnabled: true, selectedModuleId: moduleRecord.id }
        });
        for (const template of magicTemplates) {
          await recordInstance("MAGIC", template.id, template.id);
        }
      } else {
        const existingMagic = isPlainObject(room.ruleOverride) ? room.ruleOverride.magic : {};
        const overlay = { magic: { ...(isPlainObject(existingMagic) ? existingMagic : {}), enabled: false, spells: [] } };
        const merged = isPlainObject(room.ruleOverride) ? deepMerge(room.ruleOverride, overlay) : overlay;
        await tx.room.update({
          where: { id: room.id },
          data: { ruleOverride: merged as never, magicEnabled: false, selectedModuleId: moduleRecord.id }
        });
      }

      return application;
    },
    { timeout: 30000, maxWait: 10000 }
  );

  return {
    ok: true,
    applicationId: result.id,
    counts: {
      chapters: chapters.length,
      scenes: sceneTemplates.length,
      npcs: npcTemplates.length,
      items: itemTemplates.length,
      clues: clueTemplates.length,
      encounters: encounterTemplates.length,
      magic: magicTemplates.length,
      warnings
    }
  };
}

export type { Prisma };
