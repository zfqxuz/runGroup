-- 团本只读模板表、房间级章节实例、应用预设批次
CREATE TYPE "ItemTemplateType" AS ENUM ('WEAPON', 'ITEM', 'TOME', 'ARTIFACT', 'EVIDENCE');
ALTER TYPE "CardType" ADD VALUE 'CLUE';

ALTER TABLE "Encounter" ALTER COLUMN "chapterId" DROP NOT NULL;
ALTER TABLE "Encounter" ADD COLUMN "roomChapterId" TEXT;

CREATE TABLE "ChapterTemplate" (
  "id" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChapterTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SceneTemplate" (
  "id" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "narration" TEXT,
  "weather" TEXT NOT NULL DEFAULT 'NONE',
  "timeOfDay" TEXT NOT NULL DEFAULT 'DAY',
  "width" INTEGER NOT NULL DEFAULT 1600,
  "height" INTEGER NOT NULL DEFAULT 1000,
  "gridSize" INTEGER NOT NULL DEFAULT 70,
  "gridType" "GridType" NOT NULL DEFAULT 'SQUARE',
  "bgColor" TEXT NOT NULL DEFAULT '#1a1a2e',
  "showGrid" BOOLEAN NOT NULL DEFAULT true,
  "showFog" BOOLEAN NOT NULL DEFAULT false,
  "backgroundPath" TEXT,
  "bgMusicPath" TEXT,
  "ambientPath" TEXT,
  "layers" JSONB NOT NULL DEFAULT '[]',
  "tokens" JSONB NOT NULL DEFAULT '[]',
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SceneTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NpcTemplate" (
  "id" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subtitle" TEXT,
  "description" TEXT,
  "tier" TEXT NOT NULL DEFAULT 'STANDARD',
  "rarity" TEXT NOT NULL DEFAULT 'COMMON',
  "race" TEXT,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "skills" JSONB NOT NULL DEFAULT '{}',
  "maxHp" INTEGER NOT NULL DEFAULT 10,
  "maxMp" INTEGER NOT NULL DEFAULT 0,
  "maxSan" INTEGER NOT NULL DEFAULT 0,
  "maxDp" INTEGER NOT NULL DEFAULT 0,
  "portraitPath" TEXT,
  "tokenPath" TEXT,
  "isPublicDefault" BOOLEAN NOT NULL DEFAULT false,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NpcTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ItemTemplate" (
  "id" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "itemType" "ItemTemplateType" NOT NULL DEFAULT 'ITEM',
  "description" TEXT,
  "rarity" TEXT NOT NULL DEFAULT 'COMMON',
  "imagePath" TEXT,
  "stats" JSONB NOT NULL DEFAULT '{}',
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ItemTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClueTemplate" (
  "id" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "imagePath" TEXT,
  "linkedItemKey" TEXT,
  "isPublicDefault" BOOLEAN NOT NULL DEFAULT false,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClueTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EncounterTemplate" (
  "id" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "chapterKey" TEXT,
  "sceneKey" TEXT,
  "trigger" TEXT,
  "setup" JSONB NOT NULL DEFAULT '{}',
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EncounterTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MagicTemplate" (
  "id" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "skill" TEXT NOT NULL DEFAULT 'OCCULT',
  "description" TEXT,
  "mpCost" TEXT NOT NULL DEFAULT '0',
  "sanCost" TEXT NOT NULL DEFAULT '0',
  "damage" TEXT,
  "target" TEXT NOT NULL DEFAULT 'ONE',
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MagicTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoomChapter" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "sourceTemplateId" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomChapter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoomPresetApplication" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "moduleRevisionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "appliedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "replacedAt" TIMESTAMPTZ(3),
  CONSTRAINT "RoomPresetApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoomPresetInstance" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "templateType" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomPresetInstance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChapterTemplate_moduleId_sourceKey_key" ON "ChapterTemplate"("moduleId", "sourceKey");
CREATE INDEX "ChapterTemplate_moduleId_orderIndex_idx" ON "ChapterTemplate"("moduleId", "orderIndex");
CREATE UNIQUE INDEX "SceneTemplate_moduleId_sourceKey_key" ON "SceneTemplate"("moduleId", "sourceKey");
CREATE INDEX "SceneTemplate_moduleId_orderIndex_idx" ON "SceneTemplate"("moduleId", "orderIndex");
CREATE UNIQUE INDEX "NpcTemplate_moduleId_sourceKey_key" ON "NpcTemplate"("moduleId", "sourceKey");
CREATE INDEX "NpcTemplate_moduleId_orderIndex_idx" ON "NpcTemplate"("moduleId", "orderIndex");
CREATE UNIQUE INDEX "ItemTemplate_moduleId_sourceKey_key" ON "ItemTemplate"("moduleId", "sourceKey");
CREATE INDEX "ItemTemplate_moduleId_orderIndex_idx" ON "ItemTemplate"("moduleId", "orderIndex");
CREATE UNIQUE INDEX "ClueTemplate_moduleId_sourceKey_key" ON "ClueTemplate"("moduleId", "sourceKey");
CREATE INDEX "ClueTemplate_moduleId_orderIndex_idx" ON "ClueTemplate"("moduleId", "orderIndex");
CREATE UNIQUE INDEX "EncounterTemplate_moduleId_sourceKey_key" ON "EncounterTemplate"("moduleId", "sourceKey");
CREATE INDEX "EncounterTemplate_moduleId_orderIndex_idx" ON "EncounterTemplate"("moduleId", "orderIndex");
CREATE UNIQUE INDEX "MagicTemplate_moduleId_sourceKey_key" ON "MagicTemplate"("moduleId", "sourceKey");
CREATE INDEX "MagicTemplate_moduleId_orderIndex_idx" ON "MagicTemplate"("moduleId", "orderIndex");
CREATE INDEX "RoomChapter_roomId_orderIndex_idx" ON "RoomChapter"("roomId", "orderIndex");
CREATE INDEX "RoomPresetApplication_roomId_status_idx" ON "RoomPresetApplication"("roomId", "status");
CREATE INDEX "RoomPresetApplication_moduleId_idx" ON "RoomPresetApplication"("moduleId");
CREATE INDEX "RoomPresetInstance_applicationId_idx" ON "RoomPresetInstance"("applicationId");
CREATE INDEX "RoomPresetInstance_templateType_entityId_idx" ON "RoomPresetInstance"("templateType", "entityId");
CREATE INDEX "Encounter_roomChapterId_orderIndex_idx" ON "Encounter"("roomChapterId", "orderIndex");

ALTER TABLE "ChapterTemplate" ADD CONSTRAINT "ChapterTemplate_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SceneTemplate" ADD CONSTRAINT "SceneTemplate_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NpcTemplate" ADD CONSTRAINT "NpcTemplate_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemTemplate" ADD CONSTRAINT "ItemTemplate_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClueTemplate" ADD CONSTRAINT "ClueTemplate_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EncounterTemplate" ADD CONSTRAINT "EncounterTemplate_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MagicTemplate" ADD CONSTRAINT "MagicTemplate_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomChapter" ADD CONSTRAINT "RoomChapter_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomPresetApplication" ADD CONSTRAINT "RoomPresetApplication_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomPresetApplication" ADD CONSTRAINT "RoomPresetApplication_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomPresetInstance" ADD CONSTRAINT "RoomPresetInstance_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RoomPresetApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_roomChapterId_fkey" FOREIGN KEY ("roomChapterId") REFERENCES "RoomChapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
