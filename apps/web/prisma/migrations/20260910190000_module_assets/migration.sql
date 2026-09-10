-- AlterTable
ALTER TABLE "Module" ADD COLUMN     "slug" TEXT,
ADD COLUMN     "system" TEXT,
ADD COLUMN     "era" TEXT,
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'NATIVE',
ADD COLUMN     "originalFilename" TEXT,
ADD COLUMN     "packagePath" TEXT,
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "importReport" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "ModuleAsset" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "originalName" TEXT,
    "kind" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModuleAsset_moduleId_relativePath_key" ON "ModuleAsset"("moduleId", "relativePath");

-- CreateIndex
CREATE INDEX "ModuleAsset_moduleId_kind_idx" ON "ModuleAsset"("moduleId", "kind");

-- CreateIndex
CREATE INDEX "Module_roomId_slug_idx" ON "Module"("roomId", "slug");

-- AddForeignKey
ALTER TABLE "ModuleAsset" ADD CONSTRAINT "ModuleAsset_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleAsset" ADD CONSTRAINT "ModuleAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
