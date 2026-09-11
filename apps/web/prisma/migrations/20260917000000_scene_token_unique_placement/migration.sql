-- 同一场景（map）里，一个角色 / NPC 卡只能有一个 Token。
-- 先清理历史重复数据，保留最早创建的那一条，再加唯一约束。
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "mapId", "characterId" ORDER BY "id" ASC) AS rn
  FROM "Token"
  WHERE "characterId" IS NOT NULL
)
DELETE FROM "Token" WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "mapId", "cardId" ORDER BY "id" ASC) AS rn
  FROM "Token"
  WHERE "cardId" IS NOT NULL
)
DELETE FROM "Token" WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX "Token_mapId_characterId_key" ON "Token"("mapId", "characterId");
CREATE UNIQUE INDEX "Token_mapId_cardId_key" ON "Token"("mapId", "cardId");
