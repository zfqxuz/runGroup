-- 成长记录来源标注、编辑 / 撤销状态，以及 CoC 幕间成长检定。

-- AlterTable
ALTER TABLE "CharacterAdvancement"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "editedAt" TIMESTAMPTZ(3),
  ADD COLUMN "revertedAt" TIMESTAMPTZ(3),
  ADD COLUMN "revertedBy" TEXT;

-- CreateTable
CREATE TABLE "GrowthCheck" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "skillName" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "beforeValue" INTEGER NOT NULL,
    "roll" INTEGER,
    "gain" INTEGER,
    "note" TEXT,
    "createdBy" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "advancementId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GrowthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CharacterAdvancement_characterId_revertedAt_idx" ON "CharacterAdvancement"("characterId", "revertedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthCheck_gameId_characterId_skillId_key" ON "GrowthCheck"("gameId", "characterId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthCheck_advancementId_key" ON "GrowthCheck"("advancementId");

-- CreateIndex
CREATE INDEX "GrowthCheck_gameId_state_idx" ON "GrowthCheck"("gameId", "state");

-- CreateIndex
CREATE INDEX "GrowthCheck_characterId_createdAt_idx" ON "GrowthCheck"("characterId", "createdAt");

-- AddForeignKey
ALTER TABLE "GrowthCheck" ADD CONSTRAINT "GrowthCheck_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthCheck" ADD CONSTRAINT "GrowthCheck_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
