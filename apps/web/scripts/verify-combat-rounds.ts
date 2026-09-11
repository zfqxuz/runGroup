/**
 * 战斗多轮回归 E2E：
 * 覆盖 ATB / 顺序制在「攻击 → 应对 → 下一轮」之后不会卡死，
 * 并验证两名客户端的 combat:update 实时同步。
 */
import { io, type Socket } from "socket.io-client";
import type { CombatView } from "@touhou/combat";
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RunContext {
  readonly combatId: string;
  readonly kpSocket: Socket;
  readonly plSocket: Socket;
  readonly kpName: string;
  readonly plName: string;
  kpView: CombatView | null;
  plView: CombatView | null;
  readonly kpUpdates: number[];
  readonly plUpdates: number[];
}

function controlledIds(view: CombatView | null, side: "KP" | "PL"): string[] {
  if (view === null) return [];
  return view.participants
    .filter((participant) => participant.isReady && participant.defeated === false)
    .filter((participant) => side === "KP" ? participant.kind === "NPC" || participant.isSelf : participant.isSelf)
    .map((participant) => participant.id);
}

function anyReady(view: CombatView | null): number {
  return view === null ? 0 : view.participants.filter((participant) => participant.isReady && !participant.defeated).length;
}

function isEnded(view: CombatView | null): boolean {
  return view !== null && view.phase === "ENDED";
}

async function waitReady(ctx: RunContext, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isEnded(ctx.kpView) || isEnded(ctx.plView)) return true;
    if (anyReady(ctx.kpView) > 0 || anyReady(ctx.plView) > 0) return true;
    await delay(100);
  }
  return false;
}

async function submitAttack(ctx: RunContext, side: "KP" | "PL", actorId: string): Promise<void> {
  const socket = side === "KP" ? ctx.kpSocket : ctx.plSocket;
  const view = side === "KP" ? ctx.kpView : ctx.plView;
  const target = view?.participants.find((participant) => participant.id !== actorId && !participant.defeated);
  const targetId = target?.id ?? null;
  let ack = await emitAck<Ack>(socket, "combat:action", {
    combatId: ctx.combatId,
    actorId,
    action: { kind: "DANMAKU", targetId, skill: "FIGHTING_BRAWL", damage: "1d4" }
  });
  if (ack.ok === false) {
    ack = await emitAck<Ack>(socket, "combat:action", {
      combatId: ctx.combatId,
      actorId,
      action: { kind: "PASS" }
    });
  }
  if (ack.ok === false) throw new Error(side + " 单位 " + actorId + " 行动失败：" + ack.error);
}

