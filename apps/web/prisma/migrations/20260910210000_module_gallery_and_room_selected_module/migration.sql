-- AlterTable
ALTER TABLE "Module"
ADD COLUMN "ownerId" TEXT,
ADD COLUMN "background" TEXT,
ADD COLUMN "occupationRecommendation" TEXT,
ADD COLUMN "publishedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Room"
ADD COLUMN "selectedModuleId" TEXT;

-- Backfill owner from the room owner for existing room-scoped modules.
UPDATE "Module"
SET "ownerId" = "Room"."ownerId"
FROM "Room"
WHERE "Module"."roomId" = "Room"."id"
  AND "Module"."ownerId" IS NULL;

-- CreateIndex
CREATE INDEX "Module_ownerId_isPublished_idx" ON "Module"("ownerId", "isPublished");

-- CreateIndex
CREATE INDEX "Module_isPublished_publishedAt_idx" ON "Module"("isPublished", "publishedAt");

-- CreateIndex
CREATE INDEX "Room_selectedModuleId_idx" ON "Room"("selectedModuleId");

-- AddForeignKey
ALTER TABLE "Module"
ADD CONSTRAINT "Module_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room"
ADD CONSTRAINT "Room_selectedModuleId_fkey"
FOREIGN KEY ("selectedModuleId") REFERENCES "Module"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
