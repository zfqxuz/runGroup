/**
 * COC7 追逐 E2E：
 * FLEE -> 建立追逐（速度检定 / MOV / 行动点 / 初始地点）
 * -> 按 DEX 顺序移动 / 结束回合 -> 逃离者抵达终点 -> 战斗结束。
 */
import { io, type Socket } from "socket.io-client";
import { characterRef, createCombatRecord, npcRef } from "../src/server/combat/setup";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { NpcStatsSchema } from "../src/shared/npc";
import type { Ack, CombatJoinAck, CombatUpdate } from "../src/shared/socket";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
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
  return Array.from(jar)
    .map(([key, value]) => key + "=" + value)
    .join("; ");
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
  if (condition === false) throw new Error("CHASE E2E FAILED: " + message);
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

function waitForReactionRequest(
  socket: Socket,
  combatId: string
): Promise<{ actorId: string; targetId: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("combat:reaction-request", handler);
      reject(new Error("reaction request timeout"));
    }, 8000);
    function handler(request: { combatId?: string; actorId: string; targetId: string }): void {
      if (request.combatId !== combatId) return;
      clearTimeout(timer);
      socket.off("combat:reaction-request", handler);
      resolve(request);
    }
    socket.on("combat:reaction-request", handler);
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
  const username = "e2e_chase_" + Date.now().toString(36);
  const password = "test-password-123";
  let roomId: string | null = null;
  let socket: Socket | null = null;
  try {
    const register = await call("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, displayName: "追逐验证", password })
    });
    assert(register.status === 201, "注册状态 " + register.status);
    const userId = (JSON.parse(register.text) as { user?: { id?: string } }).user?.id;
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
        name: "E2E追逐房" + Date.now().toString(36),
        system: "COC7",
        ownerId: userId,
        inviteCode: "CH" + Date.now().toString(36).slice(-5).toUpperCase(),
        chargenMethod: "manual",
        members: { create: { userId, role: "KP" } }
      }
    });
    roomId = room.id;
    await prisma.room.update({ where: { id: room.id }, data: { status: "PLAYING" } });

    // 玩家单位基础 MOV 7（STR/DEX 都低于 SIZ）。
    const character = await prisma.character.create({
      data: {
        userId,
        system: "COC7",
        name: "E2E追逐者",
        str: 15,
        con: 90,
        siz: 95,
        dex: 80,
        app: 50,
        int: 50,
        pow: 50,
        edu: 50,
        luck: 50,
        hp: 10,
        maxHp: 10,
        mp: 10,
        maxMp: 10,
        san: 50,
        maxSan: 50,
        dp: 10,
        maxDp: 10,
        skills: { DODGE: 50, FIGHTING_BRAWL: 80 }
      }
    });
    await prisma.roomCharacterEntry.create({
      data: { roomId: room.id, characterId: character.id, status: "APPROVED" }
    });

    // NPC 基础 MOV 9（STR/DEX 都高于 SIZ），确保速度检定后仍高于玩家基础 MOV。
    const npcStats = NpcStatsSchema.parse({
      presetId: null,
      tier: "MINION",
      race: null,
      attributes: { str: 90, con: 90, siz: 10, dex: 70, app: 50, int: 50, pow: 50, edu: 50, luck: 50 },
      skills: { FIGHTING_BRAWL: 100 },
      maxHp: 20,
      maxMp: 10,
      maxSan: 50,
      maxDp: 10,
      tags: ["E2E"]
    });
    const npc = await prisma.card.create({
      data: {
        scope: "ROOM",
        roomId: room.id,
        ownerId: userId,
        type: "NPC",
        name: "E2E追逐NPC",
        rarity: "COMMON",
        system: "COC7",
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

    const ticketResponse = await call("/api/socket-ticket", { method: "POST" });
    assert(ticketResponse.status === 200, "票据状态 " + ticketResponse.status);
    const ticket = (JSON.parse(ticketResponse.text) as { ticket?: string }).ticket;
    assert(typeof ticket === "string" && ticket.length > 0, "缺少 socket ticket");

    socket = await connectSocket(ticket);
    const join = await emitAck<CombatJoinAck>(socket, "combat:join", combatId);
    assert(join.ok === true && join.view !== undefined, join.error ?? "加入战斗失败");
    const initial = join.view;
    assert(initial.mode === "INITIATIVE", "COC7 追逐应使用顺序制");
    const actor = initial.participants.find((item) => item.isReady && item.defeated === false);
    assert(actor !== undefined, "没有就绪单位");
    assert(actor.name === "E2E追逐者", "当前应是玩家单位先行动，实际：" + actor?.name);

    const chaseStarted = waitForView(socket, combatId, (update) => {
      return update.view.chase !== null && update.view.chase.status === "ACTIVE";
    });
    const fleeAck = await emitAck<Ack>(socket, "combat:action", {
      combatId,
      actorId: actor.id,
      action: { kind: "FLEE" }
    });
    assert(fleeAck.ok === true, fleeAck.error ?? "逃跑失败");

    let update = await chaseStarted;
    assert(update.view.chase !== null, "FLEE 后没有进入追逐");
    const chase = update.view.chase;
    assert(chase.status === "ACTIVE", "追逐状态应为 ACTIVE");
    const prey = chase.participants.find((item) => item.side === "PREY");
    const chaser = chase.participants.find((item) => item.side === "CHASER");
    assert(prey !== undefined && chaser !== undefined, "缺少逃离者/追逐者");
    assert(prey.position < chaser.position === false, "逃离者应在追逐者前方");

    // 第二阶段：追逐者接近并攻击同地点目标，验证应对窗口 / AP 消耗 / 掉血。
    let attacked = false;
    let attackGuard = 0;
    while (attacked === false && attackGuard < 40) {
      attackGuard += 1;
      const currentChase = update.view.chase;
      if (currentChase === null || currentChase.status !== "ACTIVE") break;
      const currentId = currentChase.activeActorId;
      if (currentId === null) break;
      const current = currentChase.participants.find((item) => item.id === currentId);
      if (current === undefined) break;

      const endTurn = async (): Promise<void> => {
        const nextUpdate = waitForView(socket as Socket, combatId, () => true);
        const endAck = await emitAck<Ack>(socket as Socket, "combat:chase-end-turn", {
          combatId,
          actorId: current.id
        });
        assert(endAck.ok === true, endAck.error ?? "结束追逐回合失败");
        update = await nextUpdate;
      };

      if (current.id === prey.id) {
        await endTurn();
        continue;
      }
      if (current.position < prey.position) {
        if (current.actionPoints < 1) {
          await endTurn();
          continue;
        }
        const steps = Math.min(current.actionPoints, prey.position - current.position);
        const nextUpdate = waitForView(socket as Socket, combatId, () => true);
        const moveAck = await emitAck<Ack>(socket as Socket, "combat:chase-move", {
          combatId,
          actorId: current.id,
          steps
        });
        assert(moveAck.ok === true, moveAck.error ?? "追逐者接近目标失败");
        update = await nextUpdate;
        continue;
      }
      if (current.position === prey.position) {
        if (current.actionPoints < 1) {
          await endTurn();
          continue;
        }
        const hpBefore = update.view.participants.find((item) => item.id === prey.id)?.hp ?? null;
        const reactionRequest = waitForReactionRequest(socket as Socket, combatId);
        const attackAck = await emitAck<Ack>(socket as Socket, "combat:chase-attack", {
          combatId,
          actorId: current.id,
          targetId: prey.id,
          skill: "FIGHTING_BRAWL",
          damage: "1d6"
        });
        assert(attackAck.ok === true, attackAck.error ?? "追逐攻击失败");
        const request = await reactionRequest;
        assert(
          request.targetId === prey.id && request.actorId === current.id,
          "应对请求的双方不正确"
        );
        const resolvedUpdate = waitForView(
          socket as Socket,
          combatId,
          (item) =>
            item.view.pendingReactions.length === 0 &&
            item.view.log.some((entry) => entry.data?.rollType === "DAMAGE_SETTLE")
        );
        const reactionAck = await emitAck<Ack>(socket as Socket, "combat:reaction", {
          combatId,
          targetId: prey.id,
          reaction: { type: "PASS" }
        });
        assert(reactionAck.ok === true, reactionAck.error ?? "追逐中的应对提交失败");
        update = await resolvedUpdate;
        const hpAfter = update.view.participants.find((item) => item.id === prey.id)?.hp ?? null;
        assert(
          typeof hpBefore === "number" && typeof hpAfter === "number" && hpAfter < hpBefore,
          "追逐攻击命中后目标应掉血"
        );
        const apAfter = update.view.chase?.participants.find((item) => item.id === current.id)?.actionPoints;
        assert(apAfter === current.actionPoints - 1, "追逐攻击应恰好消耗 1 行动点");
        attacked = true;
        break;
      }
      await endTurn();
    }
    assert(attacked === true, "40 步内未完成同地点追逐攻击验证");

    let guard = 0;
    while (update.view.phase !== "ENDED" && guard < 40) {
      guard += 1;
      const currentChase = update.view.chase;
      if (currentChase === null || currentChase.status !== "ACTIVE") break;
      const currentId = currentChase.activeActorId;
      if (currentId === null) break;
      const current = currentChase.participants.find((item) => item.id === currentId);
      if (current === undefined) break;
      const nextUpdate = waitForView(socket, combatId, () => true);
      if (current.side === "PREY" && current.actionPoints >= 1 && current.position < currentChase.trackLength - 1) {
        const moveAck = await emitAck<Ack>(socket, "combat:chase-move", {
          combatId,
          actorId: current.id,
          steps: 1
        });
        assert(moveAck.ok === true, moveAck.error ?? "追逐移动失败");
      } else {
        const turnAck = await emitAck<Ack>(socket, "combat:chase-end-turn", {
          combatId,
          actorId: current.id
        });
        assert(turnAck.ok === true, turnAck.error ?? "结束追逐回合失败");
      }
      update = await nextUpdate;
    }

    assert(update.view.phase === "ENDED", "追逐结束后战斗应结束");
    assert(update.view.chase !== null && update.view.chase.status === "ESCAPED", "逃离者应成功脱身");
    const roomAfter = await prisma.room.findUnique({ where: { id: room.id }, select: { status: true } });
    assert(roomAfter?.status === "PLAYING", "追逐结束后房间应回到 PLAYING");

    console.log("PASS 追逐 E2E：FLEE → 速度检定 → 地点 / 行动点 → 接近 → 同地点攻击 / 应对 / 掉血 → 移动 → 逃离 → 战斗结束");
    console.log("  初始地点数 " + chase.trackLength + "，逃离者 MOV " + prey.mov + "，追逐者 MOV " + chaser.mov);
  } finally {
    if (socket !== null) socket.close();
    if (roomId !== null) {
      await prisma.room.deleteMany({ where: { id: roomId } });
    }
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
