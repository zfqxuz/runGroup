import type { Server as SocketServer, Socket } from "socket.io";
import { prisma } from "@/server/db/prisma";
import { emitSceneFogUpdate, emitSceneMapUpdate } from "@/server/realtime";
import { loadSceneMapView, loadSceneTokenView, loadSceneView } from "@/server/scene/load";
import { findFreeTokenPosition } from "@/server/scene/placement";
import type { Ack } from "@/shared/socket";

const roomChannel = (roomId: string): string => "room:" + roomId;
const userChannel = (userId: string): string => "user:" + userId;

function userIdOf(socket: Socket): string | null {
  const id = (socket.data as { userId?: unknown }).userId;
  return typeof id === "string" ? id : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, maxLength);
  return text.length === 0 ? null : text;
}

function asNumberArray(value: unknown, length: number): number[] | null {
  if (Array.isArray(value) === false || value.length !== length) return null;
  const out: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || Number.isFinite(item) === false) return null;
    out.push(item);
  }
  return out;
}

function asStringArray(value: unknown, limit: number): string[] | null {
  if (Array.isArray(value) === false) return null;
  const out: string[] = [];
  for (const item of value.slice(0, limit)) {
    if (typeof item !== "string" || item.length === 0 || item.length > 40) continue;
    out.push(item);
  }
  return out;
}

const WALL_TYPES = ["WALL", "DOOR", "WINDOW", "DIFFICULT_TERRAIN"] as const;

async function membershipForEdit(roomId: string, userId: string): Promise<{ readonly isKp: boolean; readonly editable: boolean } | null> {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true, room: { select: { status: true } } }
  });
  if (membership === null) return null;
  const editable =
    membership.room.status === "LOBBY" ||
    membership.room.status === "PLAYING" ||
    membership.room.status === "COMBAT" ||
    membership.room.status === "PAUSED";
  return { isKp: membership.role === "KP", editable };
}

async function sceneWithMap(roomId: string, sceneId: string): Promise<{ readonly sceneId: string; readonly mapId: string } | null> {
  const scene = await prisma.scene.findFirst({
    where: { id: sceneId, roomId },
    select: { id: true, name: true, map: { select: { id: true, width: true, height: true } } }
  });
  if (scene === null) return null;
  if (scene.map !== null) return { sceneId: scene.id, mapId: scene.map.id };
  const map = await prisma.map.create({
    data: {
      sceneId: scene.id,
      name: scene.name,
      width: 1600,
      height: 1000,
      gridSize: 70,
      bgColor: "#1a1a2e",
      showGrid: true,
      showFog: true
    },
    select: { id: true }
  });
  return { sceneId: scene.id, mapId: map.id };
}

async function broadcastSceneVisibility(
  io: SocketServer,
  roomId: string,
  sceneId: string
): Promise<void> {
  const members = await prisma.roomMember.findMany({
    where: { roomId },
    select: { userId: true, role: true }
  });
  await Promise.all(
    members.map(async (member) => {
      const view = await loadSceneView(roomId, sceneId, {
        userId: member.userId,
        isKP: member.role === "KP"
      });
      if (view === null || view.map === null) return;
      io.to(userChannel(member.userId)).emit("scene:visibility:updated", {
        roomId,
        sceneId,
        tokens: view.map.tokens
      });
    })
  );
}

