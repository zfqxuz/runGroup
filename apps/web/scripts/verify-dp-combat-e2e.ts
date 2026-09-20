/**
 * 千幻抄 DP 战斗端到端：
 * 创建 DP 战斗 → 双方声明 DP → 当前行动者打弹幕 → 目标应对 → 结算 → 快照恢复。
 *
 * 运行前需先启动 dev server（默认 http://localhost:3100）。
 * 运行：npx tsx --env-file=.env scripts/verify-dp-combat-e2e.ts
 */
import { io, type Socket } from "socket.io-client";
import { characterRef, createCombatRecord, npcRef } from "../src/server/combat/setup";
import { clearCombatRuntime, loadCombatRuntime } from "../src/server/combat/runtime";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { NpcStatsSchema } from "../src/shared/npc";
import { SpellCardStatsSchema } from "../src/shared/card";
import { prepareSpellcardAction } from "../src/server/combat/spellcards";
import { loadUsedSpellcardKeys, markSpellcardUsed } from "../src/server/combat/spellcard-usage";
import { listSelectableSpellcards } from "../src/server/combat/setup";
import type { Ack, CombatJoinAck, CombatReactionRequest, CombatUpdate } from "../src/shared/socket";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const jar = new Map<string, string>();

function absorbCookies(response: Response): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  for (const cookie of headers.getSetCookie?.() ?? []) {
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
  if (condition === false) throw new Error("DP E2E FAILED: " + message);
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
  const username = "e2e_dp_" + Date.now().toString(36);
  const password = "test-password-123";
  let roomId: string | null = null;
  let socket: Socket | null = null;
  try {
    const register = await call("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, displayName: "DP验证", password })
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
        name: "DP战斗房" + Date.now().toString(36),
        system: "TOUHOU",
        ownerId: userId,
        inviteCode: "DP" + Date.now().toString(36).slice(-5).toUpperCase(),
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
        name: "DP灵梦",
        race: "HUMAN",
        str: 50, con: 50, siz: 50, dex: 70, app: 60, int: 55, pow: 70, edu: 55, luck: 50,
        skills: { DANMAKU: 80, DODGE: 100, MELEE: 55 }
      }
    });
    await prisma.roomCharacterEntry.create({
      data: { roomId: room.id, characterId: character.id, status: "APPROVED" }
    });
    const spellStats = (name: string) =>
      SpellCardStatsSchema.parse({
        mode: "CONSUMPTION",
        danmaku: name,
        mpCost: 0,
        hpRatio: null,
        durationTicks: null,
        clearTargets: null,
        enhanceType: "DANMAKU",
        enhanceValue: 1,
        effects: []
      });
    const declaredCard = await prisma.card.create({
      data: {
        scope: "CHARACTER",
        ownerId: userId,
        characterId: character.id,
        type: "SPELLCARD",
        name: "已宣言符卡",
        rarity: "COMMON",
        system: "TOUHOU",
        isEquipped: true,
        stats: spellStats("已宣言符卡") as never
      }
    });
    const undeclaredCard = await prisma.card.create({
      data: {
        scope: "CHARACTER",
        ownerId: userId,
        characterId: character.id,
        type: "SPELLCARD",
        name: "未宣言符卡",
        rarity: "COMMON",
        system: "TOUHOU",
        isEquipped: true,
        stats: spellStats("未宣言符卡") as never
      }
    });

    const game = await prisma.game.create({
      data: { roomId: room.id, status: "PLAYING", title: "DP E2E", createdBy: userId },
      select: { id: true }
    });
    await prisma.gameCharacter.create({
      data: {
        gameId: game.id,
        characterId: character.id,
        userId,
        currentHp: character.hp > 1 ? character.hp : 100,
        currentMp: character.mp,
        currentSan: character.san,
        currentDp: character.dp
      }
    });

    const npcStats = NpcStatsSchema.parse({
      presetId: "FAIRY",
      tier: "MINION",
      rarity: "UNCOMMON",
      race: "FAIRY",
      attributes: { str: 20, con: 25, siz: 20, dex: 65, app: 45, int: 25, pow: 55, edu: 5, luck: 60 },
      skills: { DANMAKU: 0, DODGE: 45, FLIGHT: 60 },
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
        name: "DP妖精",
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
    assert(effective.compiled.combat.mode === "DP", "东方房间应为 DP 模式");
    const created = await createCombatRecord(room.id, effective, [characterRef(character.id)], [npcRef(npc.id)], {
      spellcardDeclarations: { ALLY: [declaredCard.id] }
    });
    assert(created.ok === true && created.combatId !== undefined, created.error ?? "创建战斗失败");
    const combatId = created.combatId as string;

    clearCombatRuntime(combatId);
    const runtime = await loadCombatRuntime(combatId);
    assert(runtime !== null, "战斗 runtime 缺失");
    assert(runtime.state.mode === "DP", "战斗状态应为 DP 模式");
    assert(runtime.state.phase === "DP_DECLARATION", "创建后应处于宣言阶段，实际 " + runtime.state.phase);
    const pc = runtime.state.participants.find((item) => item.characterId === character.id);
    const enemy = runtime.state.participants.find((item) => item.characterId === null);
    assert(pc !== undefined && enemy !== undefined, "战斗单位缺失");
    assert(pc.dp > 0, "PC 回合开始应有 DP（dp=" + pc.dp + " maxDp=" + pc.maxDp + "）");
    const declared = runtime.state.spellcardBattle?.declaredCardIds?.ALLY ?? [];
    assert(declared.includes(declaredCard.id), "我方宣言池应包含已宣言符卡");
    assert(declared.includes(undeclaredCard.id) === false, "我方宣言池不应包含未宣言符卡");
    const pcCards = runtime.spellcardsByParticipant.get(pc.id) ?? [];
    const declaredCheck = prepareSpellcardAction(
      runtime.pack,
      pc,
      pcCards,
      { actorId: pc.id, kind: "SPELLCARD", spellCardId: declaredCard.id, spellcardMode: "CONSUMPTION" },
      runtime.state
    );
    assert(declaredCheck.ok === true, "已宣言符卡应可通过准备校验：" + (declaredCheck.ok ? "" : declaredCheck.error));
    const undeclaredCheck = prepareSpellcardAction(
      runtime.pack,
      pc,
      pcCards,
      { actorId: pc.id, kind: "SPELLCARD", spellCardId: undeclaredCard.id, spellcardMode: "CONSUMPTION" },
      runtime.state
    );
    assert(
      undeclaredCheck.ok === false && undeclaredCheck.error.includes("未宣言"),
      "未宣言符卡应被服务端拦截，实际：" + (undeclaredCheck.ok ? "通过" : undeclaredCheck.error)
    );

    const ticketResponse = await call("/api/socket-ticket", { method: "POST" });
    const ticket = (JSON.parse(ticketResponse.text) as { ticket?: string }).ticket;
    assert(typeof ticket === "string" && ticket.length > 0, "缺少 socket ticket");

    const connected = await connectSocket(ticket);
    socket = connected;
    const join = await emitAck<CombatJoinAck>(connected, "combat:join", combatId);
    assert(join.ok === true && join.view !== undefined, join.error ?? "加入战斗失败");
    assert(join.view?.mode === "DP", "视图应为 DP 模式");
    assert(join.view?.dp !== null && join.view?.dp.currentActorId === null, "宣言阶段不应有当前行动者");

    // 双方声明：PC 声明全部 DP，NPC 声明 0 → PC 先手。
    const declarePc = await emitAck<Ack>(connected, "combat:dp-declare", {
      combatId,
      participantId: pc.id,
      value: pc.dp
    });
    assert(declarePc.ok === true, declarePc.error ?? "PC 声明失败");
    const actionPhase = waitForView(connected, combatId, (update) => update.view.phase === "AWAITING_ACTION");
    const declareNpc = await emitAck<Ack>(connected, "combat:dp-declare", {
      combatId,
      participantId: enemy.id,
      value: 0
    });
    assert(declareNpc.ok === true, declareNpc.error ?? "NPC 声明失败");
    const phaseUpdate = await actionPhase;
    assert(phaseUpdate.view.dp?.currentActorId === pc.id, "PC 应以高 DP 先行动");
    const dpBefore = pc.dp;
    const enemyHpBefore = enemy.hp;

    // PC 打弹幕：固定 3 DP、无判定、全体；NPC 目标需回应。
    const reactionRequest = waitEvent<CombatReactionRequest>(connected, "combat:reaction-request");
    const actionAck = await emitAck<Ack>(connected, "combat:action", {
      combatId,
      actorId: pc.id,
      action: { kind: "DANMAKU", dpAction: "DANMAKU", danmakuDpReduction: 1, danmakuBaseDamage: 5 }
    });
    assert(actionAck.ok === true, actionAck.error ?? "弹幕提交失败");
    const request = await reactionRequest;
    assert(request.targetId === enemy.id, "应对目标应为敌方");
    const afterResolve = waitForView(
      connected,
      combatId,
      (update) => update.view.pendingReactions.length === 0 && update.view.phase !== "AWAITING_ACTION"
        ? true
        : update.view.pendingReactions.length === 0 && update.view.dp?.currentActorId !== pc.id
    );
    const reactionAck = await emitAck<Ack>(connected, "combat:reaction", {
      combatId,
      targetId: enemy.id,
      reaction: { type: "PASS" }
    });
    assert(reactionAck.ok === true, reactionAck.error ?? "应对提交失败");
    const resolved = await afterResolve;

    // 脚本进程里的 createCombatRecord 会缓存创建时的状态；清掉缓存强制从 DB 读最新快照。
    clearCombatRuntime(combatId);
    const persisted = await loadCombatRuntime(combatId);
    assert(persisted !== null, "结算后 runtime 缺失");
    const persistedEnemy = persisted.state.participants.find((item) => item.id === enemy.id);
    const persistedPc = persisted.state.participants.find((item) => item.id === pc.id);
    assert(persistedEnemy !== undefined && persistedPc !== undefined, "结算后单位缺失");
    assert(persistedEnemy.hp === enemyHpBefore - 5, "弹幕应造成 5 点固定伤害，实际 " + persistedEnemy.hp + " / 原 " + enemyHpBefore);
    assert(persistedPc.dp === dpBefore - 3, "PC 应消耗 3 DP，实际 " + persistedPc.dp + " / 原 " + dpBefore);
    assert(resolved.view.participants.find((item) => item.id === pc.id)?.dp === dpBefore - 3, "视图 DP 未同步");

    // 第二段：轮到 NPC 向 PC 射击，PC 用 3D DP 回避并获得擦弹。
    assert(
      resolved.view.dp?.currentActorId === enemy.id,
      "第一段结算后应轮到 NPC 行动，实际 " + String(resolved.view.dp?.currentActorId)
    );
    const pcReaction = waitEvent<CombatReactionRequest>(connected, "combat:reaction-request");
    const enemyAttack = await emitAck<Ack>(connected, "combat:action", {
      combatId,
      actorId: enemy.id,
      action: {
        kind: "DANMAKU",
        dpAction: "RANGED",
        targetId: pc.id,
        skill: "DANMAKU",
        dpDice: 1,
        damage: "10"
      }
    });
    assert(enemyAttack.ok === true, enemyAttack.error ?? "NPC 射击提交失败");
    const pcRequest = await pcReaction;
    assert(pcRequest.targetId === pc.id, "应对目标应为 PC");
    const round2 = waitForView(connected, combatId, (update) => update.view.phase === "DP_DECLARATION");
    const dodgeAck = await emitAck<Ack>(connected, "combat:reaction", {
      combatId,
      targetId: pc.id,
      reaction: { type: "DODGE", dpDice: 3 }
    });
    assert(dodgeAck.ok === true, dodgeAck.error ?? "PC 回避提交失败");
    const round2Update = await round2;
    const pcAfterDodge = round2Update.view.participants.find((item) => item.id === pc.id);
    assert(pcAfterDodge !== undefined, "第二轮视图缺少 PC");
    assert(pcAfterDodge.hp === 100, "PC 回避成功不应受伤，实际 HP " + String(pcAfterDodge.hp));
    assert((pcAfterDodge.grazePoints ?? 0) >= 3, "PC 回避成功应获得擦弹，实际 " + String(pcAfterDodge.grazePoints));

    // 快照恢复：第二轮宣言阶段应已持久化。
    clearCombatRuntime(combatId);
    const persistedRound2 = await loadCombatRuntime(combatId);
    assert(persistedRound2 !== null, "第二轮快照缺失");
    assert(persistedRound2.state.phase === "DP_DECLARATION", "第二轮快照应为宣言阶段");
    assert(persistedRound2.state.round === 2, "第二轮快照 round 应为 2");

    // 章节内已用 SC：记录后不应再出现在战前宣言候选里（create 也会过滤）。
    await markSpellcardUsed(room.id, character.id, declaredCard.id);
    const usedKeys = await loadUsedSpellcardKeys(room.id, [character.id]);
    assert(usedKeys.has(character.id + ":" + declaredCard.id), "应记录已用符卡");
    const selectableCards = await listSelectableSpellcards(room.id, [
      { ref: "character:" + character.id } as never
    ]);
    const remainingIds = (selectableCards["character:" + character.id] ?? []).map((card) => card.cardId);
    assert(remainingIds.includes(undeclaredCard.id), "未使用符卡应保留在候选里");
    assert(remainingIds.includes(declaredCard.id) === false, "已用符卡不应再出现在候选里");

    console.log(
      "PASS DP 战斗 E2E：章节内已用 SC → SC 战前宣言 → DP 宣言 → 弹幕 → 应对 → 射击 / 回避擦弹 → 轮转 → 快照恢复（战斗 " + combatId + "）"
    );
  } finally {
    if (socket !== null) socket.close();
    if (roomId !== null) {
      const combats = await prisma.combat.findMany({ where: { roomId }, select: { id: true } });
      for (const combat of combats) clearCombatRuntime(combat.id);
      await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
