import { prisma } from "@/server/db/prisma";
import type { RoomMemberView } from "@/shared/socket";

const ATTRIBUTE_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;

function skillEntries(raw: unknown): { id: string; value: number | null }[] {
  const source = raw !== null && typeof raw === "object" && Array.isArray(raw) === false ? (raw as Record<string, unknown>) : {};
  return Object.entries(source)
    .map(([id, value]) => ({ id, value: typeof value === "number" && Number.isFinite(value) ? value : 0 }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
}

/**
 * 读取房间成员列表，并按当前查看者计算角色数值是否可见。
 *
 * 规则：
 * - KP 永远可见；
 * - 本人永远可见；
 * - 房间默认 PUBLIC 时全员可见；
 * - 房间 PRIVATE 时，成员主动 `statsPublic` 才向其他人公开精确数值；
 * - 不可见时不下发真实数值，只保留头像 / 立绘 / 姓名等非数值信息。
 */
export async function loadRoomMemberViews(params: {
  readonly roomId: string;
  readonly viewerUserId: string;
  readonly isKP: boolean;
  readonly roomVisibility: string;
}): Promise<RoomMemberView[]> {
  const members = await prisma.roomMember.findMany({
    where: { roomId: params.roomId },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      activeCharacter: {
        select: {
          id: true,
          name: true,
          occupation: true,
          hp: true,
          maxHp: true,
          mp: true,
          maxMp: true,
          san: true,
          maxSan: true,
          str: true,
          con: true,
          siz: true,
          dex: true,
          app: true,
          int: true,
          pow: true,
          edu: true,
          luck: true,
          skills: true,
          portrait: { select: { url: true, thumbnailUrl: true } },
          avatar: { select: { url: true, thumbnailUrl: true } }
        }
      }
    },
    orderBy: { joinedAt: "asc" }
  });

  return members.map((member) => {
    const character = member.activeCharacter;
    const characterIsMine = member.userId === params.viewerUserId;
    const visible =
      params.isKP ||
      characterIsMine ||
      params.roomVisibility !== "PRIVATE" ||
      member.statsPublic;
    const skills = character === null ? [] : skillEntries(character.skills);
    return {
      userId: member.userId,
      username: member.user.username,
      displayName: member.user.displayName ?? member.user.username,
      role: member.role as RoomMemberView["role"],
      avatarUrl: member.user.avatarUrl,
      character:
        character === null
          ? null
          : {
              id: character.id,
              name: character.name,
              occupation: character.occupation,
              portraitUrl: character.portrait?.url ?? character.avatar?.url ?? null,
              statsHidden: visible === false,
              statsPublic: member.statsPublic,
              hp: visible ? character.hp : null,
              maxHp: visible ? character.maxHp : null,
              mp: visible ? character.mp : null,
              maxMp: visible ? character.maxMp : null,
              san: visible ? character.san : null,
              maxSan: visible ? character.maxSan : null,
              attributes: Object.fromEntries(
                ATTRIBUTE_KEYS.map((key) => [key, visible ? character[key] : null])
              ),
              skills: visible
                ? skills
                : skills.map((entry) => ({ id: entry.id, value: null }))
            }
    } satisfies RoomMemberView;
  });
}
