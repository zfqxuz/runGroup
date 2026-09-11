"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { emitSceneTokenUpdate, emitSceneUpdate } from "@/server/realtime";
import { loadSceneTokenView } from "@/server/scene/load";

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
    include: { map: { select: { id: true, width: true, height: true } } }
  });
  if (scene === null || scene.roomId !== roomId) redirect(scenesPath(roomId, "?error=scene"));

  let map = scene.map;
  if (map === null) {
    map = await prisma.map.create({
      data: { sceneId, name: scene.name, width: 1600, height: 1000, gridSize: 70, bgColor: "#1a1a2e", showGrid: true, showFog: false },
      select: { id: true, width: true, height: true }
    });
  }

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
  await prisma.token.create({
    data: {
      mapId: map.id,
      characterId,
      name,
      x: map.width / 2,
      y: map.height / 2,
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
