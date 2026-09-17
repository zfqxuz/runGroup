import { prisma } from "@/server/db/prisma";

export type SceneLockAction = "delete" | "switch";

export function lockedSceneMessage(action: SceneLockAction): string {
  return action === "delete"
    ? "该场景正在被进行中的战斗使用，请先结束全部相关战斗再删除"
    : "当前激活场景正在被进行中的战斗使用，请先结束战斗再切换场景";
}

/** 该场景是否绑定着未结束的战斗；用于删除 / 切换激活场景时加锁。 */
export async function sceneHasActiveCombat(sceneId: string): Promise<boolean> {
  const count = await prisma.combat.count({ where: { sceneId, endedAt: null } });
  return count > 0;
}
