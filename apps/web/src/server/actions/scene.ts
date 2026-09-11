"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { emitSceneTokenUpdate, emitSceneUpdate } from "@/server/realtime";
import { loadGameModuleView } from "@/server/modules/revision";
import { loadSceneTokenView } from "@/server/scene/load";
import { snapPointToGrid } from "@/shared/scene-geometry";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function optionalClean(value: FormDataEntryValue | null, maxLength: number): string | null {
  const text = clean(value, maxLength);
  return text.length === 0 ? null : text;
}

function intOf(value: FormDataEntryValue | null, fallback: number): number {
  const number = Number(String(value ?? "").trim());
  if (Number.isFinite(number) === false) return fallback;
  return Math.floor(number);
}

function numberOr(value: FormDataEntryValue | null, fallback: number): number {
  const number = Number(String(value ?? "").trim());
  return Number.isFinite(number) ? number : fallback;
}

function boolOf(value: FormDataEntryValue | null): boolean {
  return value !== null && (value === "1" || value === "on" || value === "true");
}

async function requireKp(roomId: string, userId: string): Promise<boolean> {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
  return membership !== null && membership.role === "KP";
}

function scenesPath(roomId: string, query: string): string {
  return "/rooms/" + roomId + "/scenes" + query;
}

function revalidateScene(roomId: string): void {
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/scenes");
}

export async function createSceneAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  if ((await requireKp(roomId, session.user.id)) === false) redirect("/rooms/" + roomId + "/prepare");

  const name = clean(formData.get("name"), 120);
  if (name.length === 0) redirect(scenesPath(roomId, "?error=name"));
  const description = optionalClean(formData.get("description"), 2000);
  const count = await prisma.scene.count({ where: { roomId } });

  await prisma.scene.create({
    data: {
      roomId,
      name,
      description,
      isActive: count === 0,
      orderIndex: count,
      map: {
        create: {
          name,
          width: 1600,
          height: 1000,
          gridSize: 70,
          gridType: "SQUARE",
          bgColor: "#1a1a2e",
          showGrid: true,
          showFog: false
        }
      }
    }
  });

  revalidateScene(roomId);
  emitSceneUpdate(roomId, null);
  redirect(scenesPath(roomId, "?saved=created"));
}

export async function activateSceneAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const sceneId = clean(formData.get("sceneId"), 64);
  if ((await requireKp(roomId, session.user.id)) === false) redirect("/rooms/" + roomId + "/prepare");

  const scene = await prisma.scene.findUnique({ where: { id: sceneId }, select: { roomId: true } });
  if (scene === null || scene.roomId !== roomId) redirect(scenesPath(roomId, "?error=scene"));

  await prisma.$transaction([
    prisma.scene.updateMany({ where: { roomId }, data: { isActive: false } }),
    prisma.scene.update({ where: { id: sceneId }, data: { isActive: true } })
  ]);

  revalidateScene(roomId);
  emitSceneUpdate(roomId, sceneId);
  redirect(scenesPath(roomId, "?saved=active"));
}

