-- CreateTable
CREATE TABLE "RoomCharacterEntry" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "comment" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RoomCharacterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomCardEntry" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "comment" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RoomCardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomCharacterEntry_roomId_status_idx" ON "RoomCharacterEntry"("roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoomCharacterEntry_roomId_characterId_key" ON "RoomCharacterEntry"("roomId", "characterId");

-- CreateIndex
CREATE INDEX "RoomCardEntry_roomId_status_idx" ON "RoomCardEntry"("roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoomCardEntry_roomId_cardId_key" ON "RoomCardEntry"("roomId", "cardId");

-- AddForeignKey
ALTER TABLE "RoomCharacterEntry" ADD CONSTRAINT "RoomCharacterEntry_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomCharacterEntry" ADD CONSTRAINT "RoomCharacterEntry_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomCardEntry" ADD CONSTRAINT "RoomCardEntry_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomCardEntry" ADD CONSTRAINT "RoomCardEntry_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

