import type { Server as HttpServer } from "node:http";
import { Server as SocketServer, type Socket } from "socket.io";
import { cryptoRng, normalizeDiceExpression, parseDice, rollDice } from "@touhou/formula";
import { isSuccess, resolveCheck } from "@touhou/rules";
import { buildEffectiveSkills } from "@/server/character/skills";
import { loadEffectivePack } from "@/server/rules/loader";
import { prisma } from "@/server/db/prisma";
import { gameStateView } from "@/server/game/view";
import { loadRoomMemberViews } from "@/server/room/member-view";
import { loadCombatRuntime } from "@/server/combat/runtime";
import { saveCombatState } from "@/server/combat/setup";
import { broadcastCombat } from "./combat";
import { registerCombatHandlers } from "./combat";
import { registerSceneHandlers } from "./scene";
import { verifyTicket } from "./ticket";
import { readRoomBgm } from "@/shared/bgm";
import type {
  Ack,
  ChatChannel,
  ChatKind,
  ChatMessage,
  DiceRollView,
  DiceVisibility,
  JoinAck,
  RoomBgmJoinAck
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
const userChannel = (userId: string): string => "user:" + userId;

type MessageRow = {
  id: string;
  userId: string;
  targetId: string | null;
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
    targetId: row.targetId,
    createdAt: row.createdAt.toISOString()
  };
}

const KP_ATTRIBUTE_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;
const KP_VITAL_FIELDS = ["hp", "maxHp", "mp", "maxMp", "san", "maxSan", "dp", "maxDp"] as const;

type KpUnitRef = { readonly kind: "CHARACTER" | "NPC"; readonly id: string };

function parseKpUnitRef(value: unknown): KpUnitRef | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("character:")) return { kind: "CHARACTER", id: value.slice(10) };
  if (value.startsWith("npc:")) return { kind: "NPC", id: value.slice(4) };
  return null;
}

function finiteNumber(value: unknown, min: number, max: number): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(number) === false) return undefined;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

interface UnitValuesAck extends Ack {
  readonly source?: string;
  readonly values?: Record<string, unknown>;
}

interface KpAdjustValues {
  readonly vitals: Partial<Record<(typeof KP_VITAL_FIELDS)[number], number>>;
  readonly attributes: Partial<Record<(typeof KP_ATTRIBUTE_KEYS)[number], number>>;
  readonly skills: Record<string, number>;
}

function parseKpAdjustValues(value: unknown): KpAdjustValues {
  const record = recordOf(value);
  const vitals: Partial<Record<(typeof KP_VITAL_FIELDS)[number], number>> = {};
  for (const field of KP_VITAL_FIELDS) {
    const parsed = finiteNumber(record[field], 0, 999999);
    if (parsed !== undefined) vitals[field] = parsed;
  }
  const attributes: Partial<Record<(typeof KP_ATTRIBUTE_KEYS)[number], number>> = {};
  const rawAttributes = recordOf(record.attributes);
  for (const key of KP_ATTRIBUTE_KEYS) {
    const parsed = finiteNumber(rawAttributes[key], 0, 999);
    if (parsed !== undefined) attributes[key] = parsed;
  }
  const skills: Record<string, number> = {};
  const rawSkills = recordOf(record.skills);
  for (const [key, raw] of Object.entries(rawSkills)) {
    const id = key.trim().slice(0, 120);
    if (id.length === 0) continue;
    const parsed = finiteNumber(raw, 0, 999);
    if (parsed !== undefined) skills[id] = parsed;
  }
  return { vitals, attributes, skills };
}

