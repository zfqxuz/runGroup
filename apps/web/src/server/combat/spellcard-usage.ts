import { prisma } from "@/server/db/prisma";

/** 千幻抄章节内符卡使用记录：`${characterId}:${cardId}`。 */
export async function loadUsedSpellcardKeys(
  roomId: string,
  characterIds: readonly string[]
): Promise<Set<string>> {
  const ids = [...new Set(characterIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return new Set();
  const rows = await prisma.spellcardUsage.findMany({
    where: { roomId, characterId: { in: ids } },
    select: { characterId: true, cardId: true }
  });
  return new Set(rows.map((row) => row.characterId + ":" + row.cardId));
}

/** 记录一张符卡在当前房间 / 章节内已使用；重复使用是幂等的。 */
export async function markSpellcardUsed(
  roomId: string,
  characterId: string,
  cardId: string,
  chapterId: string | null = null
): Promise<void> {
  if (characterId.length === 0 || cardId.length === 0) return;
  await prisma.spellcardUsage.upsert({
    where: { roomId_characterId_cardId: { roomId, characterId, cardId } },
    create: { roomId, characterId, cardId, chapterId },
    update: {}
  }).catch(() => undefined);
}
