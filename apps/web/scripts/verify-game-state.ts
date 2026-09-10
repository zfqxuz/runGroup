/**
 * 局内状态、成长记录与 Socket 重连 E2E。
 * 需要 dev server 已启动，并在 apps/web/.env 中配置 E2E 数据库。
 */
import { PrismaClient } from "@prisma/client";
import { io, type Socket } from "socket.io-client";

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
  throw new Error(
    "E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual)
  );
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
  const formEnd = html.indexOf("</form>", markerIndex);
  const formHtml = html.slice(formIndex, formEnd);
  const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(formHtml);
  const field = match === null ? undefined : match[1];
  if (field === undefined || field.length === 0) throw new Error("E2E 断言失败：表单缺少 action id");
  return field;
}

async function submitAction(
  jar: Map<string, string>,
  pathName: string,
  form: FormData
): Promise<void> {
  const result = await call(jar, pathName, {
    method: "POST",
    headers: { origin: BASE, referer: BASE + pathName },
    body: form
  });
  ensure(result.status < 400, "Server Action 请求失败：" + result.status);
}

function waitForJoin(socket: Socket, roomId: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket room:join 超时")), 5000);
    socket.emit("room:join", roomId, (result: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_state_kp_" + suffix;
  const plName = "e2e_state_pl_" + suffix;
  const password = "e2e_state_pass";
  let roomId: string | null = null;
  let socket: Socket | null = null;

  try {
    const kpId = await register(kpName, password);
    const plId = await register(plName, password);

    const room = await prisma.room.create({
      data: {
        name: "E2E 局内状态房",
        system: "COC7",
        ownerId: kpId,
        inviteCode: "GST" + suffix.toUpperCase().slice(0, 8),
        status: "PLAYING",
        members: {
          create: [
            { userId: kpId, role: "KP", ready: true },
            { userId: plId, role: "PLAYER", ready: true }
          ]
        }
      },
      select: { id: true }
    });
    roomId = room.id;

    const character = await prisma.character.create({
      data: {
        userId: plId,
        system: "COC7",
        name: "E2E 局内角色",
        str: 10, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 10, maxDp: 10,
        skills: { DODGE: 40 } as never
      },
      select: { id: true }
    });
    await prisma.roomCharacterEntry.create({
      data: { roomId: room.id, characterId: character.id, status: "APPROVED" }
    });
    await prisma.roomMember.update({
      where: { roomId_userId: { roomId: room.id, userId: plId } },
      data: { activeCharacterId: character.id }
    });

    const game = await prisma.game.create({
      data: {
        roomId: room.id,
        status: "PLAYING",
        title: "E2E 局内状态测试",
        startedAt: new Date(),
        createdBy: kpId
      },
      select: { id: true }
    });
    await prisma.gameState.create({
      data: { gameId: game.id, paused: false }
    });
    await prisma.gameCharacter.create({
      data: {
        gameId: game.id,
        characterId: character.id,
        userId: plId,
        currentHp: 10,
        currentMp: 10,
        currentSan: 50,
        currentDp: 10
      }
    });

    const kpJar = await login(kpName, password);
    const playPage = await call(kpJar, "/rooms/" + room.id);
    expectEqual(playPage.status, 200, "GET 跑团页");
    ensure(playPage.text.includes("局内状态"), "跑团页应显示局内状态面板");

    const stateField = extractActionFieldAround(playPage.text, "保存局内状态");
    const stateForm = new FormData();
    stateForm.set(stateField, "");
    stateForm.set("roomId", room.id);
    stateForm.set("gameId", game.id);
    stateForm.set("expectedVersion", "1");
    stateForm.set("currentChapterId", "第一章：红雾异变");
    stateForm.set("currentSceneId", "雾之湖");
    stateForm.set("currentEncounterId", "遭遇：冰之妖精");
    stateForm.set("gameTime", "第 1 天 08:30");
    stateForm.set("flags", JSON.stringify({ boss_defeated: true }));
    stateForm.set("counters", JSON.stringify({ sanity_loss_total: 3 }));
    stateForm.set("custom", JSON.stringify({ weather_note: "红雾" }));
    await submitAction(kpJar, "/rooms/" + room.id, stateForm);

    const updatedState = await prisma.gameState.findUnique({ where: { gameId: game.id } });
    expectEqual(updatedState?.currentChapterId, "第一章：红雾异变", "章节应保存");
    expectEqual(updatedState?.currentSceneId, "雾之湖", "场景应保存");
    expectEqual(updatedState?.currentEncounterId, "遭遇：冰之妖精", "遭遇应保存");
    expectEqual(updatedState?.gameTime, "第 1 天 08:30", "团内时间应保存");
    expectEqual(updatedState?.version, 2, "GameState 版本应递增");

    const pageAfterState = await call(kpJar, "/rooms/" + room.id);
    expectEqual(pageAfterState.status, 200, "状态更新后 GET 跑团页");
    const advancementField = extractActionFieldAround(pageAfterState.text, "记录成长");
    const advancementForm = new FormData();
    advancementForm.set(advancementField, "");
    advancementForm.set("roomId", room.id);
    advancementForm.set("gameId", game.id);
    advancementForm.set("characterId", character.id);
    advancementForm.set("kind", "ATTRIBUTE");
    advancementForm.set("target", "str");
    advancementForm.set("delta", "1");
    advancementForm.set("note", "模组奖励：目睹真相后力量 +1");
    await submitAction(kpJar, "/rooms/" + room.id, advancementForm);

    const advancement = await prisma.characterAdvancement.findFirst({
      where: { gameId: game.id, characterId: character.id },
      orderBy: { createdAt: "desc" }
    });
    ensure(advancement !== null, "应写入 CharacterAdvancement");
    expectEqual(advancement?.kind, "ATTRIBUTE", "成长类型");
    expectEqual(advancement?.delta, 1, "成长 delta");
    const updatedCharacter = await prisma.character.findUnique({ where: { id: character.id } });
    expectEqual(updatedCharacter?.str, 11, "属性成长应应用到角色卡");

    const ticketResponse = await call(kpJar, "/api/socket-ticket", { method: "POST" });
    const ticketPayload = JSON.parse(ticketResponse.text) as { ok?: boolean; ticket?: string };
    ensure(ticketPayload.ok === true && typeof ticketPayload.ticket === "string", "应签发 Socket 票据");

    socket = io(BASE, {
      path: "/api/socket",
      transports: ["websocket"],
      auth: { ticket: ticketPayload.ticket },
      autoConnect: true,
      reconnection: false
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Socket 连接超时")), 5000);
      socket?.on("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket?.on("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const joinAck = await waitForJoin(socket, room.id);
    expectEqual(joinAck.ok, true, "Socket room:join 应成功");
    const reconnectedState = joinAck.gameState as { version?: number } | null | undefined;
    expectEqual(reconnectedState?.version, 2, "Socket 重连应返回更新后的 GameState");
    expectEqual(joinAck.activeCombatId, null, "无战斗时 activeCombatId 应为 null");

    console.log("PASS 局内状态 E2E：状态更新 / 成长记录 / Socket 重连返回 GameState");
  } finally {
    socket?.close();
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [kpName, plName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