async function broadcastMap(io: SocketServer, roomId: string, sceneId: string): Promise<void> {
  const view = await loadSceneMapView(roomId, sceneId);
  if (view !== null) emitSceneMapUpdate(roomId, sceneId, view.map);
  io.to(roomChannel(roomId)).emit("scene:updated", { roomId, sceneId });
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
    if (membership.room.status === "ENDED") {
      ack({ ok: false, error: "当前阶段不能移动地图 Token" });
      return;
    }

    const token = await prisma.token.findUnique({
      where: { id: input.tokenId },
      include: {
        map: { select: { id: true, width: true, height: true, gridSize: true, gridType: true, scene: { select: { id: true, roomId: true } } } },
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

    const freePoint = await findFreeTokenPosition(
      { id: token.map.id, width: token.map.width, height: token.map.height, gridSize: token.map.gridSize, gridType: token.map.gridType },
      { x: Math.max(0, Math.min(token.map.width, x)), y: Math.max(0, Math.min(token.map.height, y)) },
      token.id
    );
    if (freePoint === null) {
      ack({ ok: false, error: "附近没有空闲格子" });
      return;
    }
    await prisma.token.update({
      where: { id: token.id },
      data: { x: freePoint.x, y: freePoint.y }
    });
    const updated = await loadSceneTokenView(token.id);
    if (updated !== null) {
      io.to(roomChannel(input.roomId)).emit("scene:token:updated", { roomId: input.roomId, token: updated.token });
    }
    await broadcastSceneVisibility(io, input.roomId, token.map.scene.id);
    ack({ ok: true });
  });

  socket.on("scene:wall:create", async (payload: unknown, ack: (result: Ack) => void) => {
    const userId = userIdOf(socket);
    const input = (payload ?? {}) as { roomId?: unknown; sceneId?: unknown; points?: unknown; type?: unknown };
    if (userId === null || typeof input.roomId !== "string" || typeof input.sceneId !== "string") {
      ack({ ok: false, error: "参数不合法" });
      return;
    }
    const points = asNumberArray(input.points, 4);
    if (points === null) {
      ack({ ok: false, error: "墙体坐标不合法" });
      return;
    }
    const requestedType = typeof input.type === "string" ? input.type : "WALL";
    const type = (WALL_TYPES as readonly string[]).includes(requestedType) ? requestedType : "WALL";
    const membership = await membershipForEdit(input.roomId, userId);
    if (membership === null || membership.editable === false) {
      ack({ ok: false, error: "当前不能编辑地图" });
      return;
    }
    if (membership.isKp === false) {
      ack({ ok: false, error: "只有 KP 可以绘制墙体" });
      return;
    }
    const scene = await sceneWithMap(input.roomId, input.sceneId);
    if (scene === null) {
      ack({ ok: false, error: "场景不存在" });
      return;
    }
    await prisma.wall.create({ data: { mapId: scene.mapId, points: points as never, type: type as never } });
    await broadcastMap(io, input.roomId, input.sceneId);
    ack({ ok: true });
  });

  socket.on("scene:wall:delete", async (payload: unknown, ack: (result: Ack) => void) => {
    const userId = userIdOf(socket);
    const input = (payload ?? {}) as { roomId?: unknown; wallId?: unknown };
    if (userId === null || typeof input.roomId !== "string" || typeof input.wallId !== "string") {
      ack({ ok: false, error: "参数不合法" });
      return;
    }
    const membership = await membershipForEdit(input.roomId, userId);
    if (membership === null || membership.editable === false || membership.isKp === false) {
      ack({ ok: false, error: "只有 KP 可以删除墙体" });
      return;
    }
    const wall = await prisma.wall.findUnique({
      where: { id: input.wallId },
      select: { id: true, map: { select: { scene: { select: { id: true, roomId: true } } } } }
    });
    if (wall === null || wall.map.scene.roomId !== input.roomId) {
      ack({ ok: false, error: "墙体不存在" });
      return;
    }
    await prisma.wall.delete({ where: { id: wall.id } });
    await broadcastMap(io, input.roomId, wall.map.scene.id);
    ack({ ok: true });
  });

  socket.on("scene:light:create", async (payload: unknown, ack: (result: Ack) => void) => {
    const userId = userIdOf(socket);
    const input = (payload ?? {}) as {
      roomId?: unknown;
      sceneId?: unknown;
      x?: unknown;
      y?: unknown;
      radius?: unknown;
      color?: unknown;
      intensity?: unknown;
    };
    if (userId === null || typeof input.roomId !== "string" || typeof input.sceneId !== "string") {
      ack({ ok: false, error: "参数不合法" });
      return;
    }
    const x = asNumber(input.x);
    const y = asNumber(input.y);
    if (x === null || y === null) {
      ack({ ok: false, error: "坐标不合法" });
      return;
    }
    const membership = await membershipForEdit(input.roomId, userId);
    if (membership === null || membership.editable === false || membership.isKp === false) {
      ack({ ok: false, error: "只有 KP 可以放置灯光" });
      return;
    }
    const scene = await sceneWithMap(input.roomId, input.sceneId);
    if (scene === null) {
      ack({ ok: false, error: "场景不存在" });
      return;
    }
    const radius = Math.max(20, Math.min(2000, asNumber(input.radius) ?? 220));
    const color = asString(input.color, 20) ?? "#ffaa00";
    const intensity = Math.max(0, Math.min(2, asNumber(input.intensity) ?? 1));
    await prisma.light.create({ data: { mapId: scene.mapId, x, y, radius, color, intensity } });
    await broadcastMap(io, input.roomId, input.sceneId);
    ack({ ok: true });
  });

  socket.on("scene:wall:clear", async (payload: unknown, ack: (result: Ack) => void) => {
    const userId = userIdOf(socket);
    const input = (payload ?? {}) as { roomId?: unknown; sceneId?: unknown };
    if (userId === null || typeof input.roomId !== "string" || typeof input.sceneId !== "string") {
      ack({ ok: false, error: "参数不合法" });
      return;
    }
    const membership = await membershipForEdit(input.roomId, userId);
    if (membership === null || membership.editable === false || membership.isKp === false) {
      ack({ ok: false, error: "只有 KP 可以清除墙体" });
      return;
    }
    const scene = await sceneWithMap(input.roomId, input.sceneId);
    if (scene === null) {
      ack({ ok: false, error: "场景不存在" });
      return;
    }
    await prisma.wall.deleteMany({ where: { mapId: scene.mapId } });
    await broadcastMap(io, input.roomId, input.sceneId);
    ack({ ok: true });
  });

  socket.on("scene:light:clear", async (payload: unknown, ack: (result: Ack) => void) => {
    const userId = userIdOf(socket);
    const input = (payload ?? {}) as { roomId?: unknown; sceneId?: unknown };
    if (userId === null || typeof input.roomId !== "string" || typeof input.sceneId !== "string") {
      ack({ ok: false, error: "参数不合法" });
      return;
    }
    const membership = await membershipForEdit(input.roomId, userId);
    if (membership === null || membership.editable === false || membership.isKp === false) {
      ack({ ok: false, error: "只有 KP 可以清除灯光" });
      return;
    }
    const scene = await sceneWithMap(input.roomId, input.sceneId);
    if (scene === null) {
      ack({ ok: false, error: "场景不存在" });
      return;
    }
    await prisma.light.deleteMany({ where: { mapId: scene.mapId } });
    await broadcastMap(io, input.roomId, input.sceneId);
    ack({ ok: true });
  });

  socket.on("scene:light:delete", async (payload: unknown, ack: (result: Ack) => void) => {
    const userId = userIdOf(socket);
    const input = (payload ?? {}) as { roomId?: unknown; lightId?: unknown };
    if (userId === null || typeof input.roomId !== "string" || typeof input.lightId !== "string") {
      ack({ ok: false, error: "参数不合法" });
      return;
    }
    const membership = await membershipForEdit(input.roomId, userId);
    if (membership === null || membership.editable === false || membership.isKp === false) {
      ack({ ok: false, error: "只有 KP 可以删除灯光" });
      return;
    }
    const light = await prisma.light.findUnique({
      where: { id: input.lightId },
      select: { id: true, map: { select: { scene: { select: { id: true, roomId: true } } } } }
    });
    if (light === null || light.map.scene.roomId !== input.roomId) {
      ack({ ok: false, error: "灯光不存在" });
      return;
    }
    await prisma.light.delete({ where: { id: light.id } });
    await broadcastMap(io, input.roomId, light.map.scene.id);
    ack({ ok: true });
  });

  socket.on("scene:fog:paint", async (payload: unknown, ack: (result: Ack) => void) => {
    const userId = userIdOf(socket);
    const input = (payload ?? {}) as { roomId?: unknown; sceneId?: unknown; cells?: unknown; mode?: unknown };
    if (userId === null || typeof input.roomId !== "string" || typeof input.sceneId !== "string") {
      ack({ ok: false, error: "参数不合法" });
      return;
    }
    const cells = asStringArray(input.cells, 5000);
    if (cells === null || cells.length === 0) {
      ack({ ok: false, error: "没有要更新的迷雾格子" });
      return;
    }
    const mode = input.mode === "HIDE" ? "HIDE" : "REVEAL";
    const membership = await membershipForEdit(input.roomId, userId);
    if (membership === null || membership.editable === false || membership.isKp === false) {
      ack({ ok: false, error: "只有 KP 可以操作战争迷雾" });
      return;
    }
    const scene = await prisma.scene.findFirst({
      where: { id: input.sceneId, roomId: input.roomId },
      select: { id: true, map: { select: { id: true, fogRevealed: true } } }
    });
    if (scene === null || scene.map === null) {
      ack({ ok: false, error: "场景地图不存在" });
      return;
    }
    const existing = Array.isArray(scene.map.fogRevealed)
      ? scene.map.fogRevealed.filter((item): item is string => typeof item === "string")
      : [];
    const next = new Set(existing);
    for (const cell of cells) {
      if (mode === "REVEAL") next.add(cell);
      else next.delete(cell);
    }
    const fogRevealed = Array.from(next);
    await prisma.map.update({ where: { id: scene.map.id }, data: { fogRevealed: fogRevealed as never } });
    emitSceneFogUpdate(input.roomId, input.sceneId, fogRevealed);
    ack({ ok: true });
  });

  socket.on("scene:fog:reset", async (payload: unknown, ack: (result: Ack) => void) => {
    const userId = userIdOf(socket);
    const input = (payload ?? {}) as { roomId?: unknown; sceneId?: unknown };
    if (userId === null || typeof input.roomId !== "string" || typeof input.sceneId !== "string") {
      ack({ ok: false, error: "参数不合法" });
      return;
    }
    const membership = await membershipForEdit(input.roomId, userId);
    if (membership === null || membership.editable === false || membership.isKp === false) {
      ack({ ok: false, error: "只有 KP 可以重置战争迷雾" });
      return;
    }
    const scene = await prisma.scene.findFirst({
      where: { id: input.sceneId, roomId: input.roomId },
      select: { id: true, map: { select: { id: true } } }
    });
    if (scene === null || scene.map === null) {
      ack({ ok: false, error: "场景地图不存在" });
      return;
    }
    await prisma.map.update({ where: { id: scene.map.id }, data: { fogRevealed: [] as never } });
    emitSceneFogUpdate(input.roomId, input.sceneId, []);
    ack({ ok: true });
  });
}
