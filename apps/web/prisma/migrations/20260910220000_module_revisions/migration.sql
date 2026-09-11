-- 开局团本快照。Game 指向快照；快照资产引用用于进行中局的资源保护。

-- AlterTable
ALTER TABLE "Game" ADD COLUMN "moduleRevisionId" TEXT;

-- CreateTable
CREATE TABLE "ModuleRevision" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "system" TEXT,
    "era" TEXT,
    "background" TEXT,
    "occupationRecommendation" TEXT,
    "synopsis" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "content" JSONB NOT NULL DEFAULT '{}',
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleRevisionAsset" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "assetId" TEXT,
    "relativePath" TEXT NOT NULL,
    "originalName" TEXT,
    "kind" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,

    CONSTRAINT "ModuleRevisionAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Game_moduleRevisionId_idx" ON "Game"("moduleRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleRevision_moduleId_contentHash_key" ON "ModuleRevision"("moduleId", "contentHash");

-- CreateIndex
CREATE INDEX "ModuleRevision_moduleId_createdAt_idx" ON "ModuleRevision"("moduleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleRevisionAsset_revisionId_relativePath_key" ON "ModuleRevisionAsset"("revisionId", "relativePath");

-- CreateIndex
CREATE INDEX "ModuleRevisionAsset_assetId_idx" ON "ModuleRevisionAsset"("assetId");

-- CreateIndex
CREATE INDEX "ModuleRevisionAsset_revisionId_orderIndex_idx" ON "ModuleRevisionAsset"("revisionId", "orderIndex");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_moduleRevisionId_fkey" FOREIGN KEY ("moduleRevisionId") REFERENCES "ModuleRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleRevision" ADD CONSTRAINT "ModuleRevision_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleRevisionAsset" ADD CONSTRAINT "ModuleRevisionAsset_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ModuleRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleRevisionAsset" ADD CONSTRAINT "ModuleRevisionAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
