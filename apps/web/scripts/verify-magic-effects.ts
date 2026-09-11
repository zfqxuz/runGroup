/**
 * 通用法术效果 E2E：
 * - SELF 法术自动作用自己；
 * - ONE + ALLY 法术可以选择自己；
 * - 敌对单体法术触发应对请求，actor 侧能看到 pendingReactions 等待提示；
 * - DAMAGE / DOT / STUN 等通用指令可结算。
 */
import { io, type Socket } from "socket.io-client";
import { characterRef, createCombatRecord, npcRef } from "../src/server/combat/setup";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { NpcStatsSchema } from "../src/shared/npc";
import type { Ack, CombatJoinAck, CombatReactionRequest, CombatUpdate } from "../src/shared/socket";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

function jarCall(jar: Map<string, string>) {
  return async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", [...jar].map(([k, v]) => k + "=" + v).join("; "));
    const response = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    const headersWithCookies = response.headers as Headers & { getSetCookie?: () => string[] };
    for (const cookie of headersWithCookies.getSetCookie?.() ?? []) {
      const first = cookie.split(";")[0];
      if (first === undefined) continue;
      const equals = first.indexOf("=");
      if (equals > 0) jar.set(first.slice(0, equals), first.slice(equals + 1));
    }
    return { status: response.status, text: await response.text() };
  };
}

async function register(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password })
  });
  if (response.status !== 201) throw new Error("注册失败 " + response.status + " " + (await response.text()).slice(0, 200));
  const body = (await response.json()) as { user?: { id?: string } };
  if (body.user?.id === undefined) throw new Error("缺少 user id");
  return body.user.id;
}

async function login(username: string, password: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const call = jarCall(jar);
  const csrf = await call("/api/auth/csrf");
  const csrfToken = (JSON.parse(csrf.text) as { csrfToken?: string }).csrfToken;
  if (csrfToken === undefined) throw new Error("缺少 csrfToken");
  const response = await call("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  if (response.status !== 302) throw new Error("登录失败 " + response.status);
  return jar;
}

async function connectSocket(jar: Map<string, string>): Promise<Socket> {
  const call = jarCall(jar);
  const ticketResponse = await call("/api/socket-ticket", { method: "POST" });
  const ticket = (JSON.parse(ticketResponse.text) as { ticket?: string }).ticket;
  if (ticket === undefined) throw new Error("缺少 socket ticket");
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { path: "/api/socket", autoConnect: false, transports: ["websocket"] });
    socket.auth = { ticket };
    const timer = setTimeout(() => reject(new Error("socket 连接超时")), 8000);
    socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("connect_error", (error: Error) => { clearTimeout(timer); reject(error); });
    socket.connect();
  });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ack 超时：" + event)), 8000);
    socket.emit(event, payload, (result: T) => { clearTimeout(timer); resolve(result); });
  });
}

