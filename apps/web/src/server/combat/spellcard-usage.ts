import { prisma } from "@/server/db/prisma";

/** 房间当前章节：取最新进行中的游戏状态；没有游戏 / 未选章节时返回 null。 */
export async function currentChapterIdOfRoom(roomId: string): Promise<string | null> {
  const game = await prisma.game.findFirst({
    where: { roomId, status: { in: ["PLAYING", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    select: { state: { select: { currentChapterId: true } } }
  });
  return game?.state?.currentChapterId ?? null;
}

/**
 * 千幻抄章节内符卡使用记录：`${characterId}:${cardId}`。
 *
 * 传入 chapterId 时只统计「本章节 + 房间级旧记录」；不传时按房间统计全部（旧行为）。
 */
export async function loadUsedSpellcardKeys(
  roomId: string,
  characterIds: readonly string[],
  chapterId: string | null = null
): Promise<Set<string>> {
  const ids = [...new Set(characterIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return new Set();
  const rows = await prisma.spellcardUsage.findMany({
    where: {
      roomId,
      characterId: { in: ids },
      ...(chapterId === null || chapterId.length === 0
        ? {}
        : { chapterKey: { in: [chapterId, ""] } })
    },
    select: { characterId: true, cardId: true }
  });
  return new Set(rows.map((row) => row.characterId + ":" + row.cardId));
}

/** 记录一张符卡在当前房间 / 章节内已使用；同一章节重复记录是幂等的。 */
export async function markSpellcardUsed(
  roomId: string,
  characterId: string,
  cardId: string,
  chapterId: string | null = null
): Promise<void> {
  if (characterId.length === 0 || cardId.length === 0) return;
  const chapterKey = chapterId ?? "";
  await prisma.spellcardUsage.upsert({
    where: {
      roomId_chapterKey_characterId_cardId: { roomId, chapterKey, characterId, cardId }
    },
    create: { roomId, characterId, cardId, chapterId, chapterKey },
    update: {}
  }).catch(() => undefined);
}
