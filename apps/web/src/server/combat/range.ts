import { gridDistanceFeet } from "@/shared/scene-geometry";
import { prisma } from "@/server/db/prisma";

export interface CombatDistanceResult {
  readonly feet: number;
  readonly gridType: string;
  readonly feetPerCell: number;
  readonly actorTokenId: string;
  readonly targetTokenId: string;
}

interface TokenRow {
  readonly id: string;
  readonly characterId: string | null;
  readonly cardId: string | null;
  readonly x: number;
  readonly y: number;
  readonly map: {
    readonly sceneId: string;
    readonly width: number;
    readonly height: number;
    readonly gridSize: number;
    readonly gridType: string;
  };
}

const DEFAULT_FEET_PER_CELL = 5;

function tokenEntityId(token: TokenRow): string | null {
  return token.characterId ?? token.cardId;
}

/**
 * 从战斗绑定的场景中读取双方 Token 坐标，换算成英尺距离。
 * 任意一方没有 Token、或不在同一张地图时返回 null，调用方回退到手动距离档。
 */
export async function loadCombatDistance(
  combatId: string,
  actorId: string,
  targetId: string
): Promise<CombatDistanceResult | null> {
  const combat = await prisma.combat.findUnique({
    where: { id: combatId },
    select: { roomId: true, sceneId: true }
  });
  if (combat === null || combat.sceneId === null) return null;

  const entityIds = [...new Set([actorId, targetId])];
  const tokens = await prisma.token.findMany({
    where: {
      roomId: combat.roomId,
      OR: [
        { characterId: { in: entityIds } },
        { cardId: { in: entityIds } }
      ]
    },
    select: {
      id: true,
      characterId: true,
      cardId: true,
      x: true,
      y: true,
      map: {
        select: {
          sceneId: true,
          width: true,
          height: true,
          gridSize: true,
          gridType: true
        }
      }
    }
  });

  const actorToken = tokens.find((token) => tokenEntityId(token) === actorId);
  const targetToken = tokens.find((token) => tokenEntityId(token) === targetId);
  if (actorToken === undefined || targetToken === undefined) return null;
  if (actorToken.map.sceneId !== combat.sceneId || targetToken.map.sceneId !== combat.sceneId) return null;
  if (actorToken.map.sceneId !== targetToken.map.sceneId) return null;

  const feet = gridDistanceFeet(
    { x: actorToken.x, y: actorToken.y },
    { x: targetToken.x, y: targetToken.y },
    {
      width: actorToken.map.width,
      height: actorToken.map.height,
      gridSize: actorToken.map.gridSize,
      gridType: actorToken.map.gridType
    },
    DEFAULT_FEET_PER_CELL
  );

  return {
    feet,
    gridType: actorToken.map.gridType,
    feetPerCell: DEFAULT_FEET_PER_CELL,
    actorTokenId: actorToken.id,
    targetTokenId: targetToken.id
  };
}