function waitEvent<T>(socket: Socket, event: string, predicate: (payload: T) => boolean, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error("事件超时：" + event)); }, timeoutMs);
    function handler(payload: T): void {
      if (predicate(payload) === false) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error("E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_magic_kp_" + suffix;
  const plName = "e2e_magic_pl_" + suffix;
  const password = "e2e-magic-pass";
  let roomId: string | null = null;
  let plSocket: Socket | null = null;
  let kpSocket: Socket | null = null;

  try {
    const kpId = await register(kpName, password);
    const plId = await register(plName, password);
    const plJar = await login(plName, password);
    const kpJar = await login(kpName, password);

    const room = await prisma.room.create({
      data: {
        name: "E2E 法术效果房 " + suffix, system: "COC7", era: "MODERN", ownerId: kpId, inviteCode: "MG" + suffix.slice(-5).toUpperCase(), status: "PLAYING",
        ruleOverride: {
          magic: {
            enabled: true,
            system: "COC7",
            spells: [
              { id: "selfheal", name: "自愈", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "SELF", effects: [{ type: "HEAL", amount: "5" }] },
              { id: "bless", name: "祝福", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "ONE", targeting: "ALLY", effects: [{ type: "HEAL", amount: "3" }] },
              { id: "hex", name: "蚀血诅咒", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "ONE", targeting: "ENEMY", effects: [
                { type: "DAMAGE", amount: "2" },
                { type: "DOT", amount: "3", durationTicks: "2" },
                { type: "STUN", durationActions: "1" }
              ] }
            ]
          }
        } as never,
        members: { create: [{ userId: kpId, role: "KP" }, { userId: plId, role: "PLAYER" }] }
      }
    });
    roomId = room.id;

    const character = await prisma.character.create({
      data: {
        userId: plId, system: "COC7", name: "E2E 法师", str: 50, con: 50, siz: 50, dex: 60, app: 50, int: 60, pow: 70, edu: 60, luck: 50,
        hp: 12, maxHp: 12, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 0, maxDp: 0, skills: { OCCULT: 70 }
      }
    });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });
    const game = await prisma.game.create({ data: { roomId: room.id, status: "PLAYING", title: "E2E 法术局", createdBy: kpId, startedAt: new Date() } });
    await prisma.gameCharacter.create({ data: { gameId: game.id, characterId: character.id, userId: plId, currentHp: 12, currentMp: 10, currentSan: 50, currentDp: 0 } });
    const npcStats = NpcStatsSchema.parse({ presetId: null, tier: "MINION", rarity: "COMMON", race: null, attributes: { str: 40, con: 40, siz: 40, dex: 40, app: 40, int: 40, pow: 40, edu: 40, luck: 40 }, skills: {}, maxHp: 30, maxMp: 0, maxSan: 0, maxDp: 0, tags: [] });
    const npc = await prisma.card.create({ data: { scope: "ROOM", roomId: room.id, ownerId: kpId, type: "NPC", name: "E2E 法术靶子", rarity: "COMMON", system: "COC7", stats: npcStats as never } });

    const effective = await loadEffectivePack({ id: room.id, system: room.system, rulePackVersionId: null, ruleOverride: room.ruleOverride });
    const created = await createCombatRecord(room.id, effective, [characterRef(character.id)], [npcRef(npc.id)]);
    if (created.ok === false || created.combatId === undefined) throw new Error("创建战斗失败：" + created.error);
    const combatId = created.combatId;

    plSocket = await connectSocket(plJar);
    kpSocket = await connectSocket(kpJar);
    const plJoin = await emitAck<CombatJoinAck>(plSocket, "combat:join", combatId);
    const kpJoin = await emitAck<CombatJoinAck>(kpSocket, "combat:join", combatId);
    if (plJoin.ok === false || plJoin.view === undefined || kpJoin.ok === false || kpJoin.view === undefined) throw new Error("加入战斗失败");

    let plView = plJoin.view;
    let kpView = kpJoin.view;
    plSocket.on("combat:update", (update: CombatUpdate) => { if (update.combatId === combatId) plView = update.view; });
    kpSocket.on("combat:update", (update: CombatUpdate) => { if (update.combatId === combatId) kpView = update.view; });

    const enemyActor = kpView.participants.find((participant) => participant.kind === "NPC");
    if (enemyActor === undefined) throw new Error("缺少敌方目标");

    async function waitOwnReady(): Promise<{ id: string }> {
      for (let index = 0; index < 40; index += 1) {
        const enemy = kpView.participants.find((participant) => participant.id === enemyActor?.id && participant.isReady && participant.defeated === false);
        if (enemy !== undefined && kpView.pendingIds.includes(enemy.id) === false && kpView.pendingReactions.length === 0) {
          await emitAck<Ack>(kpSocket as Socket, "combat:action", { combatId, actorId: enemy.id, action: { kind: "PASS" } });
        }
        const own = plView.participants.find((participant) => participant.isSelf && participant.isReady && participant.defeated === false);
        if (own !== undefined && (enemy === undefined || kpView.pendingIds.includes(enemy.id) || enemy.id === own.id)) return own;
        await delay(120);
      }
      throw new Error("等待玩家单位就绪超时");
    }

    const ownActor = await waitOwnReady();


    // 1. SELF 法术：不需要目标，自动作用于自己。
    const selfHealAck = await emitAck<Ack>(plSocket, "combat:action", {
      combatId,
      actorId: ownActor.id,
      action: { kind: "MAGIC", spellId: "selfheal", name: "自愈" }
    });
    expectEqual(selfHealAck.ok, true, "SELF 法术应可施放：" + (selfHealAck.error ?? ""));

    const ownActor2 = await waitOwnReady();


    // 2. ONE + ALLY 法术应允许选择自己。
    const blessAck = await emitAck<Ack>(plSocket, "combat:action", {
      combatId,
      actorId: ownActor2.id,
      action: { kind: "MAGIC", targetId: ownActor2.id, spellId: "bless", name: "祝福" }
    });
    expectEqual(blessAck.ok, true, "ONE+ALLY 法术应可以选择自己：" + (blessAck.error ?? ""));

    const ownActor3 = await waitOwnReady();


    const reactionRequest = waitEvent<CombatReactionRequest>(kpSocket, "combat:reaction-request", (request) => request.combatId === combatId);
    const pendingView = waitEvent<CombatUpdate>(kpSocket, "combat:update", (update) =>
      update.view.pendingReactions.some((pending) => pending.actorId === ownActor3.id && pending.targetId === enemyActor.id)
    );
    const hexAck = await emitAck<Ack>(plSocket, "combat:action", {
      combatId,
      actorId: ownActor3.id,
      action: { kind: "MAGIC", targetId: enemyActor.id, spellId: "hex", name: "蚀血诅咒" }
    });
    expectEqual(hexAck.ok, true, "敌对法术提交失败：" + (hexAck.error ?? ""));
    const request = await reactionRequest;

    expectEqual(request.targetId, enemyActor.id, "应对请求应指向敌对目标");
    const waiting = await pendingView;

    expectEqual(waiting.view.pendingReactions.length > 0, true, "actor 侧应看到等待对方应对提示");

    const resolvedViewPromise = waitEvent<CombatUpdate>(kpSocket, "combat:update", (update) =>
      update.view.log.some((entry) => entry.text.includes("蚀血诅咒"))
    );
    const passAck = await emitAck<Ack>(kpSocket, "combat:reaction", { combatId, targetId: enemyActor.id, reaction: { type: "PASS" } });
    expectEqual(passAck.ok, true, "KP 提交敌方应对失败：" + (passAck.error ?? ""));
    const resolvedView = await resolvedViewPromise;
    kpView = resolvedView.view;
    const npcInView = kpView.participants.find((participant) => participant.id === enemyActor.id);
    if (npcInView === undefined) throw new Error("应对后找不到敌对目标");
    expectEqual(npcInView.statusEffects.some((effect) => effect.startsWith("DOT:")), true, "目标应带有 DOT 状态");
    expectEqual((npcInView.stunActions ?? 0) > 0, true, "目标应带有眩晕层数");

    console.log("PASS 通用法术 E2E：SELF / ALLY 选自己 / 应对等待 / DAMAGE+DOT+STUN");
    console.log("  room=" + room.id + " combat=" + combatId + " spell=hex effects=" + String(npcInView.statusEffects.join(",")));
  } finally {
    if (plSocket !== null) plSocket.close();
    if (kpSocket !== null) kpSocket.close();
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [kpName, plName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
