/**
 * 场景可用性 E2E：
 * 切换场景、加载背景图、清除墙体 / 灯光、放置 PC / NPC Token。
 */
import { io, type Socket } from "socket.io-client";
import { prisma } from "../src/server/db/prisma";
import { loadSceneView } from "../src/server/scene/load";
import { NpcStatsSchema } from "../src/shared/npc";
import type { Ack } from "../src/shared/socket";
import type { SceneMapUpdated } from "../src/shared/scene";

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
    return { status: response.status, text: await response.text(), location: response.headers.get("location") };
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

function extractActionFieldAround(html: string, marker: string): string {
  const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
  for (const form of forms) {
    if (form.includes(marker) === false) continue;
    const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(form);
    if (match?.[1] !== undefined && match[1].length > 0) return match[1];
  }
  throw new Error("找不到表单标记：" + marker);
}

async function submitAction(jar: Map<string, string>, path: string, form: FormData): Promise<void> {
  const response = await jarCall(jar)(path, {
    method: "POST",
    headers: { origin: BASE, referer: BASE + path },
    body: form
  });
  if (response.status >= 400) throw new Error("Server Action 失败 " + response.status + "：" + response.text.slice(0, 200));
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

function waitEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("事件超时：" + event)), 8000);
    socket.once(event, (value: T) => { clearTimeout(timer); resolve(value); });
  });
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error("E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_sceneops_kp_" + suffix;
  const plName = "e2e_sceneops_pl_" + suffix;
  const password = "e2e-sceneops-pass";
  let roomId: string | null = null;
  let socket: Socket | null = null;

  try {
    const kpId = await register(kpName, password);
    const plId = await register(plName, password);
    const kpJar = await login(kpName, password);

    const room = await prisma.room.create({
      data: {
        name: "E2E 场景操作房 " + suffix, system: "COC7", ownerId: kpId, inviteCode: "SO" + suffix.slice(-5).toUpperCase(), status: "LOBBY",
        members: { create: [{ userId: kpId, role: "KP" }, { userId: plId, role: "PLAYER" }] }
      }
    });
    roomId = room.id;
    const character = await prisma.character.create({
      data: { userId: plId, system: "COC7", name: "E2E 场景 PC", str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50, hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 0, maxDp: 0, skills: {} }
    });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });
    await prisma.roomMember.update({ where: { roomId_userId: { roomId: room.id, userId: plId } }, data: { activeCharacterId: character.id } });
    const npcStats = NpcStatsSchema.parse({ presetId: null, tier: "MINION", rarity: "COMMON", race: null, attributes: { str: 40, con: 40, siz: 40, dex: 40, app: 40, int: 40, pow: 40, edu: 40, luck: 40 }, skills: {}, maxHp: 10, maxMp: 0, maxSan: 0, maxDp: 0, tags: [] });
    await prisma.card.create({ data: { scope: "ROOM", roomId: room.id, ownerId: kpId, type: "NPC", name: "E2E 场景 NPC", rarity: "COMMON", system: "COC7", stats: npcStats as never } });
    await prisma.scene.create({ data: { roomId: room.id, name: "场景 A", isActive: true, orderIndex: 0, map: { create: { name: "场景 A", width: 800, height: 600 } } } });

    const scenesPath = "/rooms/" + room.id + "/scenes";
    const scenesPage = await jarCall(kpJar)(scenesPath);
    expectEqual(scenesPage.status, 200, "GET 场景页");

    // 1. 创建场景 B 并切换。
    const createForm = new FormData();
    createForm.set(extractActionFieldAround(scenesPage.text, "创建场景"), "");
    createForm.set("roomId", room.id);
    createForm.set("name", "场景 B");
    createForm.set("description", "第二个场景");
    await submitAction(kpJar, scenesPath, createForm);
    const sceneB = await prisma.scene.findFirst({ where: { roomId: room.id, name: "场景 B" } });
    if (sceneB === null) throw new Error("场景 B 创建失败");

    const pageAfterCreate = await jarCall(kpJar)(scenesPath);
    const activateForm = new FormData();
    activateForm.set(extractActionFieldAround(pageAfterCreate.text, "切换到本场景"), "");
    activateForm.set("roomId", room.id);
    activateForm.set("sceneId", sceneB.id);
    await submitAction(kpJar, scenesPath, activateForm);
    const activeScene = await prisma.scene.findFirst({ where: { roomId: room.id, isActive: true }, select: { id: true } });
    expectEqual(activeScene?.id, sceneB.id, "场景应切换到 B");
    const roomView = await loadSceneView(room.id);
    expectEqual(roomView?.id, sceneB.id, "跑团页应加载场景 B");

    // 2. 上传背景图并加载。
    const uploadForm = new FormData();
    uploadForm.set("type", "MAP");
    uploadForm.set("file", new File([Buffer.from(PNG_BASE64, "base64")], "e2e-map.png", { type: "image/png" }));
    const uploadResponse = await jarCall(kpJar)("/api/upload", { method: "POST", body: uploadForm });
    const uploadPayload = JSON.parse(uploadResponse.text) as { ok?: boolean; asset?: { id?: string; url?: string }; error?: string };
    if (uploadPayload.ok !== true || uploadPayload.asset?.id === undefined || uploadPayload.asset.url === undefined) {
      throw new Error("上传场景图失败：" + (uploadPayload.error ?? uploadResponse.text.slice(0, 120)));
    }
    const mapOfB = await prisma.map.findUnique({ where: { sceneId: sceneB.id }, select: { id: true } });
    if (mapOfB === null) throw new Error("场景 B 缺少地图");
    await prisma.map.update({ where: { id: mapOfB.id }, data: { backgroundId: uploadPayload.asset.id } });
    const imageResponse = await fetch(BASE + uploadPayload.asset.url);
    expectEqual(imageResponse.status, 200, "背景图 URL 应可访问");
    const sceneView = await loadSceneView(room.id);
    expectEqual(sceneView?.map?.backgroundUrl, uploadPayload.asset.url, "跑团场景视图应带背景 URL");

    // 3. Socket 创建并清除墙体 / 灯光。
    socket = await connectSocket(kpJar);
    const joinAck = await emitAck<Ack>(socket, "room:join", room.id);
    expectEqual(joinAck.ok, true, "KP 加入房间频道");

    const wallEvent = waitEvent<SceneMapUpdated>(socket, "scene:map:updated");
    const wallAck = await emitAck<Ack>(socket, "scene:wall:create", { roomId: room.id, sceneId: sceneB.id, points: [100, 100, 400, 100], type: "WALL" });
    expectEqual(wallAck.ok, true, "创建墙体 " + (wallAck.error ?? ""));
    await wallEvent;
    const wall = await prisma.wall.findFirst({ where: { mapId: mapOfB.id } });
    if (wall === null) throw new Error("墙体未落库");
    const lightEvent = waitEvent<SceneMapUpdated>(socket, "scene:map:updated");
    const lightAck = await emitAck<Ack>(socket, "scene:light:create", { roomId: room.id, sceneId: sceneB.id, x: 300, y: 300, radius: 200, color: "#ffaa00", intensity: 1 });
    expectEqual(lightAck.ok, true, "创建灯光 " + (lightAck.error ?? ""));
    await lightEvent;
    const light = await prisma.light.findFirst({ where: { mapId: mapOfB.id } });
    if (light === null) throw new Error("灯光未落库");

    const clearWallEvent = waitEvent<SceneMapUpdated>(socket, "scene:map:updated");
    const clearWallAck = await emitAck<Ack>(socket, "scene:wall:clear", { roomId: room.id, sceneId: sceneB.id });
    expectEqual(clearWallAck.ok, true, "清除墙体 " + (clearWallAck.error ?? ""));
    await clearWallEvent;
    expectEqual(await prisma.wall.count({ where: { mapId: mapOfB.id } }), 0, "墙体应清空");
    const clearLightEvent = waitEvent<SceneMapUpdated>(socket, "scene:map:updated");
    const clearLightAck = await emitAck<Ack>(socket, "scene:light:clear", { roomId: room.id, sceneId: sceneB.id });
    expectEqual(clearLightAck.ok, true, "清除灯光 " + (clearLightAck.error ?? ""));
    await clearLightEvent;
    expectEqual(await prisma.light.count({ where: { mapId: mapOfB.id } }), 0, "灯光应清空");

    // 4. 从场景页放置 PC 与 NPC Token。
    const pageForToken = await jarCall(kpJar)(scenesPath);
    const tokenForm = new FormData();
    tokenForm.set(extractActionFieldAround(pageForToken.text, "添加 Token"), "");
    tokenForm.set("roomId", room.id);
    tokenForm.set("sceneId", sceneB.id);
    tokenForm.set("unitRef", "character:" + character.id);
    await submitAction(kpJar, scenesPath, tokenForm);
    const pcToken = await prisma.token.findFirst({ where: { map: { sceneId: sceneB.id }, characterId: character.id } });
    if (pcToken === null) throw new Error("PC Token 未创建");

    // 同一角色在同一场景只能放置一次；重复提交应被服务端拒绝。
    const duplicateTokenForm = new FormData();
    duplicateTokenForm.set(extractActionFieldAround(pageForToken.text, "添加 Token"), "");
    duplicateTokenForm.set("roomId", room.id);
    duplicateTokenForm.set("sceneId", sceneB.id);
    duplicateTokenForm.set("unitRef", "character:" + character.id);
    await submitAction(kpJar, scenesPath, duplicateTokenForm);
    const pcTokenCount = await prisma.token.count({ where: { map: { sceneId: sceneB.id }, characterId: character.id } });
    expectEqual(pcTokenCount, 1, "同一角色在同一场景不应重复放置 Token");

    const npcCard = await prisma.card.findFirst({ where: { roomId: room.id, type: "NPC" }, select: { id: true } });
    if (npcCard === null) throw new Error("NPC 卡不存在");
    const tokenForm2 = new FormData();
    tokenForm2.set(extractActionFieldAround(pageForToken.text, "添加 Token"), "");
    tokenForm2.set("roomId", room.id);
    tokenForm2.set("sceneId", sceneB.id);
    tokenForm2.set("unitRef", "npc:" + npcCard.id);
    await submitAction(kpJar, scenesPath, tokenForm2);
    const npcToken = await prisma.token.findFirst({ where: { map: { sceneId: sceneB.id }, cardId: npcCard.id } });
    if (npcToken === null) throw new Error("NPC Token 未创建");

    // 4.5 开局前的准备页也应能切换场景 / 放置 Token / 画墙与灯光。
    const preparePage = await jarCall(kpJar)("/rooms/" + room.id + "/prepare");
    expectEqual(preparePage.status, 200, "GET 准备页");
    if (preparePage.text.includes("战术棋盘") === false || preparePage.text.includes("切换场景") === false || preparePage.text.includes("放置玩家 / NPC Token") === false) {
      throw new Error("准备页没有渲染可用的场景布置面板");
    }

    // 5. 跑团页 SceneBoard 应能拿到场景与 Token。
    await prisma.room.update({ where: { id: room.id }, data: { status: "PLAYING" } });
    const roomPage = await jarCall(kpJar)("/rooms/" + room.id);
    expectEqual(roomPage.status, 200, "GET 跑团页");
    if (roomPage.text.includes("场景 B") === false || roomPage.text.includes("E2E 场景 PC") === false) {
      throw new Error("跑团页没有渲染当前场景与 Token");
    }

    console.log("PASS 场景操作 E2E：准备阶段切换 / 背景图 / 清空墙灯 / 放置 PC·NPC Token / 重复放置拦截");
    console.log("  room=" + room.id + " scene=" + sceneB.id);
  } finally {
    if (socket !== null) socket.close();
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [kpName, plName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
