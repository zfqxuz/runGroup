-- Token 归属房间 + 全房间唯一；共享战争视野
ALTER TABLE "Token" ADD COLUMN "roomId" TEXT;

UPDATE "Token" t
SET "roomId" = s."roomId"
FROM "Map" m
JOIN "Scene" s ON s.id = m."sceneId"
WHERE t."mapId" = m.id;

DO $$
DECLARE missing INTEGER;
BEGIN
  SELECT count(*) INTO missing FROM "Token" WHERE "roomId" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'Token migration aborted: % token(s) have no room', missing;
  END IF;
END $$;

-- 旧数据可能出现同一角色 / NPC 跨场景重复；保留 id 最小的一条，其余移动到当前场景前自动清理。
DELETE FROM "Token" t
USING "Token" d
WHERE t."roomId" = d."roomId"
  AND t."characterId" IS NOT NULL
  AND t."characterId" = d."characterId"
  AND t.id > d.id;

DELETE FROM "Token" t
USING "Token" d
WHERE t."roomId" = d."roomId"
  AND t."cardId" IS NOT NULL
  AND t."cardId" = d."cardId"
  AND t.id > d.id;

ALTER TABLE "Token" ALTER COLUMN "roomId" SET NOT NULL;

ALTER TABLE "Token" ADD CONSTRAINT "Token_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Token_roomId_idx" ON "Token"("roomId");
CREATE UNIQUE INDEX "Token_roomId_characterId_key" ON "Token"("roomId", "characterId");
CREATE UNIQUE INDEX "Token_roomId_cardId_key" ON "Token"("roomId", "cardId");

CREATE TABLE "RoomVisionShare" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomVisionShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomVisionShare_roomId_userId_targetUserId_key"
  ON "RoomVisionShare"("roomId", "userId", "targetUserId");
CREATE INDEX "RoomVisionShare_roomId_idx" ON "RoomVisionShare"("roomId");
CREATE INDEX "RoomVisionShare_targetUserId_idx" ON "RoomVisionShare"("targetUserId");

ALTER TABLE "RoomVisionShare" ADD CONSTRAINT "RoomVisionShare_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomVisionShare" ADD CONSTRAINT "RoomVisionShare_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomVisionShare" ADD CONSTRAINT "RoomVisionShare_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
