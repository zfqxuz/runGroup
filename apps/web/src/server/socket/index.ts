import type { Server as HttpServer } from "node:http";
import { Server as SocketServer, type Socket } from "socket.io";
import { cryptoRng, parseDice, rollDice } from "@touhou/formula";
import { prisma } from "@/server/db/prisma";
import { verifyTicket } from "./ticket";
import type {
  Ack,
  ChatChannel,
  ChatKind,
  ChatMessage,
  DiceRollView,
  JoinAck,
  RoomMemberView
} from "@/shared/socket";

interface SocketAuth {
  userId: string;
  username: string;
  displayName: string;
}

interface StoredContent {
  text: string;
  kind: ChatKind;
  dice: DiceRollView | null;
}

const HISTORY_LIMIT = 50;

function authOf(socket: Socket): SocketAuth {
  return socket.data as unknown as SocketAuth;
}

const roomChannel = (roomId: string): string => "room:" + roomId;
const kpChannel = (roomId: string): string => "room:" + roomId + ":kp";

type MessageRow = {
  id: string;
  userId: string;
  channel: string;
  type: string;
  content: unknown;
  createdAt: Date;
  user: { username: string; displayName: string | null };
};

function toChatMessage(row: MessageRow): ChatMessage {
  const raw = (row.content ?? {}) as Partial<StoredContent>;
  return {
    id: row.id,
    userId: row.userId,
    username: row.user.username,
    displayName: row.user.displayName ?? row.user.username,
    channel: row.channel as ChatChannel,
    kind: raw.kind ?? (row.type as ChatKind),
    text: raw.text ?? "",
    dice: raw.dice ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

async function loadMembership(roomId: string, userId: string) {
  return prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
}

export function createSocketServer(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    path: "/api/socket",
    serveClient: false
  });

  io.use(async (socket, next) => {
    const userId = verifyTicket(socket.handshake.auth?.ticket);
    if (userId === null) {
      next(new Error("unauthorized"));
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true }
    });

    if (user === null) {
      next(new Error("unauthorized"));
      return;
    }

    const data = socket.data as unknown as SocketAuth;
    data.userId = user.id;
    data.username = user.username;
    data.displayName = user.displayName ?? user.username;
    next();
  });

  io.on("connection", (socket) => {
    const me = authOf(socket);

    socket.on("room:join", async (roomId: unknown, ack: (result: JoinAck) => void) => {
      if (typeof roomId !== "string") {
        ack({ ok: false, error: "房间参数不合法" });
        return;
      }

      const membership = await loadMembership(roomId, me.userId);
      if (membership === null) {
        ack({ ok: false, error: "你不在这个房间里" });
        return;
      }

      await socket.join(roomChannel(roomId));
      if (membership.role === "KP") {
        await socket.join(kpChannel(roomId));
      }

      const rows = await prisma.message.findMany({
        where: membership.role === "KP" ? { roomId } : { roomId, channel: { not: "KP_ONLY" } },
        include: { user: { select: { username: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT
      });

      const members = await prisma.roomMember.findMany({
        where: { roomId },
        include: { user: { select: { username: true, displayName: true } } },
        orderBy: { joinedAt: "asc" }
      });

      ack({
        ok: true,
        messages: rows.slice().reverse().map((row) => toChatMessage(row as MessageRow)),
        members: members.map((member): RoomMemberView => ({
          userId: member.userId,
          username: member.user.username,
          displayName: member.user.displayName ?? member.user.username,
          role: member.role
        }))
      });
    });

    socket.on("chat:send", async (payload: unknown, ack: (result: Ack) => void) => {
      const input = payload as { roomId?: unknown; channel?: unknown; text?: unknown };
      if (typeof input?.roomId !== "string" || typeof input.text !== "string") {
        ack({ ok: false, error: "参数不合法" });
        return;
      }

      const text = input.text.trim().slice(0, 2000);
      if (text.length === 0) {
        ack({ ok: false, error: "消息不能为空" });
        return;
      }

      const channel: ChatChannel =
        input.channel === "IC" || input.channel === "KP_ONLY" ? input.channel : "OOC";

      const membership = await loadMembership(input.roomId, me.userId);
      if (membership === null) {
        ack({ ok: false, error: "你不在这个房间里" });
        return;
      }
      if (channel === "KP_ONLY" && membership.role !== "KP") {
        ack({ ok: false, error: "只有 KP 能使用 KP 频道" });
        return;
      }

      const row = await prisma.message.create({
        data: {
          roomId: input.roomId,
          userId: me.userId,
          channel,
          type: "CHAT",
          content: { text, kind: "CHAT", dice: null }
        },
        include: { user: { select: { username: true, displayName: true } } }
      });

      const target = channel === "KP_ONLY" ? kpChannel(input.roomId) : roomChannel(input.roomId);
      io.to(target).emit("chat:message", toChatMessage(row as MessageRow));
      ack({ ok: true });
    });

    socket.on("dice:roll", async (payload: unknown, ack: (result: Ack) => void) => {
      const input = payload as { roomId?: unknown; expression?: unknown; label?: unknown };
      if (typeof input?.roomId !== "string" || typeof input.expression !== "string") {
        ack({ ok: false, error: "参数不合法" });
        return;
      }

      const membership = await loadMembership(input.roomId, me.userId);
      if (membership === null) {
        ack({ ok: false, error: "你不在这个房间里" });
        return;
      }

      let view: DiceRollView;
      try {
        const result = rollDice(parseDice(input.expression), cryptoRng);
        view = {
          expression: input.expression,
          total: result.total,
          terms: result.details.map(
            (detail) =>
              (detail.sign < 0 ? "-" : "+") +
              detail.count +
              "d" +
              detail.sides +
              "[" +
              detail.values.join(", ") +
              "]"
          ),
          min: result.min,
          max: result.max
        };
      } catch {
        ack({ ok: false, error: "骰子表达式不合法，例如 2d6+3" });
        return;
      }

      const label = typeof input.label === "string" ? input.label.trim().slice(0, 60) : "";
      const text = (label.length > 0 ? label + " " : "") + input.expression + " = " + view.total;

      const row = await prisma.message.create({
        data: {
          roomId: input.roomId,
          userId: me.userId,
          channel: "OOC",
          type: "DICE",
          content: { text, kind: "DICE", dice: { ...view, terms: [...view.terms] } }
        },
        include: { user: { select: { username: true, displayName: true } } }
      });

      await prisma.diceRoll.create({
        data: {
          roomId: input.roomId,
          userId: me.userId,
          expression: input.expression,
          results: { total: view.total, terms: [...view.terms], min: view.min, max: view.max },
          total: view.total,
          visibility: "PUBLIC",
          seed: "crypto"
        }
      });

      io.to(roomChannel(input.roomId)).emit("chat:message", toChatMessage(row as MessageRow));
      ack({ ok: true });
    });
  });

  return io;
}