export async function updateSceneAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const sceneId = clean(formData.get("sceneId"), 64);
  if ((await requireKp(roomId, session.user.id)) === false) redirect("/rooms/" + roomId + "/prepare");

  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: { map: { select: { id: true } } }
  });
  if (scene === null || scene.roomId !== roomId) redirect(scenesPath(roomId, "?error=scene"));

  const name = clean(formData.get("name"), 120);
  if (name.length === 0) redirect(scenesPath(roomId, "?error=name"));

  const weather = clean(formData.get("weather"), 20) || "NONE";
  const timeOfDay = clean(formData.get("timeOfDay"), 20) || "DAY";
  const gridType = clean(formData.get("gridType"), 20) || "SQUARE";
  const width = Math.max(200, Math.min(8000, intOf(formData.get("width"), 1600)));
  const height = Math.max(200, Math.min(8000, intOf(formData.get("height"), 1000)));
  const gridSize = Math.max(10, Math.min(400, intOf(formData.get("gridSize"), 70)));
  const initialX = numberOr(formData.get("initialX"), 0);
  const initialY = numberOr(formData.get("initialY"), 0);
  const initialZoom = Math.max(0.2, Math.min(4, numberOr(formData.get("initialZoom"), 1)));

  await prisma.$transaction(async (tx) => {
    await tx.scene.update({
      where: { id: sceneId },
      data: {
        name,
        description: optionalClean(formData.get("description"), 2000),
        narration: optionalClean(formData.get("narration"), 5000),
        weather: (["NONE", "RAIN", "SNOW", "FOG", "STORM", "SAKURA", "PETALS"].includes(weather) ? weather : "NONE") as never,
        timeOfDay: (["DAWN", "DAY", "DUSK", "NIGHT", "MIDNIGHT"].includes(timeOfDay) ? timeOfDay : "DAY") as never
      }
    });
    const mapData = {
      name,
      width,
      height,
      gridSize,
      gridType: (["SQUARE", "HEX", "NONE"].includes(gridType) ? gridType : "SQUARE") as never,
      bgColor: clean(formData.get("bgColor"), 20) || "#1a1a2e",
      showGrid: boolOf(formData.get("showGrid")),
      showFog: boolOf(formData.get("showFog")),
      initialX,
      initialY,
      initialZoom
    };
    if (scene.map === null) {
      await tx.map.create({ data: { sceneId, ...mapData } });
    } else {
      await tx.map.update({ where: { id: scene.map.id }, data: mapData });
    }
  });

  revalidateScene(roomId);
  emitSceneUpdate(roomId, sceneId);
  redirect(scenesPath(roomId, "?saved=1"));
}

