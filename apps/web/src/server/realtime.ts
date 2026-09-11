import { getSocketServer } from "@/server/socket/io";

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
