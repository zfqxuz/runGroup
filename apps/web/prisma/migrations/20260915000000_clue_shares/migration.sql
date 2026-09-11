-- KP 定向分享线索给指定成员。

-- CreateTable
CREATE TABLE "ClueShare" (
    "clueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sharedBy" TEXT,
    "sharedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClueShare_pkey" PRIMARY KEY ("clueId", "userId")
);

-- CreateIndex
CREATE INDEX "ClueShare_userId_idx" ON "ClueShare"("userId");

-- AddForeignKey
ALTER TABLE "ClueShare" ADD CONSTRAINT "ClueShare_clueId_fkey" FOREIGN KEY ("clueId") REFERENCES "Clue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClueShare" ADD CONSTRAINT "ClueShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
