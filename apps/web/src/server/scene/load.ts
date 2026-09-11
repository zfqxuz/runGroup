import { prisma } from "@/server/db/prisma";
import type { SceneTokenView, SceneView } from "@/shared/scene";
import { sceneInclude, sceneView, tokenInclude, tokenView, type SceneHpMap } from "./view";

async function loadHpMap(roomId: string): Promise<SceneHpMap> {
  const game = await prisma.game.findFirst({
    where: { roomId, status: { in: ["PLAYING", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (game === null) return new Map();
  const rows = await prisma.gameCharacter.findMany({
    where: { gameId: game.id },
    select: { characterId: true, currentHp: true, character: { select: { maxHp: true } } }
  });
  const map = new Map<string, { currentHp: number; maxHp: number }>();
  for (const row of rows) {
    map.set(row.characterId, { currentHp: row.currentHp, maxHp: row.character.maxHp });
  }
  return map;
}

export async function loadSceneView(roomId: string, sceneId?: string): Promise<SceneView | null> {
  const scene = await prisma.scene.findFirst({
    where: sceneId === undefined ? { roomId, isActive: true } : { id: sceneId, roomId },
    include: sceneInclude
  });
  if (scene === null) return null;
  const hpByCharacter = await loadHpMap(roomId);
  return sceneView(scene, hpByCharacter);
}

export async function loadSceneTokenView(tokenId: string): Promise<{ roomId: string; token: SceneTokenView } | null> {
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: {
      ...tokenInclude,
      map: { select: { scene: { select: { roomId: true } } } }
    }
  });
  if (token === null) return null;
  const hpByCharacter = await loadHpMap(token.map.scene.roomId);
  return { roomId: token.map.scene.roomId, token: tokenView(token, hpByCharacter) };
}
