-- AlterEnum
ALTER TYPE "CardScope" ADD VALUE 'PRESET';

-- CreateTable
CREATE TABLE "CombatRequest" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "setup" JSONB NOT NULL DEFAULT '{}',
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CombatRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CombatRequest_roomId_status_idx" ON "CombatRequest"("roomId", "status");

-- AddForeignKey
ALTER TABLE "CombatRequest" ADD CONSTRAINT "CombatRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatRequest" ADD CONSTRAINT "CombatRequest_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

