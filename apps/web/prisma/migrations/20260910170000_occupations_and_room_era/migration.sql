-- CreateTable
CREATE TABLE "Occupation" (
    "id" TEXT NOT NULL,
    "system" "System" NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "era" TEXT NOT NULL DEFAULT 'BOTH',
    "creditMin" INTEGER,
    "creditMax" INTEGER,
    "creditText" TEXT,
    "pointsText" TEXT,
    "pointsFormula" TEXT NOT NULL,
    "skillsText" TEXT NOT NULL,
    "skillNames" JSONB NOT NULL DEFAULT '[]',
    "relations" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Occupation_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Room" ADD COLUMN "era" TEXT;

-- AlterTable
ALTER TABLE "Character" ADD COLUMN "occupationId" TEXT,
ADD COLUMN "era" TEXT,
ADD COLUMN "skillAllocation" JSONB,
ADD COLUMN "sourceData" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Occupation_system_code_key" ON "Occupation"("system", "code");

-- CreateIndex
CREATE INDEX "Occupation_system_era_idx" ON "Occupation"("system", "era");

-- CreateIndex
CREATE INDEX "Character_occupationId_idx" ON "Character"("occupationId");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_occupationId_fkey" FOREIGN KEY ("occupationId") REFERENCES "Occupation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
