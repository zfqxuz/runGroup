-- 同房间多场战斗：每场战斗绑定一个场景，便于独立 tab 与场景隔离。
ALTER TABLE "Combat" ADD COLUMN "sceneId" TEXT;
CREATE INDEX "Combat_roomId_sceneId_idx" ON "Combat"("roomId", "sceneId");