async function loadMembership(roomId: string, userId: string) {
  return prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true, room: { select: { status: true, characterVisibility: true } } }
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
      select: { id: true, username: true, displayName: true, isDisabled: true }
    });

    if (user === null || user.isDisabled) {
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
    void socket.join(userChannel(me.userId));

    registerCombatHandlers(io, socket);
    registerSceneHandlers(io, socket);

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

      const visibilityFilter = membership.role === "KP"
        ? { roomId }
        : { roomId, channel: { not: "KP_ONLY" as const } };
      const rows = await prisma.message.findMany({
        where: {
          ...visibilityFilter,
          OR: [
            { channel: { not: "WHISPER" as const } },
            { userId: me.userId },
            { targetId: me.userId }
          ]
        },
        include: { user: { select: { username: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT
      });

      const members = await loadRoomMemberViews({
        roomId,
        viewerUserId: me.userId,
        isKP: membership.role === "KP",
        roomVisibility: membership.room.characterVisibility
      });
      const activeGame = await prisma.game.findFirst({
        where: { roomId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
        orderBy: { createdAt: "desc" },
        include: { state: true }
      });
      const activeCombat = await prisma.combat.findFirst({
        where: { roomId, endedAt: null },
        select: { id: true }
      });
      const member = await prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId: me.userId } },
        select: { activeCharacter: { select: { id: true, name: true } } }
      });

      ack({
        ok: true,
        messages: rows.slice().reverse().map((row) => toChatMessage(row as MessageRow)),
        members,
        gameState: activeGame?.state === null || activeGame?.state === undefined ? null : gameStateView(activeGame.state),
        activeCombatId: activeCombat?.id ?? null,
        activeCharacter: member?.activeCharacter ?? null
      });
    });

    socket.on("room:bgm:join", async (roomId: unknown, ack: (result: RoomBgmJoinAck) => void) => {
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
      const bgmGame = await prisma.game.findFirst({
        where: { roomId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
        orderBy: { createdAt: "desc" },
        select: { state: { select: { custom: true } } }
      });
      ack({
        ok: true,
        bgm: bgmGame?.state === null || bgmGame?.state === undefined ? null : readRoomBgm(bgmGame.state.custom)
      });
    });

    socket.on("chat:send", async (payload: unknown, ack: (result: Ack) => void) => {
      const input = payload as { roomId?: unknown; channel?: unknown; text?: unknown; targetId?: unknown };
      if (typeof input?.roomId !== "string" || typeof input.text !== "string") {
        ack({ ok: false, error: "参数不合法" });
        return;
      }

      const roomId = input.roomId;
      const text = input.text.trim().slice(0, 2000);
      if (text.length === 0) {
        ack({ ok: false, error: "消息不能为空" });
        return;
      }

      const channel: ChatChannel =
        input.channel === "IC" || input.channel === "KP_ONLY" || input.channel === "WHISPER" ? input.channel : "OOC";

      const membership = await loadMembership(roomId, me.userId);
      if (membership === null) {
        ack({ ok: false, error: "你不在这个房间里" });
        return;
      }
      if (membership.room.status === "LOBBY" || membership.room.status === "ENDED") {
        ack({ ok: false, error: membership.room.status === "ENDED" ? "房间已归档，不能发言或掷骰" : "准备阶段不能发言或掷骰" });
        return;
      }
      if (channel === "KP_ONLY" && membership.role !== "KP") {
        ack({ ok: false, error: "只有 KP 能使用 KP 频道" });
        return;
      }

      let targetId: string | null = null;
      if (channel === "WHISPER") {
        const requestedTarget = typeof input.targetId === "string" ? input.targetId.trim() : "";
        if (requestedTarget.length === 0) {
          ack({ ok: false, error: "请选择悄悄话对象" });
          return;
        }
        const targetMembership = await prisma.roomMember.findUnique({
          where: { roomId_userId: { roomId, userId: requestedTarget } },
          select: { userId: true }
        });
        if (targetMembership === null) {
          ack({ ok: false, error: "悄悄话对象不在这个房间" });
          return;
        }
        targetId = requestedTarget;
      }

      const row = await prisma.message.create({
        data: {
          roomId,
          userId: me.userId,
          targetId,
          channel,
          type: "CHAT",
          content: { text, kind: "CHAT", dice: null }
        },
        include: { user: { select: { username: true, displayName: true } } }
      });

      const message = toChatMessage(row as MessageRow);
      if (channel === "WHISPER" && targetId !== null) {
        io.to(userChannel(me.userId)).emit("chat:message", message);
        if (targetId !== me.userId) io.to(userChannel(targetId)).emit("chat:message", message);
      } else {
        const target = channel === "KP_ONLY" ? kpChannel(roomId) : roomChannel(roomId);
        io.to(target).emit("chat:message", message);
      }
      ack({ ok: true });
    });

    socket.on("dice:roll", async (payload: unknown, ack: (result: Ack) => void) => {
      let replied = false;
      const reply = (result: Ack): void => {
        if (replied) return;
        replied = true;
        ack(result);
      };
      try {
      const input = payload as {
        roomId?: unknown;
        expression?: unknown;
        label?: unknown;
        visibility?: unknown;
      };
      if (typeof input?.roomId !== "string" || typeof input.expression !== "string") {
        reply({ ok: false, error: "参数不合法" });
        return;
      }
      const roomId = input.roomId;
      const expression = normalizeDiceExpression(input.expression).slice(0, 120);
      if (expression.length === 0) {
        reply({ ok: false, error: "请输入骰子表达式，例如 1d100" });
        return;
      }
      const visibility: DiceVisibility =
        input.visibility === "DARK" || input.visibility === "SECRET" ? input.visibility : "PUBLIC";

      const membership = await loadMembership(roomId, me.userId);
      if (membership === null) {
        reply({ ok: false, error: "你不在这个房间里" });
        return;
      }
      if (membership.room.status === "LOBBY" || membership.room.status === "ENDED") {
        reply({ ok: false, error: membership.room.status === "ENDED" ? "房间已归档，不能发言或掷骰" : "准备阶段不能发言或掷骰" });
        return;
      }

      let view: DiceRollView;
      try {
        const result = rollDice(parseDice(expression), cryptoRng);
        view = {
          expression,
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
        reply({ ok: false, error: "骰子表达式不合法，例如 2d6+3" });
        return;
      }

      const label = typeof input.label === "string" ? input.label.trim().slice(0, 60) : "";
      const text = (label.length > 0 ? label + " " : "") + expression + " = " + view.total;

      let messageChannel: ChatChannel = "OOC";
      let targetId: string | null = null;
      if (visibility !== "PUBLIC") {
        messageChannel = "WHISPER";
        targetId = me.userId;
        if (visibility === "DARK") {
          const kp = await prisma.roomMember.findFirst({
            where: { roomId, role: "KP" },
            orderBy: { joinedAt: "asc" },
            select: { userId: true }
          });
          if (kp !== null) targetId = kp.userId;
        }
      }

      const row = await prisma.message.create({
        data: {
          roomId,
          userId: me.userId,
          targetId,
          channel: messageChannel,
          type: "DICE",
          content: { text, kind: "DICE", dice: { ...view, terms: [...view.terms] } }
        },
        include: { user: { select: { username: true, displayName: true } } }
      });

      await prisma.diceRoll.create({
        data: {
          roomId,
          userId: me.userId,
          expression,
          results: { total: view.total, terms: [...view.terms], min: view.min, max: view.max },
          total: view.total,
          visibility,
          seed: "crypto"
        }
      });

      const message = toChatMessage(row as MessageRow);
      if (messageChannel === "WHISPER" && targetId !== null) {
        io.to(userChannel(me.userId)).emit("chat:message", message);
        if (targetId !== me.userId) io.to(userChannel(targetId)).emit("chat:message", message);
      } else {
        io.to(roomChannel(roomId)).emit("chat:message", message);
      }
      reply({ ok: true });
      } catch (error) {
        console.error("dice:roll failed", error);
        reply({ ok: false, error: "掷骰失败，请重试" });
      }
    });

    socket.on("dice:skill-check", async (payload: unknown, ack: (result: Ack) => void) => {
      let replied = false;
      const reply = (result: Ack): void => {
        if (replied) return;
        replied = true;
        ack(result);
      };
      try {
        const input = payload as {
          roomId?: unknown;
          characterId?: unknown;
          skillId?: unknown;
          visibility?: unknown;
        };
        if (
          typeof input?.roomId !== "string" ||
          typeof input.characterId !== "string" ||
          typeof input.skillId !== "string"
        ) {
          reply({ ok: false, error: "参数不合法" });
          return;
        }
        const roomId = input.roomId;
        const characterId = input.characterId;
        const skillId = input.skillId;
        const visibility: DiceVisibility =
          input.visibility === "DARK" || input.visibility === "SECRET" ? input.visibility : "PUBLIC";

        const membership = await loadMembership(roomId, me.userId);
        if (membership === null) {
          reply({ ok: false, error: "你不在这个房间里" });
          return;
        }
        if (membership.room.status === "LOBBY" || membership.room.status === "ENDED") {
          reply({
            ok: false,
            error: membership.room.status === "ENDED" ? "房间已归档，不能发起技能检定" : "准备阶段不能发起技能检定"
          });
          return;
        }

        const activeGame = await prisma.game.findFirst({
          where: { roomId, status: { in: ["PLAYING", "COMBAT", "PAUSED"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true }
        });
        if (activeGame === null) {
          reply({ ok: false, error: "当前没有进行中的局，不能用技能检定模式" });
          return;
        }

        const character = await prisma.character.findUnique({ where: { id: characterId } });
        if (character === null) {
          reply({ ok: false, error: "角色不存在" });
          return;
        }
        if (character.userId !== me.userId && membership.role !== "KP") {
          reply({ ok: false, error: "只能为自己的角色进行技能检定" });
          return;
        }
        const gameCharacter = await prisma.gameCharacter.findUnique({
          where: { gameId_characterId: { gameId: activeGame.id, characterId } }
        });
        if (gameCharacter === null) {
          reply({ ok: false, error: "该角色不在当前局中" });
          return;
        }

        const room = await prisma.room.findUnique({
          where: { id: roomId },
          select: { system: true, rulePackVersionId: true, ruleOverride: true }
        });
        if (room === null) {
          reply({ ok: false, error: "房间不存在" });
          return;
        }
        const pack = await loadEffectivePack({
          id: roomId,
          system: room.system,
          rulePackVersionId: room.rulePackVersionId,
          ruleOverride: room.ruleOverride
        });
        const skill = pack.compiled.skills.find((item) => item.id === skillId);
        if (skill === undefined) {
          reply({ ok: false, error: "规则包中没有这个技能" });
          return;
        }

        const values = buildEffectiveSkills(pack.compiled, character);
        const target = values[skillId] ?? 0;
        const roll = rollDice(parseDice("1d100"), cryptoRng).total;
        const check = resolveCheck(pack.compiled, roll, target);
        const success = isSuccess(check.result);

        const view: DiceRollView = {
          expression: "1d100",
          total: roll,
          terms: ["1d100[" + roll + "]"],
          min: 1,
          max: 100
        };
        const label = "【技能检定】" + character.name + " · " + skill.name;
        let text =
          label +
          " 1d100 = " +
          roll +
          " / 目标 " +
          target +
          " → " +
          check.result +
          (success ? "（成功）" : "（失败）");

        if (success) {
          const note = "技能检定成功自动标记";
          const existing = await prisma.growthCheck.findUnique({
            where: { gameId_characterId_skillId: { gameId: activeGame.id, characterId, skillId } }
          });
          if (existing === null) {
            await prisma.growthCheck.create({
              data: {
                gameId: activeGame.id,
                characterId,
                skillId,
                skillName: skill.name,
                beforeValue: target,
                note,
                createdBy: me.userId
              }
            });
            text += " · 已计入成长池";
          } else if (existing.state === "CANCELLED") {
            await prisma.growthCheck.update({
              where: { id: existing.id },
              data: {
                state: "PENDING",
                skillName: skill.name,
                beforeValue: target,
                note,
                roll: null,
                gain: null,
                resolvedAt: null,
                resolvedBy: null,
                advancementId: null,
                createdBy: me.userId
              }
            });
            text += " · 已重新计入成长池";
          } else if (existing.state === "PENDING") {
            text += " · 已在成长池中";
          } else {
            text += " · 本局已结算过该技能成长";
          }
        }

        let messageChannel: ChatChannel = "OOC";
        let targetId: string | null = null;
        if (visibility !== "PUBLIC") {
          messageChannel = "WHISPER";
          targetId = me.userId;
          if (visibility === "DARK") {
            const kp = await prisma.roomMember.findFirst({
              where: { roomId, role: "KP" },
              orderBy: { joinedAt: "asc" },
              select: { userId: true }
            });
            if (kp !== null) targetId = kp.userId;
          }
        }

        const row = await prisma.message.create({
          data: {
            roomId,
            userId: me.userId,
            targetId,
            channel: messageChannel,
            type: "DICE",
            content: { text, kind: "DICE", dice: { ...view, terms: [...view.terms] } }
          },
          include: { user: { select: { username: true, displayName: true } } }
        });
        await prisma.diceRoll.create({
          data: {
            roomId,
            userId: me.userId,
            expression: "1d100",
            results: { total: view.total, terms: [...view.terms], min: view.min, max: view.max, skillId, target, success },
            total: view.total,
            visibility,
            seed: "crypto"
          }
        });

        const message = toChatMessage(row as MessageRow);
        if (messageChannel === "WHISPER" && targetId !== null) {
          io.to(userChannel(me.userId)).emit("chat:message", message);
          if (targetId !== me.userId) io.to(userChannel(targetId)).emit("chat:message", message);
        } else {
          io.to(roomChannel(roomId)).emit("chat:message", message);
        }
        if (success) {
          io.to(roomChannel(roomId)).emit("room:advancement:update", {
            roomId,
            gameId: activeGame.id,
            characterId
          });
        }
        reply({ ok: true });
      } catch (error) {
        console.error("dice:skill-check failed", error);
        reply({ ok: false, error: "技能检定失败，请重试" });
      }
    });

    socket.on("room:unit-values", async (payload: unknown, ack: (result: UnitValuesAck) => void) => {
      try {
        const input = payload as { roomId?: unknown; unitRef?: unknown };
        if (typeof input?.roomId !== "string") {
          ack({ ok: false, error: "参数不合法" });
          return;
        }
        const roomId = input.roomId;
        const unit = parseKpUnitRef(input.unitRef);
        if (unit === null) {
          ack({ ok: false, error: "单位引用不合法" });
          return;
        }
        const membership = await loadMembership(roomId, me.userId);
        if (membership === null || membership.role !== "KP") {
          ack({ ok: false, error: "只有 KP 可以查看单位实时数值" });
          return;
        }

        // 单位可能参加房间内任意一场进行中的战斗，逐场查找。
        const activeCombats = await prisma.combat.findMany({
          where: { roomId, endedAt: null },
          orderBy: { startedAt: "asc" },
          select: { id: true }
        });
        for (const activeCombat of activeCombats) {
          const runtime = await loadCombatRuntime(activeCombat.id);
          if (runtime === null) continue;
          const participant =
            unit.kind === "CHARACTER"
              ? runtime.state.participants.find((item) => item.characterId === unit.id)
              : runtime.state.participants.find((item) => item.id === unit.id);
          if (participant === undefined) continue;
          ack({
            ok: true,
            source: "COMBAT",
            values: {
              hp: participant.hp,
              maxHp: participant.maxHp,
              mp: participant.mp,
              maxMp: participant.maxMp,
              san: participant.san,
              maxSan: participant.maxSan,
              dp: participant.dp,
              maxDp: participant.maxDp,
              attributes: { ...participant.attributes },
              skills: { ...participant.skills }
            }
          });
          return;
        }

        if (unit.kind === "CHARACTER") {
          const character = await prisma.character.findUnique({ where: { id: unit.id } });
          if (character === null) {
            ack({ ok: false, error: "角色不存在" });
            return;
          }
          const game = await prisma.game.findFirst({
            where: { roomId, status: { in: ["PLAYING", "COMBAT", "PAUSED"] } },
            orderBy: { createdAt: "desc" },
            select: { id: true }
          });
          const gameCharacter =
            game === null
              ? null
              : await prisma.gameCharacter.findUnique({
                  where: { gameId_characterId: { gameId: game.id, characterId: unit.id } }
                });
          const skills: Record<string, number> = {};
          for (const [key, value] of Object.entries(recordOf(character.skills))) {
            if (typeof value === "number" && Number.isFinite(value)) skills[key] = value;
          }
          ack({
            ok: true,
            source: gameCharacter === null ? "CARD" : "GAME",
            values: {
              hp: gameCharacter?.currentHp ?? character.hp,
              maxHp: character.maxHp,
              mp: gameCharacter?.currentMp ?? character.mp,
              maxMp: character.maxMp,
              san: gameCharacter?.currentSan ?? character.san,
              maxSan: character.maxSan,
              dp: gameCharacter?.currentDp ?? character.dp,
              maxDp: character.maxDp,
              attributes: {
                str: character.str,
                con: character.con,
                siz: character.siz,
                dex: character.dex,
                app: character.app,
                int: character.int,
                pow: character.pow,
                edu: character.edu,
                luck: character.luck
              },
              skills
            }
          });
          return;
        }

        const card = await prisma.card.findUnique({ where: { id: unit.id } });
        if (card === null || card.roomId !== roomId || card.type !== "NPC") {
          ack({ ok: false, error: "NPC 卡不存在或不属于本房间" });
          return;
        }
        const stats = recordOf(card.stats);
        const rawAttributes = recordOf(stats.attributes);
        const rawSkills = recordOf(stats.skills);
        const attributes: Record<string, number> = {};
        for (const key of KP_ATTRIBUTE_KEYS) {
          const value = finiteNumber(rawAttributes[key], 0, 999);
          if (value !== undefined) attributes[key] = value;
        }
        const skills: Record<string, number> = {};
        for (const [key, raw] of Object.entries(rawSkills)) {
          const value = finiteNumber(raw, 0, 999);
          if (value !== undefined) skills[key] = value;
        }
        ack({
          ok: true,
          source: "CARD",
          values: {
            hp: finiteNumber(stats.hp, 0, 999999) ?? finiteNumber(stats.maxHp, 0, 999999) ?? 0,
            maxHp: finiteNumber(stats.maxHp, 0, 999999) ?? 0,
            mp: finiteNumber(stats.mp, 0, 999999) ?? finiteNumber(stats.maxMp, 0, 999999) ?? 0,
            maxMp: finiteNumber(stats.maxMp, 0, 999999) ?? 0,
            san: finiteNumber(stats.san, 0, 999999) ?? finiteNumber(stats.maxSan, 0, 999999) ?? 0,
            maxSan: finiteNumber(stats.maxSan, 0, 999999) ?? 0,
            dp: finiteNumber(stats.dp, 0, 999999) ?? finiteNumber(stats.maxDp, 0, 999999) ?? 0,
            maxDp: finiteNumber(stats.maxDp, 0, 999999) ?? 0,
            attributes,
            skills
          }
        });
      } catch (error) {
        console.error("room:unit-values failed", error);
        ack({ ok: false, error: "读取单位数值失败，请重试" });
      }
    });

    socket.on("room:adjust-values", async (payload: unknown, ack: (result: Ack) => void) => {
      try {
        const input = payload as { roomId?: unknown; unitRef?: unknown; values?: unknown };
        if (typeof input?.roomId !== "string") {
          ack({ ok: false, error: "参数不合法" });
          return;
        }
        const roomId = input.roomId;
        const unit = parseKpUnitRef(input.unitRef);
        if (unit === null) {
          ack({ ok: false, error: "单位引用不合法" });
          return;
        }
        const values = parseKpAdjustValues(input.values);
        const hasAny =
          Object.keys(values.vitals).length > 0 ||
          Object.keys(values.attributes).length > 0 ||
          Object.keys(values.skills).length > 0;
        if (hasAny === false) {
          ack({ ok: false, error: "没有要修改的数值" });
          return;
        }
        const membership = await loadMembership(roomId, me.userId);
        if (membership === null || membership.role !== "KP") {
          ack({ ok: false, error: "只有 KP 可以修改单位数值" });
          return;
        }

        let combatAdjusted = false;
        // 单位可能参加房间内任意一场进行中的战斗；席位互斥保证最多命中一场。
        const activeCombats = await prisma.combat.findMany({
          where: { roomId, endedAt: null },
          orderBy: { startedAt: "asc" },
          select: { id: true }
        });
        for (const activeCombat of activeCombats) {
          const runtime = await loadCombatRuntime(activeCombat.id);
          if (runtime !== null) {
            const participant =
              unit.kind === "CHARACTER"
                ? runtime.state.participants.find((item) => item.characterId === unit.id)
                : runtime.state.participants.find((item) => item.id === unit.id);
            if (participant !== undefined) {
              for (const [field, value] of Object.entries(values.vitals)) {
                if (field === "hp" || field === "maxHp" || field === "mp" || field === "maxMp" || field === "san" || field === "maxSan" || field === "dp" || field === "maxDp") {
                  participant[field] = value;
                  participant.vars[field] = value;
                }
              }
              if (values.vitals.hp !== undefined && values.vitals.hp > 0 && participant.dead !== true) {
                // KP 把 HP 调回正数视作急救 / 医学处理：解除濒死与昏迷；
                // 回到最大 HP 一半及以上时按规则移除重伤标记。
                participant.dying = false;
                participant.unconscious = false;
                participant.prone = false;
                participant.defeated = false;
                participant.isReady = false;
                if (values.vitals.hp >= Math.ceil(participant.maxHp / 2)) {
                  participant.majorWound = false;
                }
              }
              for (const [key, value] of Object.entries(values.attributes)) {
                (participant.attributes as unknown as Record<string, number>)[key] = value;
                participant.vars[key] = value;
              }
              participant.skills = { ...participant.skills, ...values.skills };
              await saveCombatState(activeCombat.id, runtime.state);
              await broadcastCombat(io, runtime);
              combatAdjusted = true;
              break;
            }
          }
        }

        if (unit.kind === "CHARACTER") {
          const entry = await prisma.roomCharacterEntry.findFirst({
            where: { roomId, characterId: unit.id, status: "APPROVED" },
            select: { id: true }
          });
          if (entry === null) {
            ack({ ok: false, error: "该角色不在本房间中" });
            return;
          }
          const character = await prisma.character.findUnique({ where: { id: unit.id } });
          if (character === null) {
            ack({ ok: false, error: "角色不存在" });
            return;
          }
          await prisma.character.update({
            where: { id: unit.id },
            data: {
              ...values.attributes,
              skills: { ...(recordOf(character.skills)), ...values.skills } as never,
              ...(values.vitals.maxHp === undefined ? {} : { maxHp: values.vitals.maxHp }),
              ...(values.vitals.maxMp === undefined ? {} : { maxMp: values.vitals.maxMp }),
              ...(values.vitals.maxSan === undefined ? {} : { maxSan: values.vitals.maxSan }),
              ...(values.vitals.maxDp === undefined ? {} : { maxDp: values.vitals.maxDp }),
              ...(values.vitals.hp === undefined ? {} : { hp: values.vitals.hp }),
              ...(values.vitals.mp === undefined ? {} : { mp: values.vitals.mp }),
              ...(values.vitals.san === undefined ? {} : { san: values.vitals.san }),
              ...(values.vitals.dp === undefined ? {} : { dp: values.vitals.dp })
            } as never
          });
          const game = await prisma.game.findFirst({
            where: { roomId, status: { in: ["PLAYING", "COMBAT", "PAUSED"] } },
            orderBy: { createdAt: "desc" },
            select: { id: true }
          });
          if (game !== null) {
            await prisma.gameCharacter.updateMany({
              where: { gameId: game.id, characterId: unit.id },
              data: {
                ...(values.vitals.hp === undefined ? {} : { currentHp: values.vitals.hp }),
                ...(values.vitals.mp === undefined ? {} : { currentMp: values.vitals.mp }),
                ...(values.vitals.san === undefined ? {} : { currentSan: values.vitals.san }),
                ...(values.vitals.dp === undefined ? {} : { currentDp: values.vitals.dp })
              }
            });
          }
        } else {
          const card = await prisma.card.findUnique({ where: { id: unit.id } });
          if (card === null || card.roomId !== roomId || card.type !== "NPC") {
            ack({ ok: false, error: "NPC 卡不存在或不属于本房间" });
            return;
          }
          const stats = recordOf(card.stats);
          const rawAttributes = recordOf(stats.attributes);
          const rawSkills = recordOf(stats.skills);
          const merged = {
            ...stats,
            attributes: { ...rawAttributes, ...values.attributes },
            skills: { ...rawSkills, ...values.skills },
            ...(values.vitals.maxHp === undefined ? {} : { maxHp: values.vitals.maxHp }),
            ...(values.vitals.maxMp === undefined ? {} : { maxMp: values.vitals.maxMp }),
            ...(values.vitals.maxSan === undefined ? {} : { maxSan: values.vitals.maxSan }),
            ...(values.vitals.maxDp === undefined ? {} : { maxDp: values.vitals.maxDp })
          };
          await prisma.card.update({ where: { id: unit.id }, data: { stats: merged as never } });
        }

        io.to(roomChannel(roomId)).emit("room:refresh", { roomId, reason: "kp-values" });
        ack({ ok: true, combatAdjusted } as Ack & { combatAdjusted?: boolean });
      } catch (error) {
        console.error("room:adjust-values failed", error);
        ack({ ok: false, error: "数值调整失败，请重试" });
      }
    });
  });

  return io;
}
