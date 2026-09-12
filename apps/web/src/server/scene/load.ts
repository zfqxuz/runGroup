import { prisma } from "@/server/db/prisma";
import type { SceneMapView, SceneTokenView, SceneView } from "@/shared/scene";
import { cellKeyAt } from "@/shared/scene-geometry";
import { visionCellKeysForPoints } from "@/shared/scene-vision";
import { sceneInclude, sceneView, tokenInclude, tokenView, type SceneHpMap } from "./view";

export interface SceneViewer {
  readonly userId: string;
  readonly isKP: boolean;
}

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

export async function loadSceneView(
  roomId: string,
  sceneId?: string,
  viewer?: SceneViewer
): Promise<SceneView | null> {
  const scene = await prisma.scene.findFirst({
    where: sceneId === undefined ? { roomId, isActive: true } : { id: sceneId, roomId },
    include: sceneInclude
  });
  if (scene === null) return null;
  const hpByCharacter = await loadHpMap(roomId);
  const view = sceneView(scene, hpByCharacter);
  if (viewer === undefined || viewer.isKP || view.map === null || view.map.showFog === false) return view;

  const shares = await prisma.roomVisionShare.findMany({
    where: {
      roomId,
      OR: [{ userId: viewer.userId }, { targetUserId: viewer.userId }]
    },
    select: { userId: true, targetUserId: true }
  });
  const sharedOwners = new Set<string>([viewer.userId]);
  for (const share of shares) {
    sharedOwners.add(share.userId === viewer.userId ? share.targetUserId : share.userId);
  }
  const points = view.map.tokens
    .filter((token) => typeof token.ownerUserId === "string" && sharedOwners.has(token.ownerUserId))
    .filter((token) => token.isVisible)
    .map((token) => ({ x: token.x, y: token.y }));
  const revealed = visionCellKeysForPoints(view.map, points);
  const visibleTokens = view.map.tokens.filter((token) => revealed.has(cellKeyAt(view.map as SceneMapView, token.x, token.y)));
  return { ...view, map: { ...view.map, tokens: visibleTokens } };
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

export async function loadSceneMapView(
  roomId: string,
  sceneId: string
): Promise<{ readonly roomId: string; readonly sceneId: string; readonly map: SceneMapView } | null> {
  const scene = await prisma.scene.findFirst({
    where: { id: sceneId, roomId },
    include: sceneInclude
  });
  if (scene === null) return null;
  const hpByCharacter = await loadHpMap(roomId);
  const view = sceneView(scene, hpByCharacter);
  if (view.map === null) return null;
  return { roomId, sceneId, map: view.map };
}
