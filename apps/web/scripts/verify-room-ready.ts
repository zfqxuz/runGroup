/**
 * 准备闸门 E2E：
 * 1. 未全员 ready 时不能开始。
 * 2. 全员 ready 但 PL 没有审核通过角色时不能开始。
 * 3. 全员 ready 且每名 PL 有审核通过角色后才能开始。
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();

interface CallResult {
  readonly status: number;
  readonly text: string;
  readonly headers: Headers;
}

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
  const parts: string[] = [];
  for (const [name, value] of jar) parts.push(name + "=" + value);
  return parts.join("; ");
}

async function call(jar: Map<string, string>, pathName: string, init: RequestInit = {}): Promise<CallResult> {
  const headers = new Headers(init.headers);
  const cookie = cookieHeader(jar);
  if (cookie.length > 0) headers.set("cookie", cookie);
  const response = await fetch(BASE + pathName, { ...init, headers, redirect: "manual" });
  absorbCookies(response, jar);
  return { status: response.status, text: await response.text(), headers: response.headers };
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
  expectEqual(response.status, 201, "注册 " + username);
  const body = (await response.json()) as { user?: { id?: string } };
  const id = body.user?.id;
  if (id === undefined) throw new Error("E2E 断言失败：注册缺少 user.id");
  return id;
}

async function login(username: string, password: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const csrf = await call(jar, "/api/auth/csrf");
  expectEqual(csrf.status, 200, "GET /api/auth/csrf");
  const csrfBody = JSON.parse(csrf.text) as { csrfToken?: string };
  const csrfToken = csrfBody.csrfToken;
  if (csrfToken === undefined) throw new Error("E2E 断言失败：csrfToken 缺失");
  const result = await call(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  expectEqual(result.status, 302, "登录 " + username);
  return jar;
}

function extractActionFieldAround(html: string, marker: string): string {
  const markerIndex = html.indexOf(marker);
  if (markerIndex <= 0) throw new Error("E2E 断言失败：页面缺少标记 " + marker);
  const formIndex = html.lastIndexOf("<form", markerIndex);
  if (formIndex < 0) throw new Error("E2E 断言失败：未找到标记所在表单");
  const formHtml = html.slice(formIndex, html.indexOf("</form>", markerIndex));
  const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(formHtml);
  const field = match === null ? undefined : match[1];
  if (field === undefined || field.length === 0) throw new Error("E2E 断言失败：表单缺少 action id");
  return field;
}

function extractLastFormActionField(html: string): string {
  const formIndex = html.lastIndexOf("<form");
  if (formIndex < 0) throw new Error("E2E 断言失败：页面没有表单");
  const formEnd = html.indexOf("</form>", formIndex);
  if (formEnd < 0) throw new Error("E2E 断言失败：最后一个表单未闭合");
  const formHtml = html.slice(formIndex, formEnd);
  const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(formHtml);
  const field = match === null ? undefined : match[1];
  if (field === undefined || field.length === 0) throw new Error("E2E 断言失败：最后一个表单缺少 action id");
  return field;
}

async function toggleReady(jar: Map<string, string>, roomId: string): Promise<void> {
  const page = await call(jar, "/rooms/" + roomId + "/prepare");
  expectEqual(page.status, 200, "GET 准备页");
  const field = extractActionFieldAround(page.text, "我准备好了");
  const form = new FormData();
  form.set(field, "");
  form.set("roomId", roomId);
  const result = await call(jar, "/rooms/" + roomId + "/prepare", {
    method: "POST",
    headers: { origin: BASE, referer: BASE + "/rooms/" + roomId + "/prepare" },
    body: form
  });
  ensure(result.status < 400, "准备请求失败");
}

async function tryStart(jar: Map<string, string>, roomId: string): Promise<Response> {
  const page = await call(jar, "/rooms/" + roomId + "/prepare");
  const field = extractLastFormActionField(page.text);
  const form = new FormData();
  form.set(field, "");
  form.set("roomId", roomId);
  const result = await fetch(BASE + "/rooms/" + roomId + "/prepare", {
    method: "POST",
    headers: {
      cookie: cookieHeader(jar),
      origin: BASE,
      referer: BASE + "/rooms/" + roomId + "/prepare"
    },
    body: form,
    redirect: "manual"
  });
  absorbCookies(result, jar);
  return result;
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_ready_kp_" + suffix;
  const plName = "e2e_ready_pl_" + suffix;
  const password = "e2e_ready_pass";
  let roomId: string | null = null;

  try {
    const kpId = await register(kpName, password);
    const plId = await register(plName, password);
    const room = await prisma.room.create({
      data: {
        name: "E2E 准备闸门房",
        system: "COC7",
        ownerId: kpId,
        inviteCode: "RDY" + suffix.toUpperCase().slice(0, 8),
        members: {
          create: [
            { userId: kpId, role: "KP" },
            { userId: plId, role: "PLAYER" }
          ]
        }
      },
      select: { id: true }
    });
    roomId = room.id;

    const kpJar = await login(kpName, password);
    const plJar = await login(plName, password);

    const blockedByReady = await tryStart(kpJar, room.id);
    ensure(blockedByReady.status === 303, "未 ready 时应重定向");
    const afterReadyBlock = await prisma.room.findUnique({ where: { id: room.id }, select: { status: true } });
    expectEqual(afterReadyBlock?.status, "LOBBY", "未 ready 时房间不应开始");

    await toggleReady(kpJar, room.id);
    await toggleReady(plJar, room.id);
    const readyMembers = await prisma.roomMember.findMany({ where: { roomId: room.id }, select: { ready: true } });
    ensure(readyMembers.every((member) => member.ready), "准备按钮应写入 ready");

    const blockedByCharacter = await tryStart(kpJar, room.id);
    ensure(blockedByCharacter.status === 303, "缺角色时应重定向");
    const afterCharacterBlock = await prisma.room.findUnique({ where: { id: room.id }, select: { status: true } });
    expectEqual(afterCharacterBlock?.status, "LOBBY", "缺角色时房间不应开始");

    const character = await prisma.character.create({
      data: {
        userId: plId,
        system: "COC7",
        name: "E2E 准备角色",
        str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 10, maxDp: 10
      },
      select: { id: true }
    });
    await prisma.roomCharacterEntry.create({
      data: { roomId: room.id, characterId: character.id, status: "APPROVED" }
    });

    const plPrepare = await call(plJar, "/rooms/" + room.id + "/prepare");
    const activeField = extractActionFieldAround(plPrepare.text, "保存当前角色");
    const activeForm = new FormData();
    activeForm.set(activeField, "");
    activeForm.set("roomId", room.id);
    activeForm.set("characterId", character.id);
    const activeResponse = await call(plJar, "/rooms/" + room.id + "/prepare", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/rooms/" + room.id + "/prepare" },
      body: activeForm
    });
    ensure(activeResponse.status < 400, "保存当前角色失败");
    const selectedMember = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: plId } },
      select: { activeCharacterId: true }
    });
    expectEqual(selectedMember?.activeCharacterId, character.id, "当前角色应保存");

    const started = await tryStart(kpJar, room.id);
    ensure(started.status === 303, "满足条件时应重定向开始");
    const afterStart = await prisma.room.findUnique({ where: { id: room.id }, select: { status: true } });
    expectEqual(afterStart?.status, "PLAYING", "满足条件后房间应进入 PLAYING");
    const startedGame = await prisma.game.findFirst({ where: { roomId: room.id }, orderBy: { createdAt: "desc" } });
    ensure(startedGame !== null, "开始后应创建 Game");
    const gameCharacters = await prisma.gameCharacter.count({ where: { gameId: startedGame?.id ?? "" } });
    expectEqual(gameCharacters, 1, "开始后应为 PL 创建 GameCharacter");

    const playPage = await call(kpJar, "/rooms/" + room.id);
    expectEqual(playPage.status, 200, "GET 跑团页");
    const pauseField = extractActionFieldAround(playPage.text, "暂停本局");
    const pauseForm = new FormData();
    pauseForm.set(pauseField, "");
    pauseForm.set("roomId", room.id);
    const pausedResponse = await call(kpJar, "/rooms/" + room.id, {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/rooms/" + room.id },
      body: pauseForm
    });
    ensure(pausedResponse.status < 400, "暂停请求失败");
    const pausedRoom = await prisma.room.findUnique({ where: { id: room.id }, select: { status: true } });
    expectEqual(pausedRoom?.status, "PAUSED", "暂停后房间状态");
    const pausedGame = await prisma.game.findUnique({ where: { id: startedGame?.id ?? "" }, select: { status: true } });
    expectEqual(pausedGame?.status, "PAUSED", "暂停后 Game 状态");
    const pausedState = await prisma.gameState.findUnique({ where: { gameId: startedGame?.id ?? "" }, select: { paused: true } });
    expectEqual(pausedState?.paused, true, "暂停后 GameState.paused");
    const readyAfterPause = await prisma.roomMember.findMany({ where: { roomId: room.id }, select: { ready: true } });
    ensure(readyAfterPause.every((member) => member.ready === false), "暂停后应重置 ready");

    await toggleReady(kpJar, room.id);
    await toggleReady(plJar, room.id);
    const resumed = await tryStart(kpJar, room.id);
    ensure(resumed.status === 303, "全员准备后应可以继续");
    const resumedRoom = await prisma.room.findUnique({ where: { id: room.id }, select: { status: true } });
    expectEqual(resumedRoom?.status, "PLAYING", "继续后房间状态");
    const resumedGame = await prisma.game.findUnique({ where: { id: startedGame?.id ?? "" }, select: { status: true } });
    expectEqual(resumedGame?.status, "PLAYING", "继续后 Game 状态");
    const resumedState = await prisma.gameState.findUnique({ where: { gameId: startedGame?.id ?? "" }, select: { paused: true } });
    expectEqual(resumedState?.paused, false, "继续后 GameState.paused");

    const playAgain = await call(kpJar, "/rooms/" + room.id);
    const endField = extractActionFieldAround(playAgain.text, "结束本局");
    const endForm = new FormData();
    endForm.set(endField, "");
    endForm.set("roomId", room.id);
    const endedResponse = await call(kpJar, "/rooms/" + room.id, {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/rooms/" + room.id },
      body: endForm
    });
    ensure(endedResponse.status < 400, "结束本局请求失败");
    const endedRoom = await prisma.room.findUnique({ where: { id: room.id }, select: { status: true } });
    expectEqual(endedRoom?.status, "LOBBY", "结束后房间应回 LOBBY");
    const endedGame = await prisma.game.findUnique({ where: { id: startedGame?.id ?? "" }, select: { status: true } });
    expectEqual(endedGame?.status, "ENDED", "结束后 Game 状态");

    console.log("PASS 准备闸门 E2E：ready / 角色审核 / 开始 / 暂停 / 继续 / 结束");
  } finally {
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [kpName, plName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
