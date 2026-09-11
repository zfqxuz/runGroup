import { getSocketServer } from "@/server/socket/io";
import type { SceneMapView, SceneTokenView } from "@/shared/scene";

export type BroadcastRoomStatus = "LOBBY" | "PLAYING" | "PAUSED" | "COMBAT" | "ENDED";

function roomChannel(roomId: string): string {
  return "room:" + roomId;
}

function combatChannel(combatId: string): string {
  return "combat:" + combatId;
}

export function emitRoomUpdate(roomId: string, status: BroadcastRoomStatus): void {
  getSocketServer()?.to(roomChannel(roomId)).emit("room:update", { roomId, status });
}

export function emitCombatStarted(roomId: string, combatId: string): void {
  const io = getSocketServer();
  if (io === null) return;
  io.to(roomChannel(roomId)).emit("combat:started", { roomId, combatId });
  emitRoomUpdate(roomId, "COMBAT");
}

export function emitCombatEnded(roomId: string, combatId: string): void {
  const io = getSocketServer();
  if (io === null) return;
  io.to(roomChannel(roomId)).emit("combat:ended", { roomId, combatId });
  io.to(combatChannel(combatId)).emit("combat:ended", { roomId, combatId });
  emitRoomUpdate(roomId, "PLAYING");
}

export function emitSceneUpdate(roomId: string, sceneId: string | null): void {
  getSocketServer()?.to(roomChannel(roomId)).emit("scene:updated", { roomId, sceneId });
}

export function emitSceneTokenUpdate(roomId: string, token: SceneTokenView): void {
  getSocketServer()?.to(roomChannel(roomId)).emit("scene:token:updated", { roomId, token });
}

export function emitAdvancementUpdate(roomId: string, gameId: string, characterId: string | null): void {
  getSocketServer()?.to(roomChannel(roomId)).emit("room:advancement:update", {
    roomId,
    gameId,
    characterId
  });
}

export function emitSceneMapUpdate(roomId: string, sceneId: string, map: SceneMapView): void {
  getSocketServer()?.to(roomChannel(roomId)).emit("scene:map:updated", { roomId, sceneId, map });
}

export function emitSceneFogUpdate(roomId: string, sceneId: string, fogRevealed: readonly string[]): void {
  getSocketServer()?.to(roomChannel(roomId)).emit("scene:fog:updated", { roomId, sceneId, fogRevealed });
}
