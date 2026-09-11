/**
 * 场景 / 战术棋盘 E2E：
 * 创建场景 → 添加角色 Token → 玩家 Socket 拖动自己的 Token → KP 实时收到更新。
 */
import { PrismaClient } from "@prisma/client";
import { io, type Socket } from "socket.io-client";
import type { Ack } from "../src/shared/socket";
import type { SceneTokenUpdate } from "../src/shared/scene";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const prisma = new PrismaClient();

function absorbCookies(response: Response, jar: Map<string, string>): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const listed = headers.getSetCookie?.() ?? [];
  const fallback = response.headers.get("set-cookie");
  const cookies = listed.length > 0 ? listed : fallback === null ? [] : [fallback];
  for (const cookie of cookies) {
    const first = cookie.split(";")[0];
    if (first === undefined) continue;
    const equals = first.indexOf("=");
    if (equals <= 0) continue;
    jar.set(first.slice(0, equals), first.slice(equals + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => name + "=" + value).join("; ");
}

async function call(jar: Map<string, string>, pathName: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const cookie = cookieHeader(jar);
  if (cookie.length > 0) headers.set("cookie", cookie);
  const response = await fetch(BASE + pathName, { ...init, headers, redirect: "manual" });
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

function extractActionFieldAround(html: string, marker: string): string {
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const markerIndex = html.indexOf(marker, searchFrom);
    if (markerIndex < 0) break;
    const formIndex = html.lastIndexOf("<form", markerIndex);
    const formEnd = html.indexOf("</form>", markerIndex);
    if (formIndex >= 0 && formEnd > markerIndex) {
      const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(html.slice(formIndex, formEnd));
      if (match?.[1] !== undefined && match[1].length > 0) return match[1];
    }
    searchFrom = markerIndex + 1;
  }
  throw new Error("E2E 断言失败：未找到包含 server action 的标记表单：" + marker);
}

async function submitAction(jar: Map<string, string>, pathName: string, form: FormData): Promise<void> {
  const result = await call(jar, pathName, {
    method: "POST",
    headers: { origin: BASE, referer: BASE + pathName },
    body: form
  });
  ensure(result.status < 400, "Server Action 请求失败：" + result.status + " " + result.text.slice(0, 200));
}

async function register(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password })
  });
  expectEqual(response.status, 201, "注册 " + username);
  const body = (await response.json()) as { user?: { id?: string } };
  if (body.user?.id === undefined) throw new Error("注册响应缺少 user.id");
  return body.user.id;
}

async function login(username: string, password: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const csrf = await call(jar, "/api/auth/csrf");
  const csrfBody = JSON.parse(csrf.text) as { csrfToken?: string };
  if (csrfBody.csrfToken === undefined) throw new Error("csrfToken 缺失");
  const login = await call(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrfBody.csrfToken, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  expectEqual(login.status, 302, "登录 " + username);
  return jar;
}

function connectSocket(ticket: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { path: "/api/socket", autoConnect: false, transports: ["websocket"], reconnection: false, rejectUnauthorized: false });
    socket.auth = { ticket };
    const timer = setTimeout(() => { socket.close(); reject(new Error("socket connect timeout")); }, 8000);
    socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("connect_error", (error: Error) => { clearTimeout(timer); reject(error); });
    socket.connect();
  });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket ack timeout: " + event)), 8000);
    socket.emit(event, payload, (result: T) => { clearTimeout(timer); resolve(result); });
  });
}

function waitEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket event timeout: " + event)), 8000);
    socket.once(event, (value: T) => { clearTimeout(timer); resolve(value); });
  });
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_scene_kp_" + suffix;
  const playerName = "e2e_scene_player_" + suffix;
  const password = "e2e_scene_pass";
  let roomId: string | null = null;
  let kpSocket: Socket | null = null;
  let playerSocket: Socket | null = null;

  try {
    const kpId = await register(kpName, password);
    const playerId = await register(playerName, password);

    const room = await prisma.room.create({
      data: {
        name: "E2E 场景房",
        system: "COC7",
        ownerId: kpId,
        inviteCode: "SCN" + suffix.toUpperCase().slice(0, 6),
        status: "PLAYING",
        members: { create: [{ userId: kpId, role: "KP" }, { userId: playerId, role: "PLAYER", ready: true }] }
      },
      select: { id: true }
    });
    roomId = room.id;

    const character = await prisma.character.create({
      data: {
        userId: playerId,
        system: "COC7",
        name: "E2E 场景角色",
        str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 10, maxDp: 10
      },
      select: { id: true }
    });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });
    await prisma.roomMember.update({
      where: { roomId_userId: { roomId: room.id, userId: playerId } },
      data: { activeCharacterId: character.id }
    });
    const game = await prisma.game.create({
      data: { roomId: room.id, status: "PLAYING", title: "E2E 场景测试局", startedAt: new Date(), createdBy: kpId },
      select: { id: true }
    });
    await prisma.gameState.create({ data: { gameId: game.id, paused: false } });
    await prisma.gameCharacter.create({
      data: { gameId: game.id, characterId: character.id, userId: playerId, currentHp: 10, currentMp: 10, currentSan: 50, currentDp: 10 }
    });

    const kpJar = await login(kpName, password);
    const playerJar = await login(playerName, password);

    const scenesPath = "/rooms/" + room.id + "/scenes";
    const page = await call(kpJar, scenesPath);
    expectEqual(page.status, 200, "GET 场景管理页");

    const createSceneForm = new FormData();
    createSceneForm.set(extractActionFieldAround(page.text, "创建场景"), "");
    createSceneForm.set("roomId", room.id);
    createSceneForm.set("name", "E2E 大厅");
    createSceneForm.set("description", "E2E 场景描述");
    await submitAction(kpJar, scenesPath, createSceneForm);

    const scene = await prisma.scene.findFirst({ where: { roomId: room.id }, include: { map: true } });
    ensure(scene !== null && scene.map !== null, "应创建带地图的场景");
    expectEqual(scene?.isActive, true, "第一个场景应自动激活");

    const pageAfterScene = await call(kpJar, scenesPath);
    const addTokenForm = new FormData();
    addTokenForm.set(extractActionFieldAround(pageAfterScene.text, "添加 Token"), "");
    addTokenForm.set("roomId", room.id);
    addTokenForm.set("sceneId", scene?.id ?? "");
    addTokenForm.set("unitRef", "character:" + character.id);
    await submitAction(kpJar, scenesPath, addTokenForm);

    const token = await prisma.token.findFirst({ where: { mapId: scene?.map?.id ?? "" } });
    ensure(token !== null, "应创建角色 Token");

    const kpTickets = await call(kpJar, "/api/socket-ticket", { method: "POST" });
    const playerTickets = await call(playerJar, "/api/socket-ticket", { method: "POST" });
    const kpT = JSON.parse(kpTickets.text).ticket as string;
    const playerT = JSON.parse(playerTickets.text).ticket as string;
    kpSocket = await connectSocket(kpT);
    playerSocket = await connectSocket(playerT);
    const kpJoin = await emitAck<Ack>(kpSocket, "room:join", room.id);
    const playerJoin = await emitAck<Ack>(playerSocket, "room:join", room.id);
    ensure(kpJoin.ok && playerJoin.ok, "Socket 加入房间失败");

    const updatePromise = waitEvent<SceneTokenUpdate>(kpSocket, "scene:token:updated");
    const moveAck = await emitAck<Ack>(playerSocket, "scene:token:move", {
      roomId: room.id,
      tokenId: token?.id ?? "",
      x: 321,
      y: 222
    });
    ensure(moveAck.ok, moveAck.error ?? "移动 Token 失败");
    const update = await updatePromise;
    expectEqual(update.roomId, room.id, "更新事件房间 ID");
    expectEqual(update.token.id, token?.id ?? "", "更新 Token ID");
    expectEqual(Math.round(update.token.x), 321, "广播 Token X");
    expectEqual(Math.round(update.token.y), 222, "广播 Token Y");

    const moved = await prisma.token.findUnique({ where: { id: token?.id ?? "" } });
    expectEqual(Math.round(moved?.x ?? 0), 321, "数据库 Token X");
    expectEqual(Math.round(moved?.y ?? 0), 222, "数据库 Token Y");

    console.log("PASS 场景棋盘 E2E：创建场景 / 添加 Token / 玩家拖动 / 实时广播");
    console.log("  scene " + scene?.id + " token " + token?.id);
  } finally {
    kpSocket?.close();
    playerSocket?.close();
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [kpName, playerName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
