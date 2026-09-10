import { io, type Socket } from "socket.io-client";
import { characterRef, createCombatRecord, npcRef } from "../src/server/combat/setup";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { NpcStatsSchema } from "../src/shared/npc";
import type { Ack, CombatJoinAck, CombatReactionRequest, CombatUpdate } from "../src/shared/socket";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const jar = new Map<string, string>();

function absorbCookies(response: Response): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const listed = headers.getSetCookie?.() ?? [];
  for (const cookie of listed) {
    const first = cookie.split(";")[0];
    if (first === undefined) continue;
    const equals = first.indexOf("=");
    if (equals <= 0) continue;
    jar.set(first.slice(0, equals), first.slice(equals + 1));
  }
}

function cookieHeader(): string {
  return Array.from(jar).map(([key, value]) => key + "=" + value).join("; ");
}

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; text: string }> {
  const response = await fetch(BASE + path, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: cookieHeader() },
    redirect: "manual"
  });
  absorbCookies(response);
  return { status: response.status, text: await response.text() };
}

function assert(condition: boolean, message: string): asserts condition {
  if (condition === false) throw new Error("COMBAT E2E FAILED: " + message);
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket ack timeout: " + event)), 8000);
    socket.emit(event, payload, (result: T) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function waitEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error("socket event timeout: " + event));
    }, 8000);
    function handler(value: T): void {
      clearTimeout(timer);
      resolve(value);
    }
    socket.once(event, handler);
  });
}

function waitForView(
  socket: Socket,
  combatId: string,
  predicate: (update: CombatUpdate) => boolean
): Promise<CombatUpdate> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("combat:update", handler);
      reject(new Error("combat update timeout"));
    }, 8000);
    function handler(update: CombatUpdate): void {
      if (update.combatId !== combatId) return;
      if (predicate(update) === false) return;
      clearTimeout(timer);
      socket.off("combat:update", handler);
      resolve(update);
    }
    socket.on("combat:update", handler);
  });
}

function connectSocket(ticket: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { path: "/api/socket", autoConnect: false, transports: ["websocket"] });
    socket.auth = { ticket };
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("socket connect timeout"));
    }, 8000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.connect();
  });
}

