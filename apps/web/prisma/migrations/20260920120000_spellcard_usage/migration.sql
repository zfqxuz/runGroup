-- 千幻抄：跨战斗记录符卡在某房间 / 章节内已经使用过。
CREATE TABLE "SpellcardUsage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "chapterId" TEXT,
    "usedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpellcardUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpellcardUsage_roomId_characterId_cardId_key" ON "SpellcardUsage"("roomId", "characterId", "cardId");

CREATE INDEX "SpellcardUsage_roomId_characterId_idx" ON "SpellcardUsage"("roomId", "characterId");