export async function deleteSceneAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const sceneId = clean(formData.get("sceneId"), 64);
  if ((await requireKp(roomId, session.user.id)) === false) redirect("/rooms/" + roomId + "/prepare");

  const scene = await prisma.scene.findUnique({ where: { id: sceneId }, select: { roomId: true, isActive: true } });
  if (scene === null || scene.roomId !== roomId) redirect(scenesPath(roomId, "?error=scene"));
  await prisma.scene.delete({ where: { id: sceneId } });

  if (scene.isActive) {
    const next = await prisma.scene.findFirst({ where: { roomId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
    if (next !== null) {
      await prisma.scene.update({ where: { id: next.id }, data: { isActive: true } });
    }
  }

  revalidateScene(roomId);
  emitSceneUpdate(roomId, null);
  redirect(scenesPath(roomId, "?saved=deleted"));
}

export async function createSceneTokenAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const sceneId = clean(formData.get("sceneId"), 64);
  const unitRef = clean(formData.get("unitRef"), 128);
  if ((await requireKp(roomId, session.user.id)) === false) redirect("/rooms/" + roomId + "/prepare");

  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: { map: { select: { id: true, width: true, height: true, gridSize: true, gridType: true } } }
  });
  if (scene === null || scene.roomId !== roomId) redirect(scenesPath(roomId, "?error=scene"));

  const map = scene.map ?? (await prisma.map.create({
    data: { sceneId, name: scene.name, width: 1600, height: 1000, gridSize: 70, bgColor: "#1a1a2e", showGrid: true, showFog: false },
    select: { id: true, width: true, height: true, gridSize: true, gridType: true }
  }));

  const [kind, id] = unitRef.split(":", 2);
  let name = "";
  let characterId: string | null = null;
  let borderColor = "#ffffff";

  if (kind === "character" && id !== undefined) {
    const game = await prisma.game.findFirst({
      where: { roomId, status: { in: ["PLAYING", "COMBAT"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    if (game === null) redirect(scenesPath(roomId, "?error=no-game"));
    const gameCharacter = await prisma.gameCharacter.findUnique({
      where: { gameId_characterId: { gameId: game.id, characterId: id } },
      include: { character: { select: { name: true } } }
    });
    if (gameCharacter === null) redirect(scenesPath(roomId, "?error=unit"));
    name = gameCharacter.character.name;
    characterId = id;
    borderColor = "#38bdf8";
  } else if (kind === "npc" && id !== undefined) {
    const card = await prisma.card.findUnique({ where: { id } });
    if (card === null || card.roomId !== roomId || card.scope !== "ROOM" || card.type !== "NPC") {
      redirect(scenesPath(roomId, "?error=unit"));
    }
    name = card.name;
    borderColor = "#ef4444";
  } else {
    redirect(scenesPath(roomId, "?error=unit"));
  }

  const maxZ = await prisma.token.aggregate({ where: { mapId: map.id }, _max: { zIndex: true } });
  const spawn = snapPointToGrid(
    { width: map.width, height: map.height, gridSize: map.gridSize, gridType: map.gridType },
    map.width / 2,
    map.height / 2
  );
  await prisma.token.create({
    data: {
      mapId: map.id,
      characterId,
      name,
      x: spawn.x,
      y: spawn.y,
      size: 1,
      zIndex: (maxZ._max.zIndex ?? 0) + 1,
      borderColor
    }
  });

  revalidateScene(roomId);
  emitSceneUpdate(roomId, sceneId);
  redirect(scenesPath(roomId, "?saved=token"));
}

export async function deleteSceneTokenAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const tokenId = clean(formData.get("tokenId"), 64);
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: { map: { select: { scene: { select: { roomId: true } } } }, character: { select: { userId: true } } }
  });
  if (token === null || token.map.scene.roomId !== roomId) redirect(scenesPath(roomId, "?error=token"));

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  const canDelete = membership?.role === "KP" || (token.character !== null && token.character.userId === session.user.id);
  if (canDelete === false) redirect(scenesPath(roomId, "?error=permission"));

  await prisma.token.delete({ where: { id: tokenId } });
  revalidateScene(roomId);
  emitSceneUpdate(roomId, null);
  redirect(scenesPath(roomId, "?saved=token-deleted"));
}

export async function moveSceneTokenAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const tokenId = clean(formData.get("tokenId"), 64);
  const x = numberOr(formData.get("x"), 0);
  const y = numberOr(formData.get("y"), 0);
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: {
      map: { select: { width: true, height: true, scene: { select: { roomId: true } } } },
      character: { select: { userId: true } }
    }
  });
  if (token === null || token.map.scene.roomId !== roomId) redirect("/rooms/" + roomId);

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  const canMove = membership?.role === "KP" || (token.character !== null && token.character.userId === session.user.id);
  if (canMove === false) redirect("/rooms/" + roomId);

  await prisma.token.update({
    where: { id: tokenId },
    data: {
      x: Math.max(0, Math.min(token.map.width, x)),
      y: Math.max(0, Math.min(token.map.height, y))
    }
  });
  const updated = await loadSceneTokenView(tokenId);
  if (updated !== null) emitSceneTokenUpdate(roomId, updated.token);
  revalidatePath("/rooms/" + roomId);
  redirect("/rooms/" + roomId + "?scene-token-moved=1");
}