async function runMode(mode: "ATB" | "INITIATIVE"): Promise<void> {
  const suffix = Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  const kpName = "e2e_round_kp_" + suffix;
  const plName = "e2e_round_pl_" + suffix;
  const password = "e2e-round-pass-123";
  let roomId: string | null = null;
  let kpSocket: Socket | null = null;
  let plSocket: Socket | null = null;

  try {
    const kpId = await register(kpName, password);
    const plId = await register(plName, password);
    const room = await prisma.room.create({
      data: {
        name: "E2E 多轮战斗 " + mode,
        system: "COC7",
        ownerId: kpId,
        inviteCode: "RD" + suffix.slice(-5).toUpperCase(),
        status: "PLAYING",
        ruleOverride: { combat: { mode } } as never,
        members: {
          create: [
            { userId: kpId, role: "KP", ready: true },
            { userId: plId, role: "PLAYER", ready: true }
          ]
        }
      }
    });
    roomId = room.id;

    const character = await prisma.character.create({
      data: {
        userId: plId, system: "COC7", name: "E2E 多轮 PC",
        str: 50, con: 50, siz: 50, dex: 70, app: 50, int: 60, pow: 60, edu: 60, luck: 50,
        hp: 20, maxHp: 20, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 0, maxDp: 0,
        skills: { FIGHTING_BRAWL: 70, DODGE: 50 }
      }
    });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });

    const npcStats = NpcStatsSchema.parse({
      presetId: "E2E", tier: "MINION", rarity: "COMMON", race: null,
      attributes: { str: 40, con: 40, siz: 40, dex: 40, app: 40, int: 40, pow: 40, edu: 40, luck: 40 },
      skills: { FIGHTING_BRAWL: 40, DODGE: 30 },
      maxHp: 20, maxMp: 10, maxSan: 50, maxDp: 0, tags: []
    });
    const npc = await prisma.card.create({
      data: {
        scope: "ROOM", roomId: room.id, ownerId: kpId, type: "NPC", name: "E2E 多轮 NPC",
        rarity: "COMMON", system: "COC7", stats: npcStats as never, isPublic: true
      }
    });

    const effective = await loadEffectivePack({
      id: room.id,
      system: room.system,
      rulePackVersionId: room.rulePackVersionId,
      ruleOverride: room.ruleOverride
    });
    const created = await createCombatRecord(room.id, effective, [characterRef(character.id)], [npcRef(npc.id)]);
    if (created.ok === false || created.combatId === undefined) throw new Error("创建战斗失败：" + created.error);
    const combatId = created.combatId;

    const ctx: RunContext = {
      combatId,
      kpSocket: await connectSocket(await login(kpName, password)),
      plSocket: await connectSocket(await login(plName, password)),
      kpName,
      plName,
      kpView: null,
      plView: null,
      kpUpdates: [],
      plUpdates: []
    };
    kpSocket = ctx.kpSocket;
    plSocket = ctx.plSocket;

    ctx.kpSocket.on("combat:update", (update: CombatUpdate) => {
      if (update.combatId === combatId) { ctx.kpView = update.view; ctx.kpUpdates.push(update.view.round); }
    });
    ctx.plSocket.on("combat:update", (update: CombatUpdate) => {
      if (update.combatId === combatId) { ctx.plView = update.view; ctx.plUpdates.push(update.view.round); }
    });
    ctx.kpSocket.on("combat:reaction-request", (request: CombatReactionRequest) => {
      const controllable = ctx.kpView?.participants.some((participant) =>
        participant.id === request.targetId && (participant.kind === "NPC" || participant.isSelf));
      if (controllable === true) {
        void emitAck<Ack>(ctx.kpSocket, "combat:reaction", { combatId, targetId: request.targetId, reaction: { type: "PASS" } }).catch(() => undefined);
      }
    });
    ctx.plSocket.on("combat:reaction-request", (request: CombatReactionRequest) => {
      const controllable = ctx.plView?.participants.some((participant) => participant.id === request.targetId && participant.isSelf);
      if (controllable === true) {
        void emitAck<Ack>(ctx.plSocket, "combat:reaction", { combatId, targetId: request.targetId, reaction: { type: "PASS" } }).catch(() => undefined);
      }
    });

    const kpJoin = await emitAck<CombatJoinAck>(ctx.kpSocket, "combat:join", combatId);
    const plJoin = await emitAck<CombatJoinAck>(ctx.plSocket, "combat:join", combatId);
    if (kpJoin.ok === false || plJoin.ok === false) throw new Error("加入战斗失败");
    if (kpJoin.view !== undefined) ctx.kpView = kpJoin.view;
    if (plJoin.view !== undefined) ctx.plView = plJoin.view;

    let turns = 0;
    let maxRound = 0;
    for (let i = 0; i < 12; i += 1) {
      if (isEnded(ctx.kpView) || isEnded(ctx.plView)) break;
      const ready = await waitReady(ctx, 5000);
      if (ready === false) throw new Error(mode + " 卡住：第 " + i + " 次等待后仍没有可行动单位");
      if (isEnded(ctx.kpView) || isEnded(ctx.plView)) break;

      const kpActors = controlledIds(ctx.kpView, "KP");
      const plActors = controlledIds(ctx.plView, "PL");
      for (const actorId of kpActors) { await submitAttack(ctx, "KP", actorId); turns += 1; }
      for (const actorId of plActors) { await submitAttack(ctx, "PL", actorId); turns += 1; }

      const roundBefore = Math.max(ctx.kpView?.round ?? 0, ctx.plView?.round ?? 0);
      const actedIds = new Set([...kpActors, ...plActors]);
      const deadline = Date.now() + 6000;
      let sawNewReady = false;
      while (Date.now() < deadline) {
        maxRound = Math.max(maxRound, ctx.kpView?.round ?? 0, ctx.plView?.round ?? 0);
        if (maxRound > roundBefore) break;
        if (isEnded(ctx.kpView) || isEnded(ctx.plView)) break;
        const readyNow = new Set([...controlledIds(ctx.kpView, "KP"), ...controlledIds(ctx.plView, "PL")]);
        for (const id of readyNow) {
          if (actedIds.has(id) === false) { sawNewReady = true; break; }
        }
        if (sawNewReady) break;
        await delay(100);
      }
      maxRound = Math.max(maxRound, ctx.kpView?.round ?? 0, ctx.plView?.round ?? 0);
      const advanced = maxRound > roundBefore || sawNewReady || isEnded(ctx.kpView) || isEnded(ctx.plView);
      if (advanced === false) {
        throw new Error(mode + " 行动后既不进轮也没有新单位就绪：" + JSON.stringify({
          round: roundBefore,
          phase: ctx.plView?.phase,
          kpReady: controlledIds(ctx.kpView, "KP"),
          plReady: controlledIds(ctx.plView, "PL")
        }));
      }
      if (mode === "ATB" && maxRound >= 4) break;
      if (mode === "INITIATIVE" && maxRound >= 3 && turns >= 5) break;
    }

    if (mode === "ATB" && maxRound < 4) throw new Error("ATB 多轮没有跑满 4 轮，maxRound=" + maxRound);
    if (mode === "INITIATIVE" && maxRound < 2) throw new Error("顺序制没有进入第 3 轮，maxRound=" + maxRound);
    if (ctx.plUpdates.length === 0 || ctx.kpUpdates.length === 0) throw new Error(mode + " 双方没有收到 combat:update 广播");

    console.log("PASS 多轮战斗 " + mode + "：turns=" + turns + " maxRound=" + maxRound +
      " kpUpdates=" + ctx.kpUpdates.length + " plUpdates=" + ctx.plUpdates.length);
  } finally {
    if (kpSocket !== null) kpSocket.close();
    if (plSocket !== null) plSocket.close();
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [kpName, plName] } } });
  }
}

async function main(): Promise<void> {
  await runMode("ATB");
  await runMode("INITIATIVE");
  console.log("PASS 战斗多轮 E2E 全部通过");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
