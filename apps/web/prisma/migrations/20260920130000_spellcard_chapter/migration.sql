-- 千幻抄：符卡使用记录按「章节」分组，不同章节可各使用一次同一张符卡。
ALTER TABLE "SpellcardUsage" ADD COLUMN "chapterKey" TEXT NOT NULL DEFAULT '';

-- 兼容旧数据：原来的 chapterId（含 null）回填到 chapterKey。
UPDATE "SpellcardUsage" SET "chapterKey" = COALESCE("chapterId", '');

DROP INDEX "SpellcardUsage_roomId_characterId_cardId_key";
DROP INDEX "SpellcardUsage_roomId_characterId_idx";

CREATE UNIQUE INDEX "SpellcardUsage_roomId_chapterKey_characterId_cardId_key"
  ON "SpellcardUsage"("roomId", "chapterKey", "characterId", "cardId");

CREATE INDEX "SpellcardUsage_roomId_chapterKey_characterId_idx"
  ON "SpellcardUsage"("roomId", "chapterKey", "characterId");