export async function updateSceneTokenAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const tokenId = clean(formData.get("tokenId"), 64);
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: { map: { select: { scene: { select: { roomId: true } } } }, character: { select: { userId: true } } }
  });
  if (token === null || token.map.scene.roomId !== roomId) redirect(scenesPath(roomId, "?error=token"));

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  const isKP = membership?.role === "KP";
  const canEdit = isKP || (token.character !== null && token.character.userId === session.user.id);
  if (canEdit === false) redirect(scenesPath(roomId, "?error=permission"));

  const name = clean(formData.get("name"), 120) || token.name;
  const borderColor = clean(formData.get("borderColor"), 20) || token.borderColor;
  const size = Math.max(0.5, Math.min(4, numberOr(formData.get("size"), token.size)));
  const rotation = numberOr(formData.get("rotation"), token.rotation);
  const showName = boolOf(formData.get("showName"));
  const showHpBar = boolOf(formData.get("showHpBar"));

  await prisma.token.update({
    where: { id: tokenId },
    data: {
      name,
      borderColor,
      size,
      rotation,
      showName,
      showHpBar,
      ...(isKP
        ? {
            isVisible: boolOf(formData.get("isVisible")),
            isLocked: boolOf(formData.get("isLocked"))
          }
        : {})
    }
  });

  const updated = await loadSceneTokenView(tokenId);
  if (updated !== null) emitSceneTokenUpdate(roomId, updated.token);
  revalidateScene(roomId);
  redirect(scenesPath(roomId, "?saved=token-updated"));
}

/* ------------------------- 地图图层 ------------------------- */

const LAYER_TYPES = ["BACKGROUND", "TILE", "OBJECT", "EFFECT", "FOREGROUND"] as const;

function numberIn(value: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  const number = Number(String(value ?? "").trim());
  if (Number.isFinite(number) === false) return fallback;
  return Math.max(min, Math.min(max, number));
}

export async function createMapLayerAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const sceneId = clean(formData.get("sceneId"), 64);
  if ((await requireKp(roomId, session.user.id)) === false) redirect("/rooms/" + roomId + "/prepare");

  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: { map: { select: { id: true } } }
  });
  if (scene === null || scene.roomId !== roomId) redirect(scenesPath(roomId, "?error=scene"));

  const name = clean(formData.get("name"), 80) || "新图层";
  const typeRaw = clean(formData.get("layerType"), 20);
  const type = (LAYER_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : "TILE";
  let mapId = scene.map?.id ?? null;
  if (mapId === null) {
    const map = await prisma.map.create({
      data: { sceneId, name: scene.name, width: 1600, height: 1000, gridSize: 70, bgColor: "#1a1a2e", showGrid: true },
      select: { id: true }
    });
    mapId = map.id;
  }
  await prisma.mapLayer.create({
    data: {
      mapId,
      name,
      type: type as never,
      zIndex: Math.floor(numberIn(formData.get("zIndex"), 0, -100, 1000)),
      opacity: numberIn(formData.get("opacity"), 1, 0, 1),
      visible: boolOf(formData.get("visible")),
      locked: boolOf(formData.get("locked")),
      offsetX: numberIn(formData.get("offsetX"), 0, -8000, 8000),
      offsetY: numberIn(formData.get("offsetY"), 0, -8000, 8000),
      scale: numberIn(formData.get("scale"), 1, 0.1, 8)
    }
  });
  revalidateScene(roomId);
  emitSceneUpdate(roomId, sceneId);
  redirect(scenesPath(roomId, "?saved=layer-created"));
}

export async function updateMapLayerAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const layerId = clean(formData.get("layerId"), 64);
  const layer = await prisma.mapLayer.findUnique({
    where: { id: layerId },
    include: { map: { select: { scene: { select: { id: true, roomId: true } } } } }
  });
  if (layer === null) redirect("/");
  const roomId = layer.map.scene.roomId;
  if ((await requireKp(roomId, session.user.id)) === false) redirect("/rooms/" + roomId + "/prepare");

  const typeRaw = clean(formData.get("layerType"), 20);
  const type = (LAYER_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : layer.type;
  await prisma.mapLayer.update({
    where: { id: layer.id },
    data: {
      name: clean(formData.get("name"), 80) || layer.name,
      type: type as never,
      zIndex: Math.floor(numberIn(formData.get("zIndex"), layer.zIndex, -100, 1000)),
      opacity: numberIn(formData.get("opacity"), layer.opacity, 0, 1),
      visible: boolOf(formData.get("visible")),
      locked: boolOf(formData.get("locked")),
      offsetX: numberIn(formData.get("offsetX"), layer.offsetX, -8000, 8000),
      offsetY: numberIn(formData.get("offsetY"), layer.offsetY, -8000, 8000),
      scale: numberIn(formData.get("scale"), layer.scale, 0.1, 8)
    }
  });
  revalidateScene(roomId);
  emitSceneUpdate(roomId, layer.map.scene.id);
  redirect(scenesPath(roomId, "?saved=layer-updated"));
}