async function main(): Promise<void> {
  const username = "e2e_combat_" + Date.now().toString(36);
  const password = "test-password-123";
  let roomId: string | null = null;
  let socket: Socket | null = null;
  try {
    const register = await call("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, displayName: "战斗验证", password })
    });
    assert(register.status === 201, "注册状态 " + register.status);
    const registerBody = JSON.parse(register.text) as { user?: { id?: string } };
    const userId = registerBody.user?.id;
    assert(typeof userId === "string" && userId.length > 0, "缺少 userId");

    const csrf = await call("/api/auth/csrf");
    const csrfToken = (JSON.parse(csrf.text) as { csrfToken?: string }).csrfToken;
    assert(typeof csrfToken === "string" && csrfToken.length > 0, "缺少 csrfToken");
    const login = await call("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrfToken,
        username,
        password,
        callbackUrl: BASE + "/",
        json: "true"
      }).toString()
    });
    assert(login.status === 302, "登录状态 " + login.status);

    const room = await prisma.room.create({
      data: {
        name: "E2E战斗房" + Date.now().toString(36),
        system: "TOUHOU",
        ownerId: userId,
        inviteCode: "CE" + Date.now().toString(36).slice(-5).toUpperCase(),
        chargenMethod: "destiny5",
        members: { create: { userId, role: "KP" } }
      }
    });
    roomId = room.id;

    await prisma.room.update({ where: { id: room.id }, data: { status: "PLAYING" } });
    const character = await prisma.character.create({
      data: {
        userId,
        system: "TOUHOU",
        name: "E2E灵梦",
        race: "HUMAN",
        str: 50, con: 50, siz: 50, dex: 70, app: 60, int: 55, pow: 70, edu: 55, luck: 50,
        skills: { DANMAKU: 80, DODGE: 60, FLIGHT: 60 }
      }
    });
    await prisma.roomCharacterEntry.create({
      data: { roomId: room.id, characterId: character.id, status: "APPROVED" }
    });

    const npcStats = NpcStatsSchema.parse({
      presetId: "FAIRY",
      tier: "MINION",
      rarity: "UNCOMMON",
      race: "FAIRY",
      attributes: { str: 20, con: 25, siz: 20, dex: 65, app: 45, int: 25, pow: 55, edu: 5, luck: 60 },
      skills: { DANMAKU: 60, DODGE: 45, ELEMENTAL_MAGIC: 50, FLIGHT: 60 },
      maxHp: 50,
      maxMp: 220,
      maxSan: 55,
      maxDp: 100,
      tags: ["FAIRY"]
    });
    const npc = await prisma.card.create({
      data: {
        scope: "ROOM",
        roomId: room.id,
        ownerId: userId,
        type: "NPC",
        name: "E2E妖精",
        rarity: "UNCOMMON",
        system: "TOUHOU",
        stats: npcStats as never
      }
    });

    const effective = await loadEffectivePack({
      id: room.id,
      system: room.system,
      rulePackVersionId: room.rulePackVersionId,
      ruleOverride: room.ruleOverride
    });
    const created = await createCombatRecord(
      room.id,
      effective,
      [characterRef(character.id)],
      [npcRef(npc.id)]
    );
    assert(created.ok === true && created.combatId !== undefined, created.error ?? "创建战斗失败");
    const combatId = created.combatId as string;

    const combatPage = await call("/rooms/" + room.id);
    assert(combatPage.status === 200, "战斗页状态 " + combatPage.status);

    const ticketResponse = await call("/api/socket-ticket", { method: "POST" });
    assert(ticketResponse.status === 200, "票据状态 " + ticketResponse.status);
    const ticket = (JSON.parse(ticketResponse.text) as { ticket?: string }).ticket;
    assert(typeof ticket === "string" && ticket.length > 0, "缺少 socket ticket");

    socket = await connectSocket(ticket);
    const join = await emitAck<CombatJoinAck>(socket, "combat:join", combatId);
    assert(join.ok === true && join.view !== undefined, join.error ?? "加入战斗失败");
    const view = join.view;
    assert(view !== null && view.participants.length === 2, "参战单位数不是 2");
    const actor = view.participants.find((item) => item.isReady && item.defeated === false);
    assert(actor !== undefined, "没有就绪单位");
    const target = view.participants.find((item) => item.id !== actor?.id);
    assert(target !== undefined, "没有目标单位");

    const reactionRequest = waitEvent<CombatReactionRequest>(socket, "combat:reaction-request");
    const damageUpdate = waitForView(socket, combatId, (update) => {
      return update.view.log.some((entry) => entry.kind === "DAMAGE");
    });

    const actionAck = await emitAck<Ack>(socket, "combat:action", {
      combatId,
      actorId: actor?.id,
      action: { kind: "DANMAKU", targetId: target?.id, skill: "DANMAKU", damage: "2d6+2" }
    });
    assert(actionAck.ok === true, actionAck.error ?? "提交行动失败");

    const request = await reactionRequest;
    const reactionAck = await emitAck<Ack>(socket, "combat:reaction", {
      combatId,
      targetId: request.targetId,
      reaction: { type: "PASS" }
    });
    assert(reactionAck.ok === true, reactionAck.error ?? "提交反应失败");

    for (const other of view.participants) {
      if (other.id === actor.id || other.isReady === false || other.defeated) continue;
      const passAck = await emitAck<Ack>(socket, "combat:action", {
        combatId,
        actorId: other.id,
        action: { kind: "PASS" }
      });
      assert(passAck.ok === true, passAck.error ?? "其他就绪单位跳过失败");
    }
    const update = await damageUpdate;
    const damageEntry = update.view.log.find((entry) => entry.kind === "DAMAGE");

    assert(damageEntry !== undefined, "日志中没有伤害记录");
    const endedUpdate = waitForView(socket, combatId, (next) => next.view.phase === "ENDED");
    const abortAck = await emitAck<Ack>(socket, "combat:abort", { combatId });
    assert(abortAck.ok === true, abortAck.error ?? "中止战斗失败");
    await endedUpdate;
    const roomAfterAbort = await prisma.room.findUnique({ where: { id: room.id }, select: { status: true } });
    assert(roomAfterAbort?.status === "PLAYING", "中止后房间状态应回到 PLAYING");

    const combatRow = await prisma.combat.findUnique({ where: { id: combatId } });
    assert(combatRow !== null, "数据库中没有战斗记录");
    const snapshots = await prisma.combatSnapshot.count({ where: { combatId } });
    assert(snapshots >= 2, "战斗快照没有持久化");

    console.log("PASS 战斗 E2E：建战斗 → Socket 加入 → 提交行动 → 防守反应 → 结算并广播");
    console.log("  战斗 " + combatId + " 日志条数 " + update.view.log.length + " 快照数 " + snapshots);
  } finally {
    if (socket !== null) socket.close();
    if (roomId === null) {
      await prisma.user.deleteMany({ where: { username } });
    } else {
      await prisma.room.deleteMany({ where: { id: roomId } });
      await prisma.user.deleteMany({ where: { username } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
