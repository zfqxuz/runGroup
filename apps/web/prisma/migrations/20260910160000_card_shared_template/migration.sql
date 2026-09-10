-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "isTemplate" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Card_scope_isTemplate_idx" ON "Card"("scope", "isTemplate");
