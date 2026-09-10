-- AlterEnum
ALTER TYPE "RoomStatus" ADD VALUE 'PAUSED';

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "moduleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PREPARING',
    "title" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameState" (
    "gameId" TEXT NOT NULL,
    "moduleId" TEXT,
    "moduleVersion" TEXT,
    "currentChapterId" TEXT,
    "currentSceneId" TEXT,
    "currentEncounterId" TEXT,
    "gameTime" TEXT,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "flags" JSONB NOT NULL DEFAULT '{}',
    "counters" JSONB NOT NULL DEFAULT '{}',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GameState_pkey" PRIMARY KEY ("gameId")
);

-- CreateTable
CREATE TABLE "GameCharacter" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ALIVE',
    "currentHp" INTEGER NOT NULL,
    "currentMp" INTEGER NOT NULL,
    "currentSan" INTEGER NOT NULL,
    "currentDp" INTEGER NOT NULL DEFAULT 0,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "state" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GameCharacter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterAdvancement" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "gameId" TEXT,
    "kind" TEXT NOT NULL,
    "target" TEXT,
    "delta" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterAdvancement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Game_roomId_status_idx" ON "Game"("roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GameCharacter_gameId_characterId_key" ON "GameCharacter"("gameId", "characterId");

-- CreateIndex
CREATE INDEX "GameCharacter_userId_idx" ON "GameCharacter"("userId");

-- CreateIndex
CREATE INDEX "CharacterAdvancement_characterId_createdAt_idx" ON "CharacterAdvancement"("characterId", "createdAt");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameState" ADD CONSTRAINT "GameState_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameCharacter" ADD CONSTRAINT "GameCharacter_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameCharacter" ADD CONSTRAINT "GameCharacter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterAdvancement" ADD CONSTRAINT "CharacterAdvancement_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterAdvancement" ADD CONSTRAINT "CharacterAdvancement_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