export async function deleteMapLayerAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const layerId = clean(formData.get("layerId"), 64);
  const layer = await prisma.mapLayer.findUnique({
    where: { id: layerId },
    include: { map: { select: { scene: { select: { id: true, roomId: true } } } } }
  });
  if (layer === null) redirect("/");
  const roomId = layer.map.scene.roomId;
  if ((await requireKp(roomId, session.user.id)) === false) redirect("/rooms/" + roomId + "/prepare");
  await prisma.mapLayer.delete({ where: { id: layer.id } });
  revalidateScene(roomId);
  emitSceneUpdate(roomId, layer.map.scene.id);
  redirect(scenesPath(roomId, "?saved=layer-deleted"));
}

/* ------------------- 从团本结构化数据生成场景 ------------------- */

function dataText(data: Record<string, unknown>, keys: readonly string[], fallback: string): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function dataBool(data: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    if (data[key] === true || data[key] === "true" || data[key] === "1") return true;
  }
  return false;
}

function dataInteger(data: Record<string, unknown>, keys: readonly string[], fallback: number, min: number, max: number): number {
  for (const key of keys) {
    const value = data[key];
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(number)) return Math.max(min, Math.min(max, Math.floor(number)));
  }
  return fallback;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export async function importModuleScenesAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  if ((await requireKp(roomId, session.user.id)) === false) redirect("/rooms/" + roomId + "/prepare");

  const game = await prisma.game.findFirst({
    where: { roomId, moduleId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, moduleId: true, moduleRevisionId: true }
  });
  if (game === null) redirect(scenesPath(roomId, "?error=no-module"));

  const view = await loadGameModuleView(game);
  if (view === null) redirect(scenesPath(roomId, "?error=no-module"));
  const structured = view.structured;
  if (structured.scenes.length === 0 && structured.encounters.length === 0) {
    redirect(scenesPath(roomId, "?error=module-empty"));
  }

  const moduleId = view.moduleId ?? game.moduleId;
  if (moduleId === null) redirect(scenesPath(roomId, "?error=no-module"));

  const existingChapterCount = await prisma.moduleChapter.count({ where: { moduleId } });
  const chapterIdByKey = new Map<string, string>();
  let chapterIndex = existingChapterCount;
  for (const chapter of structured.chapters) {
    const title = dataText(chapter.data, ["name", "title"], chapter.title);
    const existing = existingChapterCount > 0
      ? await prisma.moduleChapter.findFirst({ where: { moduleId, title }, select: { id: true } })
      : null;
    const chapterId = existing === null
      ? (await prisma.moduleChapter.create({
          data: {
            moduleId,
            title,
            summary: dataText(chapter.data, ["summary", "description"], ""),
            orderIndex: chapterIndex
          },
          select: { id: true }
        })).id
      : existing.id;
    chapterIndex += 1;
    chapterIdByKey.set(normalizeKey(chapter.id), chapterId);
    chapterIdByKey.set(normalizeKey(title), chapterId);
  }

  const existingSceneCount = await prisma.scene.count({ where: { roomId } });
  const sceneIdByKey = new Map<string, string>();
  let sceneIndex = existingSceneCount;
  let activeAssigned = existingSceneCount > 0;
  const createdSceneIds: string[] = [];

  for (const scene of structured.scenes) {
    const name = dataText(scene.data, ["name", "title"], scene.title).slice(0, 120);
    const existing = await prisma.scene.findFirst({ where: { roomId, name }, select: { id: true } });
    if (existing !== null) {
      sceneIdByKey.set(normalizeKey(scene.id), existing.id);
      sceneIdByKey.set(normalizeKey(name), existing.id);
      continue;
    }
    const width = dataInteger(scene.data, ["width"], 1600, 200, 8000);
    const height = dataInteger(scene.data, ["height"], 1000, 200, 8000);
    const gridSize = dataInteger(scene.data, ["gridSize"], 70, 10, 400);
    const gridRaw = dataText(scene.data, ["gridType", "grid"], "SQUARE").toUpperCase();
    const gridType = gridRaw === "HEX" || gridRaw === "NONE" ? gridRaw : "SQUARE";
    const bgColor = dataText(scene.data, ["bgColor", "backgroundColor"], "#1a1a2e").slice(0, 20);
    const showFog = dataBool(scene.data, ["showFog", "fog"]);
    const backgroundPath = dataText(scene.data, ["background", "backgroundPath", "map", "image"], "");
    const asset = backgroundPath.length === 0
      ? null
      : view.assets.find((item) => item.relativePath === backgroundPath || item.relativePath.endsWith(backgroundPath)) ?? null;

    const created = await prisma.scene.create({
      data: {
        roomId,
        name,
        description: dataText(scene.data, ["description", "summary", "notes"], "").slice(0, 2000) || null,
        narration: dataText(scene.data, ["narration", "readAloud", "text"], "").slice(0, 5000) || null,
        isActive: activeAssigned ? false : true,
        orderIndex: sceneIndex,
        map: {
          create: {
            name,
            width,
            height,
            gridSize,
            gridType: gridType as never,
            bgColor,
            showGrid: true,
            showFog,
            backgroundId: asset === null ? null : asset.assetId
          }
        }
      },
      select: { id: true }
    });
    if (activeAssigned === false) activeAssigned = true;
    sceneIndex += 1;
    createdSceneIds.push(created.id);
    sceneIdByKey.set(normalizeKey(scene.id), created.id);
    sceneIdByKey.set(normalizeKey(name), created.id);
  }

  if (structured.encounters.length > 0 && chapterIdByKey.size === 0) {
    const fallback = await prisma.moduleChapter.create({
      data: { moduleId, title: "导入章节", summary: "由团本结构化数据自动生成", orderIndex: 0 },
      select: { id: true }
    });
    chapterIdByKey.set("default", fallback.id);
  }

  let encounterCount = 0;
  for (const encounter of structured.encounters) {
    const title = dataText(encounter.data, ["name", "title"], encounter.title);
    const existing = await prisma.encounter.findFirst({ where: { roomId, title }, select: { id: true } });
    if (existing !== null) continue;
    const sceneRef = dataText(encounter.data, ["sceneId", "scene", "location", "sceneName"], "");
    const chapterRef = dataText(encounter.data, ["chapterId", "chapter", "chapterName"], "");
    const sceneId = sceneIdByKey.get(normalizeKey(sceneRef)) ?? null;
    const chapterId = chapterIdByKey.get(normalizeKey(chapterRef)) ?? chapterIdByKey.get("default") ?? Array.from(chapterIdByKey.values())[0] ?? null;
    if (chapterId === null) continue;
    const setup = typeof encounter.data.setup === "object" && encounter.data.setup !== null ? encounter.data.setup : {};
    await prisma.encounter.create({
      data: {
        chapterId,
        roomId,
        sceneId,
        title,
        trigger: dataText(encounter.data, ["trigger", "condition", "when"], "").slice(0, 500) || null,
        setup: setup as never,
        orderIndex: encounterCount
      }
    });
    encounterCount += 1;
  }

  revalidateScene(roomId);
  emitSceneUpdate(roomId, createdSceneIds[0] ?? null);
  redirect(scenesPath(roomId, "?saved=module-scenes&scenes=" + String(createdSceneIds.length) + "&encounters=" + String(encounterCount)));
}
