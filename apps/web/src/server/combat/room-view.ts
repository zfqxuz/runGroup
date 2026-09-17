import { prisma } from "@/server/db/prisma";

export interface ActiveCombatSummary {
  readonly id: string;
  readonly sceneId: string | null;
  readonly sceneName: string | null;
  readonly round: number;
  readonly participantCount: number;
  readonly startedAt: string;
}

/** 房间内所有进行中的战斗（同房间可多场），按开始时间排序。 */
export async function loadActiveCombatSummaries(roomId: string): Promise<ActiveCombatSummary[]> {
  const combats = await prisma.combat.findMany({
    where: { roomId, endedAt: null },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      sceneId: true,
      round: true,
      startedAt: true,
      _count: { select: { participants: true } }
    }
  });
  if (combats.length === 0) return [];
  const sceneIds = [...new Set(combats.map((combat) => combat.sceneId).filter((id): id is string => id !== null))];
  const scenes = sceneIds.length === 0
    ? []
    : await prisma.scene.findMany({ where: { id: { in: sceneIds } }, select: { id: true, name: true } });
  const sceneNameById = new Map(scenes.map((scene) => [scene.id, scene.name]));
  return combats.map((combat) => ({
    id: combat.id,
    sceneId: combat.sceneId,
    sceneName: combat.sceneId === null ? null : sceneNameById.get(combat.sceneId) ?? null,
    round: combat.round,
    participantCount: combat._count.participants,
    startedAt: combat.startedAt.toISOString()
  }));
}

/** 房间内所有进行中战斗的 id，用于批量清理 runtime 缓存 / 保存状态。 */
export async function loadActiveCombatIds(roomId: string): Promise<string[]> {
  const combats = await prisma.combat.findMany({
    where: { roomId, endedAt: null },
    orderBy: { startedAt: "asc" },
    select: { id: true }
  });
  return combats.map((combat) => combat.id);
}
