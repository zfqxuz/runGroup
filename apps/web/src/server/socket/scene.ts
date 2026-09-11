import type { Server as SocketServer, Socket } from "socket.io";
import { prisma } from "@/server/db/prisma";
import { loadSceneTokenView } from "@/server/scene/load";
import type { Ack } from "@/shared/socket";

const roomChannel = (roomId: string): string => "room:" + roomId;

function userIdOf(socket: Socket): string | null {
  const id = (socket.data as { userId?: unknown }).userId;
  return typeof id === "string" ? id : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function registerSceneHandlers(io: SocketServer, socket: Socket): void {
  socket.on("scene:token:move", async (payload: unknown, ack: (result: Ack) => void) => {
    const userId = userIdOf(socket);
    const input = (payload ?? {}) as { roomId?: unknown; tokenId?: unknown; x?: unknown; y?: unknown };
    if (userId === null || typeof input.roomId !== "string" || typeof input.tokenId !== "string") {
      ack({ ok: false, error: "参数不合法" });
      return;
    }
    const x = asNumber(input.x);
    const y = asNumber(input.y);
    if (x === null || y === null) {
      ack({ ok: false, error: "坐标不合法" });
      return;
    }

    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: input.roomId, userId } },
      select: { role: true, room: { select: { status: true } } }
    });
    if (membership === null) {
      ack({ ok: false, error: "你不在这个房间里" });
      return;
    }
    if (membership.room.status === "LOBBY" || membership.room.status === "PAUSED" || membership.room.status === "ENDED") {
      ack({ ok: false, error: "当前阶段不能移动地图 Token" });
      return;
    }

    const token = await prisma.token.findUnique({
      where: { id: input.tokenId },
      include: {
        map: { select: { width: true, height: true, scene: { select: { roomId: true } } } },
        character: { select: { userId: true } }
      }
    });
    if (token === null || token.map.scene.roomId !== input.roomId) {
      ack({ ok: false, error: "Token 不存在" });
      return;
    }

    const canMove = membership.role === "KP" || (token.character !== null && token.character.userId === userId);
    if (canMove === false) {
      ack({ ok: false, error: "你不能移动这个 Token" });
      return;
    }

    await prisma.token.update({
      where: { id: token.id },
      data: {
        x: Math.max(0, Math.min(token.map.width, x)),
        y: Math.max(0, Math.min(token.map.height, y))
      }
    });
    const updated = await loadSceneTokenView(token.id);
    if (updated !== null) {
      io.to(roomChannel(input.roomId)).emit("scene:token:updated", { roomId: input.roomId, token: updated.token });
    }
    ack({ ok: true });
  });
}
