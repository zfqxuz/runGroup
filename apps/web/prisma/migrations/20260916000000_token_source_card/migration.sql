-- Token 不再单独上传图片；NPC Token 关联来源卡，渲染时自动取角色卡 / NPC 卡图片。

-- AlterTable
ALTER TABLE "Token" ADD COLUMN "cardId" TEXT;

-- CreateIndex
CREATE INDEX "Token_cardId_idx" ON "Token"("cardId");

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
