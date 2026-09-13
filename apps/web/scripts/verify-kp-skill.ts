/**
 * KP 数值调整 + 技能检定成长池 E2E。
 * 运行：npm run verify:kp-skill --workspace @touhou/web
 */
import { PrismaClient } from "@prisma/client";
import { io, type Socket } from "socket.io-client";
import type { Ack } from "../src/shared/socket";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const prisma = new PrismaClient();

function absorbCookies(response: Response, jar: Map<string, string>): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  for (const cookie of headers.getSetCookie?.() ?? []) {
    const first = cookie.split(";")[0];
    if (first === undefined) continue;
    const equals = first.indexOf("=");
    if (equals > 0) jar.set(first.slice(0, equals), first.slice(equals + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([key, value]) => key + "=" + value).join("; ");
}

async function call(jar: Map<string, string>, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookieHeader(jar));
  const response = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
  absorbCookies(response, jar);
  return { status: response.status, text: await response.text() };
}

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("E2E 断言失败：" + message);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual === expected) return;
  throw new Error("E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

async function register(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password })
  });
  const body = (await response.json()) as { user?: { id?: string } };
  if (body.user?.id === undefined) throw new Error("注册失败");
  return body.user.id;
}

async function login(username: string, password: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const csrf = await call(jar, "/api/auth/csrf");
  const token = (JSON.parse(csrf.text) as { csrfToken?: string }).csrfToken;
  if (token === undefined) throw new Error("缺少 csrfToken");
  const result = await call(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: token, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  expectEqual(result.status, 302, "登录");
  return jar;
}

async function connectSocket(jar: Map<string, string>): Promise<Socket> {
  const ticketResponse = await call(jar, "/api/socket-ticket", { method: "POST" });
  const ticket = (JSON.parse(ticketResponse.text) as { ticket?: string }).ticket;
  if (ticket === undefined) throw new Error("缺少 socket ticket");
  const socket = io(BASE, { path: "/api/socket", transports: ["websocket"], auth: { ticket }, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket timeout")), 8000);
    socket.once("connect", () => { clearTimeout(timer); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
  });
  return socket;
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ack timeout: " + event)), 8000);
    socket.emit(event, payload, (result: T) => { clearTimeout(timer); resolve(result); });
  });
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_kpv_kp_" + suffix;
  const plName = "e2e_kpv_pl_" + suffix;
  const password = "e2e-kpv-pass";
  let roomId: string | null = null;
  let kpSocket: Socket | null = null;
  let plSocket: Socket | null = null;
  try {
    const kpId = await register(kpName, password);
    const plId = await register(plName, password);
    const room = await prisma.room.create({
      data: {
        name: "E2E KP数值",
        system: "COC7",
        ownerId: kpId,
        inviteCode: "KPV" + suffix.slice(-5).toUpperCase(),
        status: "PLAYING",
        members: { create: [{ userId: kpId, role: "KP", ready: true }, { userId: plId, role: "PLAYER", ready: true }] }
      }
    });
    roomId = room.id;
    await prisma.roomCharacterEntry.create({
      data: { roomId: room.id, characterId: (await prisma.character.create({
        data: {
          userId: plId, system: "COC7", name: "E2E KP数值角色",
          str: 10, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
          hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 10, maxDp: 10,
          skills: { DODGE: 40 } as never
        }
      })).id, status: "APPROVED" }
    });
    const character = await prisma.character.findFirstOrThrow({ where: { userId: plId, name: "E2E KP数值角色" } });
    await prisma.roomMember.update({ where: { roomId_userId: { roomId: room.id, userId: plId } }, data: { activeCharacterId: character.id } });
    const game = await prisma.game.create({ data: { roomId: room.id, status: "PLAYING", title: "E2E KP数值局", createdBy: kpId, startedAt: new Date() } });
    await prisma.gameState.create({ data: { gameId: game.id, paused: false } });
    await prisma.gameCharacter.create({
      data: { gameId: game.id, characterId: character.id, userId: plId, currentHp: 10, currentMp: 10, currentSan: 50, currentDp: 10 }
    });

    kpSocket = await connectSocket(await login(kpName, password));
    plSocket = await connectSocket(await login(plName, password));
    await emitAck<Ack>(kpSocket, "room:join", room.id);
    await emitAck<Ack>(plSocket, "room:join", room.id);

    const adjustAck = await emitAck<Ack>(kpSocket, "room:adjust-values", {
      roomId: room.id,
      unitRef: "character:" + character.id,
      values: { hp: 7, attributes: { str: 60 }, skills: { DODGE: 100 } }
    });
    expectEqual(adjustAck.ok, true, "KP 应能调整玩家数值");
    const afterAdjust = await prisma.character.findUnique({ where: { id: character.id } });
    expectEqual(afterAdjust?.hp, 7, "HP 应写入角色卡");
    expectEqual(afterAdjust?.str, 60, "STR 应写入角色卡");
    expectEqual((afterAdjust?.skills as Record<string, number> | null)?.DODGE, 100, "技能应写入角色卡");
    const gameCharacter = await prisma.gameCharacter.findUnique({
      where: { gameId_characterId: { gameId: game.id, characterId: character.id } }
    });
    expectEqual(gameCharacter?.currentHp, 7, "当前局 HP 应同步");

    const checkAck = await emitAck<Ack>(plSocket, "dice:skill-check", {
      roomId: room.id,
      characterId: character.id,
      skillId: "DODGE",
      visibility: "PUBLIC"
    });
    expectEqual(checkAck.ok, true, "技能检定应成功提交");
    const growth = await prisma.growthCheck.findUnique({
      where: { gameId_characterId_skillId: { gameId: game.id, characterId: character.id, skillId: "DODGE" } }
    });
    ensure(growth !== null, "技能检定成功应写入成长池");
    expectEqual(growth?.state, "PENDING", "成长点应为待检定");
    expectEqual(growth?.beforeValue, 100, "成长点应记录检定前值");

    console.log("PASS KP 数值 / 技能检定：HP 属性 技能 修改 + 1d100 检定成功入成长池");
  } finally {
    kpSocket?.close();
    plSocket?.close();
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [kpName, plName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
